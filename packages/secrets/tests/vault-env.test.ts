/**
 * EnvVault — listKeys tests
 *
 * EnvVault exposes a single logical key (`auth-token`) mapped to the
 * `ENGRAM_API_KEY` environment variable. listKeys should reflect this:
 * present when the env var is set, absent otherwise.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { EnvVault } from "../src/vault/vault-env.js";

const ORIGINAL_ENV = process.env["ENGRAM_API_KEY"];

describe("EnvVault.listKeys", () => {
  beforeEach(() => {
    delete process.env["ENGRAM_API_KEY"];
  });

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) {
      delete process.env["ENGRAM_API_KEY"];
    } else {
      process.env["ENGRAM_API_KEY"] = ORIGINAL_ENV;
    }
  });

  it("returns [] when ENGRAM_API_KEY is not set", () => {
    const vault = new EnvVault();
    expect(vault.listKeys()).toEqual([]);
  });

  it("returns ['auth-token'] when ENGRAM_API_KEY is set (no prefix)", () => {
    process.env["ENGRAM_API_KEY"] = "eng_test_value";
    const vault = new EnvVault();
    expect(vault.listKeys()).toEqual(["auth-token"]);
  });

  it("returns ['auth-token'] when ENGRAM_API_KEY is set and prefix matches", () => {
    process.env["ENGRAM_API_KEY"] = "eng_test_value";
    const vault = new EnvVault();
    expect(vault.listKeys("auth")).toEqual(["auth-token"]);
    expect(vault.listKeys("auth-token")).toEqual(["auth-token"]);
  });

  it("returns [] when the prefix doesn't match auth-token", () => {
    process.env["ENGRAM_API_KEY"] = "eng_test_value";
    const vault = new EnvVault();
    expect(vault.listKeys("refresh")).toEqual([]);
    expect(vault.listKeys("soma-")).toEqual([]);
  });
});
