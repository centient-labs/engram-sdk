/**
 * EventStream Core Implementation
 *
 * Generic event stream with fan-out to multiple subscribers.
 * Supports both AsyncIterable (for-await-of) and callback-based
 * subscribers. Per-subscriber bounded buffers with configurable
 * backpressure policy.
 *
 * Lifecycle:
 * 1. Create a stream via `createEventStream<T>()`
 * 2. Attach subscribers via `subscribe()` or `tee()`
 * 3. Emit events via `emit()` — delivered to all subscribers
 * 4. Call `close()` to flush, signal completion, and clean up
 */

import { createComponentLogger } from "@centient/logger";

import type {
  EventStream,
  EventStreamOptions,
  EventSubscriber,
  SubscribeOptions,
  BackpressurePolicy,
} from "./types.js";
import { createJsonlSubscriber } from "./jsonl.js";

const logger = createComponentLogger("centient", "events");

// ---------------------------------------------------------------------------
// Internal Types
// ---------------------------------------------------------------------------

/** Resolve/value pair buffered for an AsyncIterable subscriber. */
interface BufferedItem<T> {
  value: T;
}

/** State for an AsyncIterable subscriber. */
interface IterableSubscriber<T> {
  buffer: BufferedItem<T>[];
  bufferSize: number;
  /** Resolve function for the pending next() call, if the consumer is waiting. */
  waiting: ((result: IteratorResult<T>) => void) | null;
  closed: boolean;
  /** Optional filter — only events passing this predicate are delivered. */
  filter?: (event: T) => boolean;
}

/** State for a tee'd (callback-based) subscriber. */
interface TeeSubscriber<T> {
  name: string;
  subscriber: EventSubscriber<T>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a new EventStream.
 *
 * @param opts - Stream options (backpressure policy, default buffer size)
 * @returns A typed EventStream instance
 */
export function createEventStream<T>(opts?: EventStreamOptions): EventStream<T> {
  const backpressure: BackpressurePolicy = opts?.backpressure ?? "drop-oldest";
  const defaultBufferSize = opts?.defaultBufferSize ?? 1000;

  const iterableSubs = new Set<IterableSubscriber<T>>();
  const teeSubs = new Map<string, TeeSubscriber<T>>();
  /** JSONL dispose functions keyed by file path for cleanup on close. */
  const jsonlDisposers = new Map<string, () => Promise<void>>();
  let closed = false;

  // -------------------------------------------------------------------------
  // Emit
  // -------------------------------------------------------------------------

  function emit(event: T): void {
    if (closed) {
      logger.warn("emit() called on closed stream — event dropped");
      return;
    }

    // Deliver to AsyncIterable subscribers
    for (const sub of iterableSubs) {
      if (sub.filter && !sub.filter(event)) continue;
      deliverToIterable(sub, event, backpressure);
    }

    // Deliver to tee'd subscribers (fire-and-forget for async)
    for (const [, teeSub] of teeSubs) {
      deliverToTee(teeSub, event);
    }
  }

  // -------------------------------------------------------------------------
  // Subscribe (AsyncIterable)
  // -------------------------------------------------------------------------

  function subscribe(subOpts?: SubscribeOptions<T>): AsyncIterable<T> {
    if (closed) {
      // Return an immediately-done iterable
      return {
        [Symbol.asyncIterator]() {
          return {
            async next() {
              return { done: true, value: undefined };
            },
          };
        },
      };
    }

    const bufferSize = subOpts?.bufferSize ?? defaultBufferSize;
    const sub: IterableSubscriber<T> = {
      buffer: [],
      bufferSize,
      waiting: null,
      closed: false,
      filter: subOpts?.filter,
    };
    iterableSubs.add(sub);

    return {
      [Symbol.asyncIterator](): AsyncIterator<T> {
        return {
          next(): Promise<IteratorResult<T>> {
            // If there's a buffered item, return it immediately
            const item = sub.buffer.shift();
            if (item) {
              return Promise.resolve({ done: false, value: item.value });
            }

            // If the stream is closed and buffer is empty, we're done
            if (sub.closed) {
              iterableSubs.delete(sub);
              return Promise.resolve({ done: true, value: undefined });
            }

            // Otherwise, wait for the next event
            return new Promise<IteratorResult<T>>((resolve) => {
              sub.waiting = resolve;
            });
          },

          return(): Promise<IteratorResult<T>> {
            sub.closed = true;
            sub.waiting = null;
            iterableSubs.delete(sub);
            return Promise.resolve({ done: true, value: undefined });
          },
        };
      },
    };
  }

  // -------------------------------------------------------------------------
  // Tee (callback-based)
  // -------------------------------------------------------------------------

  function tee(name: string, subscriber: EventSubscriber<T>): () => void {
    if (closed) {
      logger.warn(`tee() called on closed stream — subscriber '${name}' not added`);
      return () => {};
    }

    teeSubs.set(name, { name, subscriber });
    logger.debug(`subscriber '${name}' added via tee()`);

    return () => {
      teeSubs.delete(name);
      logger.debug(`subscriber '${name}' removed`);
    };
  }

  // -------------------------------------------------------------------------
  // JSONL
  // -------------------------------------------------------------------------

  function jsonl(filePath: string): () => void {
    const { subscriber, flush } = createJsonlSubscriber<T>(filePath);
    const dispose = tee(`jsonl:${filePath}`, subscriber);
    jsonlDisposers.set(filePath, flush);

    return () => {
      dispose();
      jsonlDisposers.delete(filePath);
    };
  }

  // -------------------------------------------------------------------------
  // Close
  // -------------------------------------------------------------------------

  async function close(): Promise<void> {
    if (closed) return;
    closed = true;

    // Flush all JSONL buffers
    const flushPromises = Array.from(jsonlDisposers.values()).map((flush) =>
      flush().catch((err) => {
        logger.error({ error: String(err) }, "JSONL flush error on close");
      }),
    );
    await Promise.all(flushPromises);
    jsonlDisposers.clear();

    // Signal completion to all AsyncIterable subscribers
    for (const sub of iterableSubs) {
      sub.closed = true;
      if (sub.waiting) {
        sub.waiting({ done: true, value: undefined });
        sub.waiting = null;
      }
    }
    iterableSubs.clear();

    // Notify tee'd subscribers
    for (const [, teeSub] of teeSubs) {
      try {
        teeSub.subscriber.onClose?.();
      } catch (err) {
        logger.error({ error: String(err) }, `onClose error in subscriber '${teeSub.name}'`);
      }
    }

    teeSubs.clear();
    logger.debug("stream closed");
  }

  // -------------------------------------------------------------------------
  // Public Interface
  // -------------------------------------------------------------------------

  return {
    emit,
    subscribe,
    tee,
    jsonl,
    get subscriberCount() {
      return iterableSubs.size + teeSubs.size;
    },
    close,
  };
}

// ---------------------------------------------------------------------------
// Internal Helpers
// ---------------------------------------------------------------------------

/** Deliver an event to an AsyncIterable subscriber, respecting backpressure. */
function deliverToIterable<T>(
  sub: IterableSubscriber<T>,
  event: T,
  policy: BackpressurePolicy,
): void {
  // If the consumer is waiting, resolve immediately (no buffering needed)
  if (sub.waiting) {
    const resolve = sub.waiting;
    sub.waiting = null;
    resolve({ done: false, value: event });
    return;
  }

  // Buffer the event
  if (sub.buffer.length < sub.bufferSize) {
    sub.buffer.push({ value: event });
    return;
  }

  // Buffer is full — apply backpressure policy
  switch (policy) {
    case "drop-oldest":
      sub.buffer.shift();
      sub.buffer.push({ value: event });
      break;
    case "drop-newest":
      // New event is dropped — buffer stays intact
      break;
    case "block":
      // For "block" policy in a sync emit, we can't truly block.
      // We add to the buffer beyond the limit. The consumer drains it.
      // This is the best we can do without making emit() async.
      sub.buffer.push({ value: event });
      break;
  }
}

/** Deliver an event to a tee'd subscriber. Errors are isolated. */
function deliverToTee<T>(teeSub: TeeSubscriber<T>, event: T): void {
  try {
    const result = teeSub.subscriber.onEvent(event);
    // If onEvent returns a Promise, catch errors from it
    if (result && typeof result === "object" && "catch" in result) {
      (result as Promise<void>).catch((err) => {
        handleTeeError(teeSub, err);
      });
    }
  } catch (err) {
    handleTeeError(teeSub, err);
  }
}

/** Forward an error to a tee'd subscriber's onError callback. */
function handleTeeError<T>(teeSub: TeeSubscriber<T>, err: unknown): void {
  const error = err instanceof Error ? err : new Error(String(err));
  logger.error({ error: error.message }, `subscriber '${teeSub.name}' onEvent error`);
  try {
    teeSub.subscriber.onError?.(error);
  } catch (onErrorErr) {
    logger.error(
      { error: String(onErrorErr) },
      `subscriber '${teeSub.name}' onError handler threw`,
    );
  }
}
