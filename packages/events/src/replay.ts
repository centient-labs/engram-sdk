/**
 * JSONL Replay Reader
 *
 * Reads events from a JSONL file as an AsyncIterable, enabling replay
 * of persisted event logs. Supports both one-shot reads and live
 * tailing (follow mode) for real-time consumption.
 *
 * Usage:
 *   // Read completed file
 *   for await (const event of fromJsonl<MyEvent>("/path/to/events.jsonl")) { ... }
 *
 *   // Live tail (like tail -f)
 *   for await (const event of fromJsonl<MyEvent>("/path/to/events.jsonl", { follow: true })) { ... }
 */

import { createReadStream, type ReadStream } from "node:fs";
import { createInterface, type Interface as ReadlineInterface } from "node:readline";
import { watch, type FSWatcher } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";

import { createComponentLogger } from "@centient/logger";

const logger = createComponentLogger("centient", "events:replay");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Options for `fromJsonl()`. */
export interface FromJsonlOptions {
  /**
   * If true, continue watching for new lines after reaching EOF (like tail -f).
   * Default: false (read to EOF then complete).
   */
  follow?: boolean;
  /**
   * If true, keep the `_ts` metadata field in emitted events.
   * Default: false (strip `_ts` before yielding).
   */
  keepMeta?: boolean;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Read events from a JSONL file as an AsyncIterable.
 * Enables replay of persisted event logs written by `EventStream.jsonl()`.
 *
 * @param path - Path to the JSONL file
 * @param opts - Options (follow mode for live tailing, keepMeta to preserve `_ts`)
 * @returns AsyncIterable that yields parsed events
 */
export function fromJsonl<T>(path: string, opts?: FromJsonlOptions): AsyncIterable<T> {
  const follow = opts?.follow ?? false;
  const keepMeta = opts?.keepMeta ?? false;

  return {
    [Symbol.asyncIterator](): AsyncIterator<T> {
      if (follow) {
        return createFollowIterator<T>(path, keepMeta);
      }
      return createOneShotIterator<T>(path, keepMeta);
    },
  };
}

// ---------------------------------------------------------------------------
// One-Shot Reader (read to EOF, then done)
// ---------------------------------------------------------------------------

function createOneShotIterator<T>(path: string, keepMeta: boolean): AsyncIterator<T> {
  let stream: ReadStream | null = null;
  let rl: ReadlineInterface | null = null;
  const buffer: T[] = [];
  let done = false;
  let waiting: ((result: IteratorResult<T>) => void) | null = null;

  function init(): void {
    stream = createReadStream(path, { encoding: "utf-8" });
    rl = createInterface({ input: stream, crlfDelay: Infinity });

    rl.on("line", (line: string) => {
      const parsed = parseLine<T>(line, keepMeta);
      if (parsed === null) return;

      if (waiting) {
        const resolve = waiting;
        waiting = null;
        resolve({ done: false, value: parsed });
      } else {
        buffer.push(parsed);
      }
    });

    rl.on("close", () => {
      done = true;
      if (waiting) {
        const resolve = waiting;
        waiting = null;
        resolve({ done: true, value: undefined });
      }
    });

    rl.on("error", (err: Error) => {
      logger.error({ error: err.message }, "JSONL readline error");
      done = true;
      if (waiting) {
        const resolve = waiting;
        waiting = null;
        resolve({ done: true, value: undefined });
      }
    });

    stream.on("error", (err: Error) => {
      logger.error({ error: err.message }, "JSONL read stream error");
      done = true;
      if (waiting) {
        const resolve = waiting;
        waiting = null;
        resolve({ done: true, value: undefined });
      }
    });
  }

  return {
    next(): Promise<IteratorResult<T>> {
      if (!rl) init();

      // Return buffered item if available
      if (buffer.length > 0) {
        return Promise.resolve({ done: false, value: buffer.shift()! });
      }

      // If we've finished reading, signal done
      if (done) {
        return Promise.resolve({ done: true, value: undefined });
      }

      // Wait for the next line
      return new Promise<IteratorResult<T>>((resolve) => {
        waiting = resolve;
      });
    },

    return(): Promise<IteratorResult<T>> {
      cleanup(rl, stream, null);
      rl = null;
      stream = null;
      done = true;
      if (waiting) {
        const resolve = waiting;
        waiting = null;
        resolve({ done: true, value: undefined });
      }
      return Promise.resolve({ done: true, value: undefined });
    },
  };
}

// ---------------------------------------------------------------------------
// Follow Reader (tail -f mode)
// ---------------------------------------------------------------------------

function createFollowIterator<T>(path: string, keepMeta: boolean): AsyncIterator<T> {
  let fh: FileHandle | null = null;
  let watcher: FSWatcher | null = null;
  let offset = 0;
  let remainder = "";
  const buffer: T[] = [];
  let closed = false;
  let waiting: ((result: IteratorResult<T>) => void) | null = null;
  let initialized = false;

  async function init(): Promise<void> {
    if (initialized) return;
    initialized = true;

    fh = await open(path, "r");

    // Read initial content
    await readNewContent();

    // Watch for changes
    watcher = watch(path, () => {
      readNewContent().catch((err) => {
        logger.error({ error: String(err) }, "follow mode read error");
      });
    });
    watcher.unref();
  }

  async function readNewContent(): Promise<void> {
    if (!fh || closed) return;

    const stat = await fh.stat();
    if (stat.size <= offset) return;

    const readSize = stat.size - offset;
    const buf = Buffer.alloc(readSize);
    const { bytesRead } = await fh.read(buf, 0, readSize, offset);
    offset += bytesRead;

    const text = remainder + buf.toString("utf-8", 0, bytesRead);
    const lines = text.split("\n");

    // Last element may be incomplete — save for next read
    remainder = lines.pop() ?? "";

    for (const line of lines) {
      if (line.trim() === "") continue;
      const parsed = parseLine<T>(line, keepMeta);
      if (parsed === null) continue;

      if (waiting) {
        const resolve = waiting;
        waiting = null;
        resolve({ done: false, value: parsed });
      } else {
        buffer.push(parsed);
      }
    }
  }

  return {
    async next(): Promise<IteratorResult<T>> {
      await init();

      // Return buffered item if available
      if (buffer.length > 0) {
        return { done: false, value: buffer.shift()! };
      }

      if (closed) {
        return { done: true, value: undefined };
      }

      // Wait for the next event from the file watcher
      return new Promise<IteratorResult<T>>((resolve) => {
        waiting = resolve;
      });
    },

    async return(): Promise<IteratorResult<T>> {
      closed = true;
      if (watcher) {
        watcher.close();
        watcher = null;
      }
      if (fh) {
        await fh.close();
        fh = null;
      }
      if (waiting) {
        const resolve = waiting;
        waiting = null;
        resolve({ done: true, value: undefined });
      }
      return { done: true, value: undefined };
    },
  };
}

// ---------------------------------------------------------------------------
// Shared Helpers
// ---------------------------------------------------------------------------

/** Parse a JSONL line, optionally stripping the `_ts` metadata field. */
function parseLine<T>(line: string, keepMeta: boolean): T | null {
  const trimmed = line.trim();
  if (trimmed === "") return null;

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (!keepMeta && "_ts" in parsed) {
      delete parsed["_ts"];
    }
    return parsed as T;
  } catch {
    logger.warn("skipping malformed JSONL line");
    return null;
  }
}

/** Clean up readline, stream, and watcher resources. */
function cleanup(
  rl: ReadlineInterface | null,
  stream: ReadStream | null,
  watcher: FSWatcher | null,
): void {
  try { rl?.close(); } catch { /* ignore */ }
  try { stream?.destroy(); } catch { /* ignore */ }
  try { watcher?.close(); } catch { /* ignore */ }
}
