/**
 * Subscribe Filter Tests
 *
 * Covers:
 *   - Subscribe with filter, only matching events received
 *   - Filtered events don't consume buffer space
 *   - Filter with multiple subscribers (independent filters)
 *   - No filter (default) — all events delivered
 */

import { describe, it, expect } from "vitest";

import { createEventStream } from "../src/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface TestEvent {
  type: string;
  value: number;
}

async function collect<T>(iter: AsyncIterable<T>, limit: number): Promise<T[]> {
  const results: T[] = [];
  for await (const event of iter) {
    results.push(event);
    if (results.length >= limit) break;
  }
  return results;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("subscribe with filter", () => {
  it("delivers only events matching the filter predicate", async () => {
    const stream = createEventStream<TestEvent>();
    const events = collect(
      stream.subscribe({
        filter: (e) => e.type === "a",
      }),
      2,
    );

    stream.emit({ type: "a", value: 1 });
    stream.emit({ type: "b", value: 2 });
    stream.emit({ type: "a", value: 3 });
    stream.emit({ type: "c", value: 4 });

    const result = await events;
    expect(result).toEqual([
      { type: "a", value: 1 },
      { type: "a", value: 3 },
    ]);
  });

  it("filtered events do not consume buffer space", async () => {
    const stream = createEventStream<TestEvent>({
      backpressure: "drop-oldest",
      defaultBufferSize: 100,
    });

    // Subscribe with filter that passes ~50 of 2000 events
    const iter = stream.subscribe({
      bufferSize: 100,
      filter: (e) => e.value % 40 === 0,
    });

    // Emit 2000 events — only 50 pass the filter (values 0, 40, 80, ..., 1960)
    for (let i = 0; i < 2000; i++) {
      stream.emit({ type: "e", value: i });
    }

    // All 50 matching events should be in the buffer (buffer size is 100)
    const result = await collect(iter, 50);
    expect(result).toHaveLength(50);
    // First match should be 0 (not dropped by backpressure)
    expect(result[0]).toEqual({ type: "e", value: 0 });
    // Last match should be 1960
    expect(result[49]).toEqual({ type: "e", value: 1960 });
  });

  it("different subscribers can have independent filters", async () => {
    const stream = createEventStream<TestEvent>();

    const typeA = collect(
      stream.subscribe({ filter: (e) => e.type === "a" }),
      2,
    );
    const typeB = collect(
      stream.subscribe({ filter: (e) => e.type === "b" }),
      1,
    );

    stream.emit({ type: "a", value: 1 });
    stream.emit({ type: "b", value: 2 });
    stream.emit({ type: "a", value: 3 });

    const [resultA, resultB] = await Promise.all([typeA, typeB]);
    expect(resultA).toEqual([
      { type: "a", value: 1 },
      { type: "a", value: 3 },
    ]);
    expect(resultB).toEqual([
      { type: "b", value: 2 },
    ]);
  });

  it("subscriber without filter receives all events (default behavior)", async () => {
    const stream = createEventStream<TestEvent>();

    const filtered = collect(
      stream.subscribe({ filter: (e) => e.type === "a" }),
      1,
    );
    const unfiltered = collect(stream.subscribe(), 3);

    stream.emit({ type: "a", value: 1 });
    stream.emit({ type: "b", value: 2 });
    stream.emit({ type: "c", value: 3 });

    const [fResult, uResult] = await Promise.all([filtered, unfiltered]);
    expect(fResult).toEqual([{ type: "a", value: 1 }]);
    expect(uResult).toHaveLength(3);
  });

  it("filter that rejects everything yields no events before close", async () => {
    const stream = createEventStream<TestEvent>();
    const events: TestEvent[] = [];

    const consumer = (async () => {
      for await (const event of stream.subscribe({ filter: () => false })) {
        events.push(event);
      }
    })();

    stream.emit({ type: "a", value: 1 });
    stream.emit({ type: "b", value: 2 });
    await stream.close();
    await consumer;

    expect(events).toEqual([]);
  });
});
