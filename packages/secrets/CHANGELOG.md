# @centient/secrets

## 0.5.0

### Minor Changes

- f473113: Relax `isValidKey` to permit `.` as a namespace separator in credential key names. The validation regex is now `/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/` — lowercase alphanumeric plus hyphen and dot, first and last character alphanumeric, up to 64 characters.

  Both conventions work now — pick whichever reads best:

  ```ts
  await storeCredential("soma-anthropic-token1", value); // hyphen-delimited
  await storeCredential("soma.anthropic.token1", value); // dot-delimited
  ```

  Strictly additive — every key that validated under the previous `[a-z0-9-]` regex still validates. Underscores, uppercase, whitespace, and shell metacharacters remain rejected so keys can be safely interpolated into subprocess argv positions without additional escaping.

  Motivation: the natural namespace shape for pooled Anthropic credentials is `soma.anthropic.token1`, matching dot-delimited conventions used elsewhere in the soma project. Prior to this change, callers had to pick hyphens to satisfy the vault's stricter-than-necessary validation, even though hyphens and dots are equally safe under the shell-escaping constraint the regex is actually protecting.

- 9512d50: Make `VaultBackend.listKeys` async (`Promise<string[]>`) and replace libsecret's `secret-tool search --all` CLI with a D-Bus client via `dbus-next`.

  **Interface change:** `VaultBackend.listKeys(prefix?)` now returns `Promise<string[]>` instead of `string[]`. This is a compile-time breaking change for any external implementations of `VaultBackend`. No external implementations are known; accepting as a minor bump under 0.x semver per ADR-002 §0.5.0.

  **Security fix (libsecret):** The previous implementation shelled out to `secret-tool search --all`, which emitted every stored credential's decrypted value on stdout alongside the attribute lines we parsed. The new D-Bus path calls `org.freedesktop.secrets.Service.SearchItems`, which returns item object paths without decrypting secret values — secret material never crosses process memory during enumeration.

  **Fallback:** If the D-Bus session bus is unavailable (e.g. SSH without `DBUS_SESSION_BUS_ADDRESS`, headless server), the libsecret backend falls back to the `secret-tool` CLI parser automatically. The fallback carries the same transient-exposure trade-off as before; the JSDoc documents this.

  **Other backends:** Keychain, Windows Credential Manager, GPG file vault, and EnvVault simply mark their `listKeys` as `async` — the underlying sync work is unchanged, auto-wrapped in a resolved promise.

  **New runtime dependency:** `dbus-next@^0.10.2` (pure JavaScript, no native bindings). This is the first runtime dependency on `@centient/secrets`. It is dynamically imported inside `listKeysViaDbus` so it is only loaded on Linux when the libsecret backend is active and D-Bus is available.

- e90d11b: Add in-process TTL cache for macOS Keychain enumeration and `--json` output flag for `list-backend-keys` CLI subcommand.

  **Keychain cache:** `listAccountsInKeychain` now caches results for 5 seconds, keyed by `{service, prefix}`. Repeated `listCredentials` calls within the TTL window return cached results without re-spawning `security dump-keychain`. The cache is automatically invalidated when `storeStringInKeychain` or `deleteFromKeychain` is called, so stale reads after a write are not possible.

  **`--json` CLI flag:** `centient secrets list-backend-keys --json` outputs a sorted JSON array of key strings instead of the human-readable formatted list. On enumeration failure, outputs `{"error": "..."}` instead of the emoji-prefixed stderr message. Designed for scripting — e.g. `centient secrets list-backend-keys --prefix soma.anthropic. --json | jq '.[]'`.

- ab27f5d: Introduce the `SecretsPolicy` middleware layer and ship `auditTrail` as the first built-in policy.

  **New API surface:**

  - `SecretsPolicy` interface — `{ name, before?(op), after?(event) }`. Policies are cross-cutting concerns (audit, rate limiting, access control) applied to every credential operation. `before` hooks run top-to-bottom before the backend operation (can reject by throwing); `after` hooks run bottom-to-top with a structured event (exceptions swallowed with one-time stderr warning).
  - `setSecretsPolicies(policies: SecretsPolicy[])` — configure the active policy stack. Default: empty (no policies, zero overhead). Names and shapes are designed to fit the 1.0 `createSecretsClient({ policies })` factory without renaming.
  - `getActivePolicies()` — read the current policy list (useful for diagnostics).
  - `auditTrail({ sink, includeReads? })` — factory for an audit-only policy that forwards `SecretsEvent` objects to a caller-provided sink function. `includeReads` defaults to `true`; set to `false` to suppress `credential_read` and `credential_read_missing` events in hot-path scenarios.

  **Event shape (`SecretsEvent`):**

  - `type` — one of 9 event types: `credential_read`, `credential_read_missing`, `credential_read_failed`, `credential_written`, `credential_write_failed`, `credential_deleted`, `credential_delete_failed`, `credential_enumerated`, `credential_enumerate_failed`.
  - `timestamp` — ISO-8601 string.
  - `backend` — which vault backend handled the operation.
  - `key` / `prefix` / `keyCount` — operation-specific context.
  - `error` — error message on `*_failed` events (never stack trace).
  - `durationMs` — wall-clock time of the operation.

  **Integration:** all four public functions (`storeCredential`, `getCredential`, `deleteCredential`, `listCredentials`) now run through the policy stack. No changes to their signatures or return types — existing consumers are unaffected.

  **Designed for growth:** the `SecretsPolicy` interface, `setSecretsPolicies` array, and `SecretsOperation` descriptor are the same shapes that ADR-002's 1.0 `createSecretsClient({ provider, policies })` factory will use. The 0.5.0 global setter is a stepping stone, not a dead end.

  Motivation: per ADR-002, regulated consumers (SOC 2 target) need an auditable trail of credential operations. This is the first middleware seam in `@centient/secrets`, enabling audit now and rate limiting / access control / attestation in 1.0.

## 0.4.0

### Minor Changes

- 48d155e: Add `listCredentials(prefix?)` API and a new `list-backend-keys` CLI subcommand for enumerating keys on the backend-abstracted credential path (keychain, libsecret, Windows Credential Manager, GPG file vault, env-var).

  New `VaultBackend.listKeys(prefix?)` synchronous method backs the public API; all built-in backends implement enumeration. Backends that cannot efficiently enumerate return `[]`. Transient enumeration failures (keychain access denied, libsecret timeout, filesystem permission errors) propagate so the caller can retry or surface the problem.

  The new `list-backend-keys` CLI subcommand is distinct from the existing `list` command: `list` reads the encrypted file vault at `~/.centient/secrets/vault.enc`, while `list-backend-keys` reads whatever backend `storeCredential` / `getCredential` is writing to. The two storage paths remain separate in this release; reconciliation is a future concern.

  Motivation: soma orchestration needs to enumerate pooled Anthropic credentials stored under a shared key prefix to enable round-robin rotation across multiple Claude Pro/Max OAuth tokens or API keys. Prior to this change, enumeration required hardcoding known key names, which broke multi-credential management.

  Purely additive for consumers of the public API — no existing consumers of `storeCredential` / `getCredential` / `deleteCredential` need to change.

  Note for anyone who implements `VaultBackend` externally: the interface now requires a `listKeys(prefix?)` method. This is a compile-time breaking change under strict TypeScript, but no external implementations are known at the time of this release.

## 0.3.0

### Minor Changes

- Add KeyProvider abstraction for pluggable vault key storage. New `OnePasswordProvider` enables headless/remote unlock via `op` CLI and service account tokens. Existing macOS Keychain behavior unchanged (auto-detected when no config present). New `centient secrets migrate <provider>` command for switching between providers.

## 0.2.0

### Minor Changes

- Initial release — cross-platform secrets vault with AES-256-GCM encryption and platform-native key storage
