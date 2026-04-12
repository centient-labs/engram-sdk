/**
 * Edge-Case Tests for EventStream and JSONL Subscriber
 *
 * Covers:
 *   - Emit before any subscriber exists (events are lost)
 *   - Buffer boundary: bufferSize 1 (only last event survives drop-oldest)
 *   - Buffer boundary: bufferSize 0 (oscillates between 0-1 under drop-oldest)
 *   - Concurrent subscribers with different buffer sizes
 *   - Duplicate tee name overwrites previous subscriber
 *   - onClose throwing does not reject close() or block other subscribers
 *   - Filter that throws does not crash the stream
 *   - Subscriber error without onError handler (no unhandled rejection)
 *   - AsyncIterable return() with pending waiting resolves parked next()
 */

import { describe, it, expect, vi } from "vitest";

import {
  createEventStream,
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
// Emit Before Any Subscriber
// ---------------------------------------------------------------------------

describe("EventStream edge cases", () => {
  describe("emit before any subscriber exists", () => {
    it("events emitted before subscribe are lost; only post-subscribe events are received", async () => {
      const stream = createEventStream<TestEvent>();

      // Emit 3 events with no subscriber attached
      stream.emit({ type: "a", value: 1 });
      stream.emit({ type: "b", value: 2 });
      stream.emit({ type: "c", value: 3 });

      // Now subscribe
      const iter = stream.subscribe();

      // Emit 1 more event
      stream.emit({ type: "d", value: 4 });

      const result = await collect(iter, 1);
      expect(result).toEqual([{ type: "d", value: 4 }]);
    });
  });

  // -------------------------------------------------------------------------
  // Buffer Boundary: bufferSize 1
  // -------------------------------------------------------------------------

  describe("buffer boundary: bufferSize 1", () => {
    it("only the last event survives under drop-oldest when buffer is 1", async () => {
      const stream = createEventStream<TestEvent>({
        backpressure: "drop-oldest",
        defaultBufferSize: 1,
      });
      const iter = stream.subscribe();

      // Emit 3 events before consuming — buffer holds 1, so only the last survives
      stream.emit({ type: "a", value: 1 });
      stream.emit({ type: "b", value: 2 });
      stream.emit({ type: "c", value: 3 });

      const result = await collect(iter, 1);
      expect(result).toEqual([{ type: "c", value: 3 }]);
    });
  });

  // -------------------------------------------------------------------------
  // Buffer Boundary: bufferSize 0
  // -------------------------------------------------------------------------

  describe("buffer boundary: bufferSize 0", () => {
    it("oscillates between 0-1 under drop-oldest since shift on empty is a no-op", async () => {
      const stream = createEventStream<TestEvent>({
        backpressure: "drop-oldest",
        defaultBufferSize: 0,
      });
      const iter = stream.subscribe();

      // With bufferSize 0: `buffer.length < bufferSize` is `0 < 0` which is false.
      // So every emit hits the backpressure path: shift() (no-op on empty) + push().
      // This means buffer oscillates at size 0-1. The last event should survive.
      stream.emit({ type: "a", value: 1 });
      stream.emit({ type: "b", value: 2 });
      stream.emit({ type: "c", value: 3 });

      const result = await collect(iter, 1);
      // The buffer ends up with the last event because shift+push on a single-element
      // array replaces the element each time.
      expect(result).toEqual([{ type: "c", value: 3 }]);
    });
  });

  // -------------------------------------------------------------------------
  // Concurrent Subscribers with Different Buffer Sizes
  // -------------------------------------------------------------------------

  describe("concurrent subscribers with different buffer sizes", () => {
    it("each subscriber retains the correct tail of events under drop-oldest", async () => {
      const stream = createEventStream<TestEvent>({
        backpressure: "drop-oldest",
        defaultBufferSize: 1000,
      });

      const iterSmall = stream.subscribe({ bufferSize: 2 });
      const iterLarge = stream.subscribe({ bufferSize: 5 });

      // Emit 10 events before consuming
      for (let i = 1; i <= 10; i++) {
        stream.emit({ type: "e", value: i });
      }

      const resultSmall = await collect(iterSmall, 2);
      const resultLarge = await collect(iterLarge, 5);

      // bufferSize 2 should have the last 2 events
      expect(resultSmall).toEqual([
        { type: "e", value: 9 },
        { type: "e", value: 10 },
      ]);

      // bufferSize 5 should have the last 5 events
      expect(resultLarge).toEqual([
        { type: "e", value: 6 },
        { type: "e", value: 7 },
        { type: "e", value: 8 },
        { type: "e", value: 9 },
        { type: "e", value: 10 },
      ]);
    });
  });

  // -------------------------------------------------------------------------
  // Duplicate tee Name Overwrites
  // -------------------------------------------------------------------------

  describe("duplicate tee name overwrites", () => {
    it("second tee with same name replaces the first; only the second receives events", () => {
      const stream = createEventStream<TestEvent>();
      const eventsA: TestEvent[] = [];
      const eventsB: TestEvent[] = [];

      stream.tee("dup", {
        name: "dup",
        onEvent: (e) => { eventsA.push(e); },
      });

      stream.tee("dup", {
        name: "dup",
        onEvent: (e) => { eventsB.push(e); },
      });

      stream.emit({ type: "x", value: 42 });

      expect(eventsA).toEqual([]);
      expect(eventsB).toEqual([{ type: "x", value: 42 }]);
    });
  });

  // -------------------------------------------------------------------------
  // onClose Throwing
  // -------------------------------------------------------------------------

  describe("onClose throwing", () => {
    it("close() resolves even when a subscriber onClose throws; other subscribers still fire", async () => {
      const stream = createEventStream<TestEvent>();
      const onCloseGood = vi.fn();

      stream.tee("bad-close", {
        name: "bad-close",
        onEvent: () => {},
        onClose: () => { throw new Error("onClose boom"); },
      });

      stream.tee("good-close", {
        name: "good-close",
        onEvent: () => {},
        onClose: onCloseGood,
      });

      // close() should not reject
      await expect(stream.close()).resolves.toBeUndefined();

      // The good subscriber's onClose should still have been called
      expect(onCloseGood).toHaveBeenCalledOnce();
    });
  });

  // -------------------------------------------------------------------------
  // Filter That Throws
  // -------------------------------------------------------------------------

  describe("filter that throws", () => {
    it("does not crash the stream; other subscribers continue receiving events", async () => {
      const stream = createEventStream<TestEvent>();

      // Subscriber with a filter that throws
      const badIter = stream.subscribe({
        filter: () => { throw new Error("filter boom"); },
      });

      // Good subscriber
      const goodIter = stream.subscribe();

      stream.emit({ type: "a", value: 1 });
      stream.emit({ type: "b", value: 2 });

      const goodResult = await collect(goodIter, 2);
      expect(goodResult).toEqual([
        { type: "a", value: 1 },
        { type: "b", value: 2 },
      ]);

      // Clean up the bad iterator
      const asyncBadIter = badIter[Symbol.asyncIterator]();
      await asyncBadIter.return?.();

      await stream.close();
    });
  });

  // -------------------------------------------------------------------------
  // Subscriber Error Without onError
  // -------------------------------------------------------------------------

  describe("subscriber error without onError", () => {
    it("tee subscriber with no onError whose onEvent throws does not cause unhandled rejection", async () => {
      const stream = createEventStream<TestEvent>();

      // Subscriber with no onError callback
      stream.tee("no-onerror", {
        name: "no-onerror",
        onEvent: () => { throw new Error("onEvent boom"); },
        // Note: no onError callback provided
      });

      // Should not throw
      expect(() => stream.emit({ type: "a", value: 1 })).not.toThrow();

      // Give time for any async error propagation
      await tick(50);

      // Stream should still be functional
      const events: TestEvent[] = [];
      stream.tee("good", {
        name: "good",
        onEvent: (e) => { events.push(e); },
      });

      stream.emit({ type: "b", value: 2 });
      expect(events).toEqual([{ type: "b", value: 2 }]);

      await stream.close();
    });
  });

  // -------------------------------------------------------------------------
  // AsyncIterable return() with Pending Waiting
  // -------------------------------------------------------------------------

  describe("AsyncIterable return() with pending waiting", () => {
    it("parked next() resolves with { done: true } when return() is called", async () => {
      const stream = createEventStream<TestEvent>();
      const iter = stream.subscribe();
      const asyncIter = iter[Symbol.asyncIterator]();

      // Call next() to park the consumer waiting (no events in buffer)
      const pendingNext = asyncIter.next();

      // Call return() from another async context
      await tick();
      await asyncIter.return?.();

      // The parked next() should resolve with done: true
      const result = await pendingNext;
      expect(result.done).toBe(true);
    });
  });
});
