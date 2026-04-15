---
"@centient/secrets": minor
---

Add `listCredentials(prefix?)` API and a new `list-backend-keys` CLI subcommand for enumerating keys on the backend-abstracted credential path (keychain, libsecret, Windows Credential Manager, GPG file vault, env-var).

New `VaultBackend.listKeys(prefix?)` synchronous method backs the public API; all built-in backends implement enumeration. Backends that cannot efficiently enumerate return `[]`. Transient enumeration failures (keychain access denied, libsecret timeout, filesystem permission errors) propagate so the caller can retry or surface the problem.

The new `list-backend-keys` CLI subcommand is distinct from the existing `list` command: `list` reads the encrypted file vault at `~/.centient/secrets/vault.enc`, while `list-backend-keys` reads whatever backend `storeCredential` / `getCredential` is writing to. The two storage paths remain separate in this release; reconciliation is a future concern.

Motivation: soma orchestration needs to enumerate pooled Anthropic credentials stored under a shared key prefix to enable round-robin rotation across multiple Claude Pro/Max OAuth tokens or API keys. Prior to this change, enumeration required hardcoding known key names, which broke multi-credential management.

Purely additive for consumers of the public API — no existing consumers of `storeCredential` / `getCredential` / `deleteCredential` need to change.

Note for anyone who implements `VaultBackend` externally: the interface now requires a `listKeys(prefix?)` method. This is a compile-time breaking change under strict TypeScript, but no external implementations are known at the time of this release.
