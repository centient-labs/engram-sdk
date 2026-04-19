---
"@centient/wal": patch
---

Bump `@centient/logger` dep to `^0.17.0`.

Follow-up to `@centient/logger@0.17.0` (which dropped the reserved `version`
context slot and stopped silently stripping user-supplied `version` fields).
No WAL API changes; runtime logger calls inside `wal.ts` and `replay.ts`
continue to work unchanged.

Aligns the workspace at the 0.17.x logger boundary alongside
`@centient/events`. Without this bump, downstream consumers that depend on
both `@centient/wal` and `@centient/logger@^0.17.0` would end up with a
split-version install (wal pulls in 0.16.1 alongside the caller's 0.17.x).

Ref: centient-labs/centient-sdk#45.
