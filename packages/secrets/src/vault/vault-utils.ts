/**
 * Auth Vault — Shared Utilities
 *
 * Shared validation and helper functions used across all vault backends.
 */

/** Allowed key name pattern — alphanumeric and hyphens only, 2-64 chars. */
const VALID_KEY_RE = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;

/**
 * Returns true if the given credential key name is valid.
 * Keys must match /^[a-z0-9][a-z0-9-]*[a-z0-9]$/ and be at most 64 characters.
 * This enforces that keys cannot contain shell-special characters.
 */
export function isValidKey(key: string): boolean {
  return VALID_KEY_RE.test(key) && key.length <= 64;
}
