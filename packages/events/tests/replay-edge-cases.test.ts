/**
 * Replay Reader Edge-Case Tests
 *
 * Covers:
 *   - File not found — fromJsonl rejects with an error
 *   - File truncation in follow mode — reader resets and yields new events
 *   - return() while follow iterator is waiting — resolves cleanly
 *   - Multiple rapid appends in follow mode — all events eventually yielded
 *   - Round-trip without extra tick — close() properly awaits flush
 *   - keepMeta preserves all fields including _ts
 */

import { describe, it, expect, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  appendFileSync,
  truncateSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createEventStream,
  fromJsonl,
} from "../src/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

function makeTmpDir(): string {
  tmpDir = mkdtempSync(join(tmpdir(), "events-replay-edge-"));
  return tmpDir;
}

function tick(ms = 20): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function collect<T>(iter: AsyncIterable<T>, limit: number): Promise<T[]> {
  const results: T[] = [];
  for await (const event of iter) {
    results.push(event);
    if (results.length >= limit) break;
  }
  return results;
}

afterEach(() => {
  if (tmpDir) {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// File Not Found
// ---------------------------------------------------------------------------

describe("fromJsonl — file not found", () => {
  it("rejects when the file does not exist", async () => {
    const dir = makeTmpDir();
    const filePath = join(dir, "nonexistent.jsonl");

    const iter = fromJsonl(filePath);
    let caughtError: Error | null = null;

    try {
      for await (const _event of iter) {
        // Should not yield any events
      }
    } catch (err) {
      caughtError = err instanceof Error ? err : new Error(String(err));
    }

    expect(caughtError).not.toBeNull();
    expect(caughtError!.message).toMatch(/ENOENT/);
  });
});

// ---------------------------------------------------------------------------
// File Truncation in Follow Mode
// ---------------------------------------------------------------------------

describe("fromJsonl — file truncation in follow mode", () => {
  it("resets offset and yields new events after file is truncated", async () => {
    const dir = makeTmpDir();
    const filePath = join(dir, "truncate.jsonl");

    // Write initial events
    writeFileSync(filePath, [
      JSON.stringify({ _ts: "2026-01-01T00:00:00.000Z", type: "initial", value: 1 }),
      JSON.stringify({ _ts: "2026-01-01T00:00:01.000Z", type: "initial", value: 2 }),
    ].join("\n") + "\n");

    const received: Array<{ type: string; value: number }> = [];
    const iter = fromJsonl<{ type: string; value: number }>(filePath, { follow: true });
    const asyncIter = iter[Symbol.asyncIterator]();

    // Read the 2 initial events
    const first = await asyncIter.next();
    expect(first.done).toBe(false);
    received.push(first.value!);

    const second = await asyncIter.next();
    expect(second.done).toBe(false);
    received.push(second.value!);

    // Truncate the file
    await tick(50);
    truncateSync(filePath, 0);
    await tick(50);

    // Append new events after truncation
    appendFileSync(filePath, JSON.stringify({ _ts: "2026-01-01T00:01:00.000Z", type: "after-truncate", value: 99 }) + "\n");
    await tick(300);

    const third = await asyncIter.next();
    expect(third.done).toBe(false);
    received.push(third.value!);

    // Clean up
    await asyncIter.return!();

    expect(received).toHaveLength(3);
    expect(received[0]!.type).toBe("initial");
    expect(received[1]!.type).toBe("initial");
    expect(received[2]!.type).toBe("after-truncate");
    expect(received[2]!.value).toBe(99);
  });
});

// ---------------------------------------------------------------------------
// return() While Follow Iterator is Waiting
// ---------------------------------------------------------------------------

describe("fromJsonl — return() while follow iterator is waiting", () => {
  it("resolves cleanly when return() is called while next() is parked", async () => {
    const dir = makeTmpDir();
    const filePath = join(dir, "follow-return.jsonl");
    writeFileSync(filePath, JSON.stringify({ _ts: "2026-01-01T00:00:00.000Z", type: "x" }) + "\n");

    const iter = fromJsonl<{ type: string }>(filePath, { follow: true });
    const asyncIter = iter[Symbol.asyncIterator]();

    // Consume the initial event
    const first = await asyncIter.next();
    expect(first.done).toBe(false);

    // Park a next() call — no more data to read
    const pendingNext = asyncIter.next();

    // Call return() to stop the iterator
    await tick();
    const returnResult = await asyncIter.return!();
    expect(returnResult.done).toBe(true);

    // The parked next() should also resolve with done: true
    const result = await pendingNext;
    expect(result.done).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Multiple Rapid Appends in Follow Mode
// ---------------------------------------------------------------------------

describe("fromJsonl — multiple rapid appends in follow mode", () => {
  it("yields all events from rapid successive appends", async () => {
    const dir = makeTmpDir();
    const filePath = join(dir, "rapid.jsonl");
    writeFileSync(filePath, "");

    const iter = fromJsonl<{ type: string; value: number }>(filePath, { follow: true });
    const asyncIter = iter[Symbol.asyncIterator]();

    // Allow the follow reader to initialize and attach the watcher
    await tick(50);

    // Append 5 events rapidly without ticking between them
    for (let i = 1; i <= 5; i++) {
      appendFileSync(filePath, JSON.stringify({ _ts: `2026-01-01T00:00:0${i}.000Z`, type: "rapid", value: i }) + "\n");
    }

    // Wait for the watcher to fire and process all events
    await tick(300);

    // Collect all 5 events
    const received: Array<{ type: string; value: number }> = [];
    for (let i = 0; i < 5; i++) {
      const result = await asyncIter.next();
      expect(result.done).toBe(false);
      received.push(result.value!);
    }

    await asyncIter.return!();

    expect(received).toHaveLength(5);
    for (let i = 0; i < 5; i++) {
      expect(received[i]!.value).toBe(i + 1);
    }
  });
});

// ---------------------------------------------------------------------------
// Round-trip Without Extra Tick
// ---------------------------------------------------------------------------

describe("fromJsonl — round-trip without extra tick", () => {
  it("events written via stream.jsonl() can be read immediately after close() (no tick)", async () => {
    const dir = makeTmpDir();
    const filePath = join(dir, "roundtrip-notick.jsonl");

    const stream = createEventStream<{ type: string; value: number }>();
    stream.jsonl(filePath);

    stream.emit({ type: "a", value: 1 });
    stream.emit({ type: "b", value: 2 });
    stream.emit({ type: "c", value: 3 });

    // close() should await flush — no tick needed after this
    await stream.close();

    // Read immediately
    const events = await collect(
      fromJsonl<{ type: string; value: number }>(filePath),
      10,
    );

    expect(events).toHaveLength(3);
    expect(events[0]).toEqual({ type: "a", value: 1 });
    expect(events[1]).toEqual({ type: "b", value: 2 });
    expect(events[2]).toEqual({ type: "c", value: 3 });
  });
});

// ---------------------------------------------------------------------------
// keepMeta Preserves All Fields
// ---------------------------------------------------------------------------

describe("fromJsonl — keepMeta preserves all fields", () => {
  it("includes _ts and all other fields when keepMeta is true", async () => {
    const dir = makeTmpDir();
    const filePath = join(dir, "keepmeta.jsonl");

    const ts = "2026-04-12T10:30:00.000Z";

    writeFileSync(filePath, [
      JSON.stringify({ _ts: ts, type: "a", value: 1, extra: "hello" }),
      JSON.stringify({ _ts: ts, type: "b", value: 2, nested: { key: "val" } }),
    ].join("\n") + "\n");

    const events = await collect(
      fromJsonl<Record<string, unknown>>(filePath, { keepMeta: true }),
      10,
    );

    expect(events).toHaveLength(2);

    // First event: _ts should be present and correct
    expect(events[0]!["_ts"]).toBe(ts);
    expect(events[0]!["type"]).toBe("a");
    expect(events[0]!["value"]).toBe(1);
    expect(events[0]!["extra"]).toBe("hello");

    // Second event: _ts should be present; nested fields preserved
    expect(events[1]!["_ts"]).toBe(ts);
    expect(events[1]!["type"]).toBe("b");
    expect(events[1]!["value"]).toBe(2);
    expect(events[1]!["nested"]).toEqual({ key: "val" });
  });
});
