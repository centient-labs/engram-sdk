---
"@centient/wal": minor
---

Add mutex serialization, atomic writes, dead-letter support, and auto-confirm

- Per-path mutex serialization for confirmEntry and compactWal to prevent TOCTOU races
- Atomic file writes via temp-file-then-rename for crash safety
- Dead-letter support with configurable maxRetries and WAL_MAX_RETRIES env var
- Auto-confirm option on appendEntry for fire-and-forget entries
- cleanupOrphanedTempFiles() for startup cleanup with symlink protection
- Structured logging throughout replay.ts
- 63 tests covering all features, error paths, and edge cases
- README.md with full API documentation
