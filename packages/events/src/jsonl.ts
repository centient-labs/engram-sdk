/**
 * JSONL File Subscriber
 *
 * Appends events as newline-delimited JSON to a file. Each event is
 * serialized with a `_ts` field prepended (ISO 8601 timestamp).
 *
 * Writes are buffered and flushed periodically (every 100ms or 100 events).
 * File writes use append mode — safe for concurrent reads (tail -f).
 */

import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import { createComponentLogger } from "@centient/logger";

import type { EventSubscriber } from "./types.js";

const logger = createComponentLogger("centient", "events:jsonl");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FLUSH_INTERVAL_MS = 100;
const FLUSH_BATCH_SIZE = 100;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a JSONL file subscriber and its flush function.
 *
 * @param filePath - Path to the JSONL output file (created/appended)
 * @returns subscriber for use with `tee()`, and a `flush()` to drain the buffer
 */
export function createJsonlSubscriber<T>(filePath: string): {
  subscriber: EventSubscriber<T>;
  flush: () => Promise<void>;
} {
  let buffer: string[] = [];
  let flushTimer: ReturnType<typeof setInterval> | null = null;
  let dirCreated = false;

  // -------------------------------------------------------------------------
  // Flush
  // -------------------------------------------------------------------------

  async function flush(): Promise<void> {
    if (buffer.length === 0) return;

    const lines = buffer;
    buffer = [];

    try {
      if (!dirCreated) {
        await mkdir(dirname(filePath), { recursive: true });
        dirCreated = true;
      }
      await appendFile(filePath, lines.join(""), "utf-8");
    } catch (err) {
      logger.error({ filePath, error: String(err) }, "JSONL write error");
    }
  }

  // -------------------------------------------------------------------------
  // Timer
  // -------------------------------------------------------------------------

  function startTimer(): void {
    if (flushTimer) return;
    flushTimer = setInterval(() => {
      flush().catch((err) => {
        logger.error({ error: String(err) }, "JSONL periodic flush error");
      });
    }, FLUSH_INTERVAL_MS);
    // Unref so the timer doesn't keep the process alive
    if (typeof flushTimer === "object" && "unref" in flushTimer) {
      flushTimer.unref();
    }
  }

  function stopTimer(): void {
    if (flushTimer) {
      clearInterval(flushTimer);
      flushTimer = null;
    }
  }

  // -------------------------------------------------------------------------
  // Subscriber
  // -------------------------------------------------------------------------

  const subscriber: EventSubscriber<T> = {
    name: `jsonl:${filePath}`,

    onEvent(event: T): void {
      const line = JSON.stringify({ _ts: new Date().toISOString(), ...event as object }) + "\n";
      buffer.push(line);
      startTimer();

      // Flush eagerly if batch size reached
      if (buffer.length >= FLUSH_BATCH_SIZE) {
        flush().catch((err) => {
          logger.error({ error: String(err) }, "JSONL batch flush error");
        });
      }
    },

    onError(error: Error): void {
      logger.error({ filePath, error: error.message }, "JSONL subscriber received error");
    },

    onClose(): void {
      stopTimer();
      // Synchronous-safe: schedule final flush (close() awaits the flush promise)
      flush().catch((err) => {
        logger.error({ error: String(err) }, "JSONL final flush error");
      });
    },
  };

  return { subscriber, flush: async () => { stopTimer(); await flush(); } };
}
