/**
 * fromJsonl Replay Reader Tests
 *
 * Covers:
 *   - Read JSONL file, verify events match
 *   - Malformed line in JSONL — skipped, other events readable
 *   - Empty file — iteration completes immediately
 *   - follow mode — live tailing of new events appended to file
 *   - keepMeta option — preserve or strip _ts field
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, appendFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fromJsonl } from "../src/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

function makeTmpDir(): string {
  tmpDir = mkdtempSync(join(tmpdir(), "events-replay-"));
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
// One-Shot Read
// ---------------------------------------------------------------------------

describe("fromJsonl — one-shot read", () => {
  it("reads events from a JSONL file", async () => {
    const dir = makeTmpDir();
    const filePath = join(dir, "events.jsonl");

    writeFileSync(filePath, [
      JSON.stringify({ _ts: "2026-04-12T12:00:00.000Z", type: "a", value: 1 }),
      JSON.stringify({ _ts: "2026-04-12T12:00:01.000Z", type: "b", value: 2 }),
      JSON.stringify({ _ts: "2026-04-12T12:00:02.000Z", type: "c", value: 3 }),
    ].join("\n") + "\n");

    const events = await collect(fromJsonl<{ type: string; value: number }>(filePath), 10);

    expect(events).toHaveLength(3);
    expect(events[0]).toEqual({ type: "a", value: 1 });
    expect(events[1]).toEqual({ type: "b", value: 2 });
    expect(events[2]).toEqual({ type: "c", value: 3 });
  });

  it("strips _ts field by default", async () => {
    const dir = makeTmpDir();
    const filePath = join(dir, "events.jsonl");

    writeFileSync(filePath, JSON.stringify({ _ts: "2026-01-01T00:00:00.000Z", type: "x" }) + "\n");

    const events = await collect(fromJsonl(filePath), 1);
    expect(events[0]).toEqual({ type: "x" });
    expect((events[0] as Record<string, unknown>)["_ts"]).toBeUndefined();
  });

  it("keeps _ts field when keepMeta: true", async () => {
    const dir = makeTmpDir();
    const filePath = join(dir, "events.jsonl");

    writeFileSync(filePath, JSON.stringify({ _ts: "2026-01-01T00:00:00.000Z", type: "x" }) + "\n");

    const events = await collect(fromJsonl(filePath, { keepMeta: true }), 1);
    expect((events[0] as Record<string, unknown>)["_ts"]).toBe("2026-01-01T00:00:00.000Z");
  });

  it("skips malformed lines and continues", async () => {
    const dir = makeTmpDir();
    const filePath = join(dir, "events.jsonl");

    writeFileSync(filePath, [
      JSON.stringify({ _ts: "2026-01-01T00:00:00.000Z", type: "a", value: 1 }),
      "this is not json {{{",
      "",
      JSON.stringify({ _ts: "2026-01-01T00:00:01.000Z", type: "b", value: 2 }),
    ].join("\n") + "\n");

    const events = await collect(fromJsonl<{ type: string; value: number }>(filePath), 10);
    expect(events).toHaveLength(2);
    expect(events[0]!.type).toBe("a");
    expect(events[1]!.type).toBe("b");
  });

  it("handles empty file — completes immediately", async () => {
    const dir = makeTmpDir();
    const filePath = join(dir, "events.jsonl");
    writeFileSync(filePath, "");

    const events = await collect(fromJsonl(filePath), 10);
    expect(events).toEqual([]);
  });

  it("handles file with only blank lines", async () => {
    const dir = makeTmpDir();
    const filePath = join(dir, "events.jsonl");
    writeFileSync(filePath, "\n\n\n");

    const events = await collect(fromJsonl(filePath), 10);
    expect(events).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Follow Mode
// ---------------------------------------------------------------------------

describe("fromJsonl — follow mode", () => {
  it("reads initial content then yields new events as they are appended", async () => {
    const dir = makeTmpDir();
    const filePath = join(dir, "events.jsonl");

    // Write initial content
    writeFileSync(filePath, JSON.stringify({ _ts: "2026-01-01T00:00:00.000Z", type: "initial" }) + "\n");

    const received: Array<{ type: string }> = [];
    const iter = fromJsonl<{ type: string }>(filePath, { follow: true });
    const asyncIter = iter[Symbol.asyncIterator]();

    // Read the initial event
    const first = await asyncIter.next();
    expect(first.done).toBe(false);
    received.push(first.value!);

    // Append new events
    await tick(50);
    appendFileSync(filePath, JSON.stringify({ _ts: "2026-01-01T00:00:01.000Z", type: "appended" }) + "\n");

    // Wait for fs.watch to fire
    await tick(200);

    const second = await asyncIter.next();
    expect(second.done).toBe(false);
    received.push(second.value!);

    // Clean up
    await asyncIter.return!();

    expect(received).toHaveLength(2);
    expect(received[0]!.type).toBe("initial");
    expect(received[1]!.type).toBe("appended");
  });

  it("return() stops the follow iterator", async () => {
    const dir = makeTmpDir();
    const filePath = join(dir, "events.jsonl");
    writeFileSync(filePath, JSON.stringify({ _ts: "2026-01-01T00:00:00.000Z", type: "x" }) + "\n");

    const iter = fromJsonl<{ type: string }>(filePath, { follow: true });
    const asyncIter = iter[Symbol.asyncIterator]();

    const first = await asyncIter.next();
    expect(first.done).toBe(false);

    const result = await asyncIter.return!();
    expect(result.done).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Round-trip: write with EventStream.jsonl(), read with fromJsonl()
// ---------------------------------------------------------------------------

describe("fromJsonl — round-trip with EventStream.jsonl()", () => {
  it("events written by jsonl() can be replayed by fromJsonl()", async () => {
    const dir = makeTmpDir();
    const filePath = join(dir, "roundtrip.jsonl");

    // Dynamic import to avoid circular reference concerns
    const { createEventStream } = await import("../src/index.js");

    const stream = createEventStream<{ type: string; value: number }>();
    stream.jsonl(filePath);

    stream.emit({ type: "a", value: 1 });
    stream.emit({ type: "b", value: 2 });
    stream.emit({ type: "c", value: 3 });

    await stream.close();
    await tick(50);

    // Replay
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
