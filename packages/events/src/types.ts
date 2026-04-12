/**
 * Event Streaming Type Definitions
 *
 * Types for the typed event streaming library. Generic over the event
 * type — consumers define their own event shapes; this package provides
 * the streaming infrastructure.
 */

// ---------------------------------------------------------------------------
// Backpressure
// ---------------------------------------------------------------------------

/** Policy applied when a subscriber's buffer is full. */
export type BackpressurePolicy =
  | "drop-oldest"  // Drop oldest buffered event, add new one (default)
  | "drop-newest"  // Reject new event, keep buffer intact
  | "block";       // Block emit() until buffer has space (use carefully)

// ---------------------------------------------------------------------------
// Subscribe Options
// ---------------------------------------------------------------------------

/** Options for `subscribe()`. Generic over the stream's event type. */
export interface SubscribeOptions<T = unknown> {
  /**
   * Buffer size for this subscriber (events queued if consumer is slow).
   * Default: inherited from EventStreamOptions.defaultBufferSize (1000).
   * When buffer is full, the stream-level backpressure policy applies.
   */
  bufferSize?: number;
  /**
   * Optional filter — only events passing this predicate are delivered
   * to this subscriber. Runs synchronously before buffering. Filtered-out
   * events never enter the buffer.
   */
  filter?: (event: T) => boolean;
}

// ---------------------------------------------------------------------------
// Event Subscriber (callback-based)
// ---------------------------------------------------------------------------

/** Callback-based subscriber attached via `tee()`. */
export interface EventSubscriber<T> {
  /** Subscriber name (used for logging and diagnostics). */
  name: string;
  /** Called for each emitted event. May be async. */
  onEvent(event: T): void | Promise<void>;
  /** Called when a subscriber-side error occurs. */
  onError?(error: Error): void;
  /** Called when the stream closes. */
  onClose?(): void;
}

// ---------------------------------------------------------------------------
// Event Stream
// ---------------------------------------------------------------------------

/** Options for `createEventStream()`. */
export interface EventStreamOptions {
  /** Backpressure policy when a subscriber's buffer is full. Default: 'drop-oldest'. */
  backpressure?: BackpressurePolicy;
  /** Default buffer size for subscribers. Default: 1000. */
  defaultBufferSize?: number;
}

/** The primary event streaming abstraction. Generic over event type T. */
export interface EventStream<T> {
  /** Emit an event to all subscribers. */
  emit(event: T): void;

  /** Subscribe to the event stream (AsyncIterable for async-for-of consumption). */
  subscribe(opts?: SubscribeOptions<T>): AsyncIterable<T>;

  /**
   * Fan-out: add a named subscriber that receives all events.
   * Returns a dispose function to remove the subscriber.
   */
  tee(name: string, subscriber: EventSubscriber<T>): () => void;

  /**
   * Convenience: add a JSONL file subscriber (appends events as JSON lines).
   * Returns a dispose function to remove the subscriber.
   */
  jsonl(filePath: string): () => void;

  /** Current number of active subscribers (both AsyncIterable and tee'd). */
  readonly subscriberCount: number;

  /** Close the stream — all subscribers receive completion signal. */
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Event Envelope (optional helper)
// ---------------------------------------------------------------------------

/**
 * Typed envelope that consumers can use to standardize event metadata.
 * Optional — consumers can use any event type with EventStream.
 */
export interface EventEnvelope<T extends string, P> {
  /** Discriminant (e.g., "block:started"). */
  type: T;
  /** ISO 8601 timestamp (auto-set if not provided). */
  timestamp: string;
  /** Type-specific data. */
  payload: P;
}
