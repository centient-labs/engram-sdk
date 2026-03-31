/**
 * Crypto — Vault Common Helpers
 *
 * Shared encryption/decryption utilities and Keychain accessor functions
 * used by both the auth vault and the secrets CLI.
 *
 * Zero duplication rule: encrypt, decrypt, getKeyFromKeychain, and
 * storeKeyInKeychain must NOT be copied into any other file — import from here.
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "crypto";
import { execFileSync } from "child_process";

// =============================================================================
// Constants
// =============================================================================

export const ALGORITHM = "aes-256-gcm" as const;
export const IV_LENGTH = 12;
export const AUTH_TAG_LENGTH = 16;
export const KEY_LENGTH = 32;

// =============================================================================
// Encryption / Decryption
// =============================================================================

/**
 * Encrypt a string value with AES-256-GCM.
 *
 * The returned Buffer layout is:
 *   [IV (12 bytes)] [AuthTag (16 bytes)] [Ciphertext (variable)]
 */
export function encrypt(plaintext: string, key: Buffer): Buffer {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]);
}

/**
 * Decrypt a Buffer produced by `encrypt()`.
 * Returns the plaintext string, or null if decryption fails.
 */
export function decrypt(data: Buffer, key: Buffer): string | null {
  try {
    if (data.length < IV_LENGTH + AUTH_TAG_LENGTH) return null;
    const iv = data.subarray(0, IV_LENGTH);
    const authTag = data.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const ciphertext = data.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return decrypted.toString("utf8");
  } catch {
    return null;
  }
}

/**
 * Encrypt a JSON-serializable object. Convenience wrapper over `encrypt()`.
 * Returns null if serialization fails (should not happen with plain objects).
 */
export function encryptObject(
  data: Record<string, unknown>,
  key: Buffer,
): Buffer | null {
  try {
    return encrypt(JSON.stringify(data), key);
  } catch {
    return null;
  }
}

/**
 * Decrypt a Buffer to a JSON object. Convenience wrapper over `decrypt()`.
 * Returns null if decryption or parsing fails.
 */
export function decryptObject(
  data: Buffer,
  key: Buffer,
): Record<string, unknown> | null {
  const plaintext = decrypt(data, key);
  if (plaintext === null) return null;
  try {
    const parsed: unknown = JSON.parse(plaintext);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

// =============================================================================
// Keychain operations (macOS `security` CLI)
// =============================================================================

/**
 * Read a hex-encoded key from the macOS Keychain.
 * Returns the key as a Buffer, or null if not found / command fails.
 */
export function getKeyFromKeychain(
  service: string,
  account: string,
): Buffer | null {
  try {
    const result = execFileSync(
      "security",
      ["find-generic-password", "-s", service, "-a", account, "-w"],
      { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
    ).trim();
    if (!result) return null;
    return Buffer.from(result, "hex");
  } catch {
    return null;
  }
}

/**
 * Store a hex-encoded key in the macOS Keychain.
 * Deletes any existing entry first to avoid duplicates.
 * Returns true on success, false on failure.
 */
export function storeKeyInKeychain(
  service: string,
  account: string,
  key: Buffer,
): boolean {
  try {
    const keyHex = key.toString("hex");
    // Delete existing entry (ignore errors — it may not exist)
    try {
      execFileSync(
        "security",
        ["delete-generic-password", "-s", service, "-a", account],
        { stdio: ["pipe", "pipe", "pipe"] },
      );
    } catch {
      // Intentionally ignored
    }
    execFileSync(
      "security",
      ["add-generic-password", "-s", service, "-a", account, "-w", keyHex, "-T", ""],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Store an arbitrary string value directly in the macOS Keychain
 * (not hex-encoded — intended for short credential strings like tokens).
 * Returns true on success, false on failure.
 */
export function storeStringInKeychain(
  service: string,
  account: string,
  value: string,
): boolean {
  try {
    // Delete existing entry
    try {
      execFileSync(
        "security",
        ["delete-generic-password", "-s", service, "-a", account],
        { stdio: ["pipe", "pipe", "pipe"] },
      );
    } catch {
      // Intentionally ignored
    }
    execFileSync(
      "security",
      ["add-generic-password", "-s", service, "-a", account, "-w", value, "-T", ""],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Read an arbitrary string value from the macOS Keychain.
 * Returns the stored string, or null if not found / command fails.
 */
export function getStringFromKeychain(
  service: string,
  account: string,
): string | null {
  try {
    const result = execFileSync(
      "security",
      ["find-generic-password", "-s", service, "-a", account, "-w"],
      { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
    ).trim();
    return result || null;
  } catch {
    return null;
  }
}

/**
 * Delete an entry from the macOS Keychain.
 * Returns true if deleted (or did not exist), false if command fails unexpectedly.
 */
export function deleteFromKeychain(
  service: string,
  account: string,
): boolean {
  try {
    execFileSync(
      "security",
      ["delete-generic-password", "-s", service, "-a", account],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    return true;
  } catch {
    // exit 44 = item not found — treat as success
    return true;
  }
}
