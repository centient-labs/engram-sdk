/**
 * listAccountsInKeychain — parser tests
 *
 * Parses realistic `security dump-keychain` output and verifies that only
 * entries under the requested service are returned, with optional prefix
 * filtering on the account name.
 *
 * `child_process.execFileSync` is mocked so the test never touches the
 * real keychain.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockExecFileSync = vi.hoisted(() => vi.fn());

vi.mock("child_process", () => ({
  execFileSync: mockExecFileSync,
}));

const { listAccountsInKeychain } = await import(
  "../src/crypto/vault-common.js"
);

const SAMPLE_DUMP = `keychain: "/Users/test/Library/Keychains/login.keychain-db"
version: 512
class: "genp"
attributes:
    0x00000007 <blob>="centient-auth"
    0x00000008 <blob>=<NULL>
    "acct"<blob>="auth-token"
    "cdat"<timedate>=0x3230323600000000
    "svce"<blob>="centient-auth"
    "type"<uint32>=<NULL>
keychain: "/Users/test/Library/Keychains/login.keychain-db"
version: 512
class: "genp"
attributes:
    0x00000007 <blob>="centient-auth"
    0x00000008 <blob>=<NULL>
    "acct"<blob>="refresh-token"
    "svce"<blob>="centient-auth"
keychain: "/Users/test/Library/Keychains/login.keychain-db"
version: 512
class: "genp"
attributes:
    "acct"<blob>="unrelated-key"
    "svce"<blob>="not-us"
keychain: "/Users/test/Library/Keychains/login.keychain-db"
version: 512
class: "genp"
attributes:
    "acct"<blob>="soma-anthropic-token1"
    "svce"<blob>="centient-auth"
keychain: "/Users/test/Library/Keychains/login.keychain-db"
version: 512
class: "genp"
attributes:
    "acct"<blob>="soma-anthropic-token2"
    "svce"<blob>="centient-auth"
`;

beforeEach(() => {
  mockExecFileSync.mockReset();
});

describe("listAccountsInKeychain", () => {
  it("returns all accounts under the matching service", () => {
    mockExecFileSync.mockReturnValue(SAMPLE_DUMP);
    const result = listAccountsInKeychain("centient-auth");
    expect(result.sort()).toEqual([
      "auth-token",
      "refresh-token",
      "soma-anthropic-token1",
      "soma-anthropic-token2",
    ]);
    expect(result).not.toContain("unrelated-key");
  });

  it("filters by prefix", () => {
    mockExecFileSync.mockReturnValue(SAMPLE_DUMP);
    const result = listAccountsInKeychain("centient-auth", "soma-anthropic-");
    expect(result.sort()).toEqual([
      "soma-anthropic-token1",
      "soma-anthropic-token2",
    ]);
    expect(result).not.toContain("auth-token");
  });

  it("returns [] when no accounts match the service", () => {
    mockExecFileSync.mockReturnValue(SAMPLE_DUMP);
    const result = listAccountsInKeychain("some-other-service");
    expect(result).toEqual([]);
  });

  it("returns [] when dump-keychain output is empty", () => {
    mockExecFileSync.mockReturnValue("");
    expect(listAccountsInKeychain("centient-auth")).toEqual([]);
  });

  it("propagates failures from security dump-keychain", () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error("security: SecKeychainSearchCreateFromAttributes: permission denied");
    });
    expect(() => listAccountsInKeychain("centient-auth")).toThrow(
      /permission denied/,
    );
  });
});
