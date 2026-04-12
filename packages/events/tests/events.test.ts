/**
 * EventStream Tests
 *
 * Covers:
 *   - Basic emit/subscribe (single subscriber, multiple events)
 *   - Multiple subscribers (fan-out, each gets all events)
 *   - AsyncIterable consumption (for-await-of pattern)
 *   - Backpressure: drop-oldest, drop-newest policies
 *   - JSONL subscriber (write to temp file, verify contents)
 *   - Subscriber removal (dispose function from tee())
 *   - Error isolation (subscriber error doesn't affect others)
 *   - Close semantics (flush, completion signal, cleanup)
 *   - Event envelope helper (defineEvent factory)
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createEventStream,
  defineEvent,
} from "../src/index.js";

import type {
  EventSubscriber,
  EventEnvelope,
} from "../src/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface TestEvent {
  type: string;
  value: number;
}

/** Collect events from an AsyncIterable into an array (with optional limit). */
async function collect<T>(
  iter: AsyncIterable<T>,
  limit: number,
): Promise<T[]> {
  const results: T[] = [];
  for await (const event of iter) {
    results.push(event);
    if (results.length >= limit) break;
  }
  return results;
}

/** Wait for a short tick to allow async delivery. */
function tick(ms = 10): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Basic Emit / Subscribe
// ---------------------------------------------------------------------------

describe("EventStream", () => {
  describe("basic emit/subscribe", () => {
    it("delivers events to a single subscriber", async () => {
      const stream = createEventStream<TestEvent>();
      const events = collect(stream.subscribe(), 3);

      stream.emit({ type: "a", value: 1 });
      stream.emit({ type: "b", value: 2 });
      stream.emit({ type: "c", value: 3 });

      const result = await events;
      expect(result).toEqual([
        { type: "a", value: 1 },
        { type: "b", value: 2 },
        { type: "c", value: 3 },
      ]);
    });

    it("delivers buffered events when subscriber starts consuming later", async () => {
      const stream = createEventStream<TestEvent>();
      const iter = stream.subscribe();

      // Emit before consuming
      stream.emit({ type: "a", value: 1 });
      stream.emit({ type: "b", value: 2 });

      const result = await collect(iter, 2);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ type: "a", value: 1 });
      expect(result[1]).toEqual({ type: "b", value: 2 });
    });

    it("reports subscriberCount correctly", async () => {
      const stream = createEventStream<TestEvent>();
      expect(stream.subscriberCount).toBe(0);

      const iter = stream.subscribe();
      expect(stream.subscriberCount).toBe(1);

      const dispose = stream.tee("test", {
        name: "test",
        onEvent: () => {},
      });
      expect(stream.subscriberCount).toBe(2);

      dispose();
      expect(stream.subscriberCount).toBe(1);

      // Clean up the iterable subscriber
      const asyncIter = iter[Symbol.asyncIterator]();
      await asyncIter.return?.();
      expect(stream.subscriberCount).toBe(0);

      await stream.close();
    });
  });

  // -------------------------------------------------------------------------
  // Multiple Subscribers (fan-out)
  // -------------------------------------------------------------------------

  describe("fan-out (multiple subscribers)", () => {
    it("delivers each event to all AsyncIterable subscribers", async () => {
      const stream = createEventStream<TestEvent>();
      const sub1 = collect(stream.subscribe(), 2);
      const sub2 = collect(stream.subscribe(), 2);

      stream.emit({ type: "a", value: 1 });
      stream.emit({ type: "b", value: 2 });

      const [r1, r2] = await Promise.all([sub1, sub2]);
      expect(r1).toEqual([{ type: "a", value: 1 }, { type: "b", value: 2 }]);
      expect(r2).toEqual([{ type: "a", value: 1 }, { type: "b", value: 2 }]);
    });

    it("delivers events to both tee'd and AsyncIterable subscribers", async () => {
      const stream = createEventStream<TestEvent>();
      const teeEvents: TestEvent[] = [];
      stream.tee("tee-sub", {
        name: "tee-sub",
        onEvent: (e) => { teeEvents.push(e); },
      });

      const iterEvents = collect(stream.subscribe(), 2);

      stream.emit({ type: "a", value: 1 });
      stream.emit({ type: "b", value: 2 });

      const result = await iterEvents;
      expect(result).toHaveLength(2);
      expect(teeEvents).toHaveLength(2);
      expect(teeEvents).toEqual(result);
    });
  });

  // -------------------------------------------------------------------------
  // AsyncIterable Consumption
  // -------------------------------------------------------------------------

  describe("AsyncIterable consumption", () => {
    it("supports for-await-of pattern", async () => {
      const stream = createEventStream<TestEvent>();
      const received: TestEvent[] = [];

      const consumer = (async () => {
        for await (const event of stream.subscribe()) {
          received.push(event);
          if (received.length >= 3) break;
        }
      })();

      stream.emit({ type: "x", value: 10 });
      stream.emit({ type: "y", value: 20 });
      stream.emit({ type: "z", value: 30 });

      await consumer;
      expect(received).toHaveLength(3);
    });

    it("exits for-await-of when stream closes", async () => {
      const stream = createEventStream<TestEvent>();
      const received: TestEvent[] = [];

      const consumer = (async () => {
        for await (const event of stream.subscribe()) {
          received.push(event);
        }
      })();

      stream.emit({ type: "a", value: 1 });
      await tick();
      await stream.close();
      await consumer;

      expect(received).toEqual([{ type: "a", value: 1 }]);
    });

    it("returns immediately-done iterable when subscribing to closed stream", async () => {
      const stream = createEventStream<TestEvent>();
      await stream.close();

      const result = await collect(stream.subscribe(), 10);
      expect(result).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Backpressure
  // -------------------------------------------------------------------------

  describe("backpressure", () => {
    it("drop-oldest: drops oldest events when buffer is full", async () => {
      const stream = createEventStream<TestEvent>({
        backpressure: "drop-oldest",
        defaultBufferSize: 3,
      });
      const iter = stream.subscribe();

      // Emit 5 events — buffer is 3, so first 2 should be dropped
      for (let i = 1; i <= 5; i++) {
        stream.emit({ type: "e", value: i });
      }

      const result = await collect(iter, 3);
      expect(result).toEqual([
        { type: "e", value: 3 },
        { type: "e", value: 4 },
        { type: "e", value: 5 },
      ]);
    });

    it("drop-newest: drops new events when buffer is full", async () => {
      const stream = createEventStream<TestEvent>({
        backpressure: "drop-newest",
        defaultBufferSize: 3,
      });
      const iter = stream.subscribe();

      // Emit 5 events — buffer is 3, so events 4 and 5 should be dropped
      for (let i = 1; i <= 5; i++) {
        stream.emit({ type: "e", value: i });
      }

      const result = await collect(iter, 3);
      expect(result).toEqual([
        { type: "e", value: 1 },
        { type: "e", value: 2 },
        { type: "e", value: 3 },
      ]);
    });

    // "block" policy removed — it was misleading (allowed unbounded buffer growth)

    it("per-subscriber bufferSize overrides default", async () => {
      const stream = createEventStream<TestEvent>({
        backpressure: "drop-oldest",
        defaultBufferSize: 100,
      });
      const iter = stream.subscribe({ bufferSize: 2 });

      // Emit 4 events — subscriber buffer is 2
      for (let i = 1; i <= 4; i++) {
        stream.emit({ type: "e", value: i });
      }

      const result = await collect(iter, 2);
      expect(result).toEqual([
        { type: "e", value: 3 },
        { type: "e", value: 4 },
      ]);
    });
  });

  // -------------------------------------------------------------------------
  // Subscriber Removal
  // -------------------------------------------------------------------------

  describe("subscriber removal", () => {
    it("tee dispose stops delivery to that subscriber", () => {
      const stream = createEventStream<TestEvent>();
      const events: TestEvent[] = [];
      const dispose = stream.tee("removable", {
        name: "removable",
        onEvent: (e) => { events.push(e); },
      });

      stream.emit({ type: "a", value: 1 });
      dispose();
      stream.emit({ type: "b", value: 2 });

      expect(events).toEqual([{ type: "a", value: 1 }]);
    });

    it("AsyncIterable return() stops delivery", async () => {
      const stream = createEventStream<TestEvent>();
      const iter = stream.subscribe();
      const asyncIter = iter[Symbol.asyncIterator]();

      stream.emit({ type: "a", value: 1 });
      const first = await asyncIter.next();
      expect(first.value).toEqual({ type: "a", value: 1 });

      await asyncIter.return?.();
      expect(stream.subscriberCount).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Error Isolation
  // -------------------------------------------------------------------------

  describe("error isolation", () => {
    it("sync error in one tee subscriber does not affect others", () => {
      const stream = createEventStream<TestEvent>();
      const goodEvents: TestEvent[] = [];
      const errorCb = vi.fn();

      stream.tee("bad", {
        name: "bad",
        onEvent: () => { throw new Error("boom"); },
        onError: errorCb,
      });
      stream.tee("good", {
        name: "good",
        onEvent: (e) => { goodEvents.push(e); },
      });

      stream.emit({ type: "a", value: 1 });

      expect(goodEvents).toEqual([{ type: "a", value: 1 }]);
      expect(errorCb).toHaveBeenCalledWith(expect.any(Error));
    });

    it("async error in one tee subscriber does not affect others", async () => {
      const stream = createEventStream<TestEvent>();
      const goodEvents: TestEvent[] = [];
      const errorCb = vi.fn();

      stream.tee("bad-async", {
        name: "bad-async",
        onEvent: async () => { throw new Error("async boom"); },
        onError: errorCb,
      });
      stream.tee("good", {
        name: "good",
        onEvent: (e) => { goodEvents.push(e); },
      });

      stream.emit({ type: "a", value: 1 });
      await tick(50);

      expect(goodEvents).toEqual([{ type: "a", value: 1 }]);
      expect(errorCb).toHaveBeenCalledWith(expect.any(Error));
    });

    it("error in onError handler does not throw to emitter", () => {
      const stream = createEventStream<TestEvent>();

      stream.tee("double-bad", {
        name: "double-bad",
        onEvent: () => { throw new Error("boom"); },
        onError: () => { throw new Error("onError also throws"); },
      });

      // Should not throw
      expect(() => stream.emit({ type: "a", value: 1 })).not.toThrow();
    });

    it("emit on closed stream does not throw", () => {
      const stream = createEventStream<TestEvent>();
      stream.close();
      expect(() => stream.emit({ type: "a", value: 1 })).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // Close Semantics
  // -------------------------------------------------------------------------

  describe("close semantics", () => {
    it("signals onClose to all tee subscribers", async () => {
      const stream = createEventStream<TestEvent>();
      const onClose1 = vi.fn();
      const onClose2 = vi.fn();

      stream.tee("sub1", { name: "sub1", onEvent: () => {}, onClose: onClose1 });
      stream.tee("sub2", { name: "sub2", onEvent: () => {}, onClose: onClose2 });

      await stream.close();

      expect(onClose1).toHaveBeenCalledOnce();
      expect(onClose2).toHaveBeenCalledOnce();
    });

    it("completes all AsyncIterable subscribers on close", async () => {
      const stream = createEventStream<TestEvent>();
      const received: TestEvent[] = [];

      const consumer = (async () => {
        for await (const event of stream.subscribe()) {
          received.push(event);
        }
        return "done";
      })();

      stream.emit({ type: "a", value: 1 });
      await tick();
      await stream.close();

      const result = await consumer;
      expect(result).toBe("done");
      expect(received).toEqual([{ type: "a", value: 1 }]);
    });

    it("close is idempotent", async () => {
      const stream = createEventStream<TestEvent>();
      const onClose = vi.fn();
      stream.tee("sub", { name: "sub", onEvent: () => {}, onClose });

      await stream.close();
      await stream.close();

      expect(onClose).toHaveBeenCalledOnce();
    });

    it("clears subscriber count on close", async () => {
      const stream = createEventStream<TestEvent>();
      stream.subscribe();
      stream.tee("sub", { name: "sub", onEvent: () => {} });
      expect(stream.subscriberCount).toBe(2);

      await stream.close();
      expect(stream.subscriberCount).toBe(0);
    });

    it("tee on closed stream is a no-op", async () => {
      const stream = createEventStream<TestEvent>();
      await stream.close();

      const events: TestEvent[] = [];
      const dispose = stream.tee("late", {
        name: "late",
        onEvent: (e) => { events.push(e); },
      });

      stream.emit({ type: "a", value: 1 });
      expect(events).toEqual([]);
      dispose(); // should not throw
    });
  });
});

// ---------------------------------------------------------------------------
// JSONL Subscriber
// ---------------------------------------------------------------------------

describe("JSONL subscriber", () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("writes events as newline-delimited JSON with _ts field", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "events-jsonl-"));
    const filePath = join(tmpDir, "events.jsonl");

    const stream = createEventStream<TestEvent>();
    stream.jsonl(filePath);

    stream.emit({ type: "a", value: 1 });
    stream.emit({ type: "b", value: 2 });

    await stream.close();
    // Give a small tick for the flush to complete
    await tick(50);

    const content = readFileSync(filePath, "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(2);

    const parsed0 = JSON.parse(lines[0]!);
    expect(parsed0._ts).toBeDefined();
    expect(parsed0.event.type).toBe("a");
    expect(parsed0.event.value).toBe(1);

    const parsed1 = JSON.parse(lines[1]!);
    expect(parsed1.event.type).toBe("b");
    expect(parsed1.event.value).toBe(2);
  });

  it("creates parent directories if they don't exist", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "events-jsonl-"));
    const filePath = join(tmpDir, "nested", "deep", "events.jsonl");

    const stream = createEventStream<TestEvent>();
    stream.jsonl(filePath);

    stream.emit({ type: "a", value: 1 });
    await stream.close();
    await tick(50);

    const content = readFileSync(filePath, "utf-8");
    expect(content.trim()).not.toBe("");
  });

  it("dispose removes the JSONL subscriber", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "events-jsonl-"));
    const filePath = join(tmpDir, "events.jsonl");

    const stream = createEventStream<TestEvent>();
    const dispose = stream.jsonl(filePath);

    stream.emit({ type: "a", value: 1 });
    await tick(150); // wait for flush
    dispose();
    stream.emit({ type: "b", value: 2 });
    await stream.close();
    await tick(50);

    const content = readFileSync(filePath, "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!).event.type).toBe("a");
  });
});

// ---------------------------------------------------------------------------
// Event Envelope
// ---------------------------------------------------------------------------

describe("EventEnvelope / defineEvent", () => {
  it("creates an event with auto-generated timestamp", () => {
    const blockStarted = defineEvent<"block:started", { blockPath: string }>("block:started");
    const event = blockStarted({ blockPath: "implement/auth" });

    expect(event.type).toBe("block:started");
    expect(event.payload).toEqual({ blockPath: "implement/auth" });
    expect(event.timestamp).toBeDefined();
    // Verify it's a valid ISO 8601 timestamp
    expect(new Date(event.timestamp).toISOString()).toBe(event.timestamp);
  });

  it("works with EventStream", async () => {
    type MyEvent =
      | EventEnvelope<"block:started", { blockPath: string }>
      | EventEnvelope<"block:done", { blockPath: string; result: string }>;

    const stream = createEventStream<MyEvent>();
    const blockStarted = defineEvent<"block:started", { blockPath: string }>("block:started");
    const blockDone = defineEvent<"block:done", { blockPath: string; result: string }>("block:done");

    const events = collect(stream.subscribe(), 2);

    stream.emit(blockStarted({ blockPath: "implement/auth" }));
    stream.emit(blockDone({ blockPath: "implement/auth", result: "pass" }));

    const result = await events;
    expect(result).toHaveLength(2);
    expect(result[0]!.type).toBe("block:started");
    expect(result[1]!.type).toBe("block:done");
  });

  it("preserves full type safety via discriminated union", async () => {
    const started = defineEvent<"started", { id: number }>("started");
    const event = started({ id: 42 });

    // TypeScript should narrow these correctly
    expect(event.type).toBe("started");
    expect(event.payload.id).toBe(42);
  });
});
