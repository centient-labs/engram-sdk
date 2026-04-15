/**
 * LibsecretVault — listKeys tests
 *
 * Mocks `child_process.execSync` so the real `secret-tool` CLI is never
 * invoked. Exercises the parser that extracts `attribute.key = <key>`
 * lines from `secret-tool search --all` output and confirms that:
 *
 *   - status=1 (no matches) is mapped to an empty list
 *   - other transient failures propagate
 *   - prefix filtering behaves correctly
 *   - the secret-value lines in the same output are ignored
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockExecSync = vi.hoisted(() => vi.fn());

vi.mock("child_process", () => ({
  execSync: mockExecSync,
}));

const { LibsecretVault } = await import("../src/vault/vault-libsecret.js");

const SAMPLE_OUTPUT = `[/org/freedesktop/secrets/collection/login/123]
label = centient-auth
secret = super-secret-value-should-not-be-returned
created = 2026-01-01 00:00:00
modified = 2026-01-01 00:00:00
schema = org.freedesktop.Secret.Generic
attribute.service = centient
attribute.key = auth-token

[/org/freedesktop/secrets/collection/login/124]
label = centient-auth
secret = another-secret-value
schema = org.freedesktop.Secret.Generic
attribute.service = centient
attribute.key = soma-anthropic-token1

[/org/freedesktop/secrets/collection/login/125]
label = centient-auth
secret = yet-another
schema = org.freedesktop.Secret.Generic
attribute.service = centient
attribute.key = soma-anthropic-token2
`;

beforeEach(() => {
  mockExecSync.mockReset();
});

describe("LibsecretVault.listKeys", () => {
  it("returns every attribute.key from the parsed output", () => {
    mockExecSync.mockReturnValue(SAMPLE_OUTPUT);
    const vault = new LibsecretVault();
    const result = vault.listKeys();
    expect(result.sort()).toEqual([
      "auth-token",
      "soma-anthropic-token1",
      "soma-anthropic-token2",
    ]);
  });

  it("filters by prefix — matches kept, non-matches excluded", () => {
    mockExecSync.mockReturnValue(SAMPLE_OUTPUT);
    const vault = new LibsecretVault();
    const result = vault.listKeys("soma-anthropic-");
    expect(result.sort()).toEqual([
      "soma-anthropic-token1",
      "soma-anthropic-token2",
    ]);
    expect(result).not.toContain("auth-token");
  });

  it("does NOT return secret values — only attribute.key lines", () => {
    mockExecSync.mockReturnValue(SAMPLE_OUTPUT);
    const vault = new LibsecretVault();
    const result = vault.listKeys();
    for (const key of result) {
      expect(key).not.toContain("secret");
      expect(key).not.toContain("super-secret-value");
      expect(key).not.toContain("another-secret-value");
    }
  });

  it("returns [] when secret-tool exits status 1 (no matches)", () => {
    mockExecSync.mockImplementation(() => {
      const err = new Error("Command failed") as Error & { status: number };
      err.status = 1;
      throw err;
    });
    const vault = new LibsecretVault();
    expect(vault.listKeys()).toEqual([]);
  });

  it("returns [] when output is empty", () => {
    mockExecSync.mockReturnValue("");
    const vault = new LibsecretVault();
    expect(vault.listKeys()).toEqual([]);
  });

  it("propagates other transient failures (status != 1)", () => {
    mockExecSync.mockImplementation(() => {
      const err = new Error("secret-tool: cannot connect to dbus") as Error & {
        status: number;
      };
      err.status = 127;
      throw err;
    });
    const vault = new LibsecretVault();
    expect(() => vault.listKeys()).toThrow(/cannot connect to dbus/);
  });

  it("ignores malformed lines without an attribute.key prefix", () => {
    mockExecSync.mockReturnValue(
      [
        "label = centient-auth",
        "secret = value",
        "attribute.service = centient",
        "attribute.key = valid-key",
        "attribute.other = ignored",
        "random garbage line",
      ].join("\n"),
    );
    const vault = new LibsecretVault();
    expect(vault.listKeys()).toEqual(["valid-key"]);
  });
});
