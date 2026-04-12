/**
 * Event Envelope Helper
 *
 * Optional typed envelope for standardizing event metadata.
 * Consumers can use any event type with EventStream — this helper
 * provides a convenient factory for creating typed events with
 * auto-generated timestamps.
 */

import type { EventEnvelope } from "./types.js";

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a typed event factory for a given event type discriminant.
 *
 * @param type - The event type string (e.g., "block:started")
 * @returns A factory function that creates EventEnvelope instances
 *
 * @example
 * ```ts
 * const blockStarted = defineEvent<"block:started", { blockPath: string }>("block:started");
 * const event = blockStarted({ blockPath: "implement/auth" });
 * // => { type: "block:started", timestamp: "2026-...", payload: { blockPath: "implement/auth" } }
 * ```
 */
export function defineEvent<T extends string, P>(
  type: T,
): (payload: P) => EventEnvelope<T, P> {
  return (payload: P): EventEnvelope<T, P> => ({
    type,
    timestamp: new Date().toISOString(),
    payload,
  });
}
