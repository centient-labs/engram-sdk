/**
 * Auth Vault — Credential Storage (Linux libsecret via secret-tool)
 *
 * Provides secure storage for auth tokens on Linux systems using the
 * GNOME libsecret service via the `secret-tool` CLI. Credentials are
 * stored under a fixed service attribute (`centient`) and a per-key
 * attribute (`key`).
 *
 * Error handling: all functions return null/false on failure — never throw.
 */

import { execSync } from "child_process";
import type { VaultBackend } from "./types.js";
import { isValidKey } from "./vault-utils.js";

// =============================================================================
// Constants
// =============================================================================

const SERVICE_ATTR = "centient";
const LABEL = "centient-auth";

// =============================================================================
// LibsecretVault
// =============================================================================

/**
 * Vault backend that uses the `secret-tool` CLI to interact with the
 * system's libsecret / GNOME Keyring service on Linux.
 *
 * Usage:
 *   if (LibsecretVault.detect()) {
 *     const vault = new LibsecretVault();
 *     vault.store("auth-token", token);
 *   }
 */
export class LibsecretVault implements VaultBackend {
  /**
   * Returns true if `secret-tool` is available on this system.
   * Uses `which secret-tool` — returns false if not found or command fails.
   */
  static detect(): boolean {
    try {
      execSync("which secret-tool", {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Store a credential value in the libsecret keyring.
   *
   * @param key   - Logical key name (e.g. 'auth-token', 'refresh-token')
   * @param value - The credential value to store (passed via stdin)
   * @returns true on success, false if the write fails
   */
  store(key: string, value: string): boolean {
    if (!isValidKey(key)) return false;
    try {
      execSync(
        `secret-tool store --label "${LABEL}" service ${SERVICE_ATTR} key "${key}"`,
        {
          encoding: "utf8",
          stdio: ["pipe", "pipe", "pipe"],
          input: value,
        },
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Retrieve a credential value from the libsecret keyring.
   *
   * @param key - Logical key name (e.g. 'auth-token')
   * @returns The stored value, or null if not found / lookup fails
   */
  retrieve(key: string): string | null {
    if (!isValidKey(key)) return null;
    try {
      const result = execSync(
        `secret-tool lookup service ${SERVICE_ATTR} key "${key}"`,
        {
          encoding: "utf8",
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      const trimmed = result.trim();
      return trimmed.length > 0 ? trimmed : null;
    } catch {
      return null;
    }
  }

  /**
   * Delete a credential from the libsecret keyring.
   *
   * @param key - Logical key name (e.g. 'auth-token')
   * @returns true on success (including "already deleted"), false on unexpected error
   */
  delete(key: string): boolean {
    if (!isValidKey(key)) return false;
    try {
      execSync(
        `secret-tool clear service ${SERVICE_ATTR} key "${key}"`,
        {
          encoding: "utf8",
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      return true;
    } catch {
      // secret-tool clear exits 0 even if item does not exist;
      // any non-zero exit indicates an unexpected error — still return true
      // to match the "already deleted" semantic of other backends.
      return true;
    }
  }
}
