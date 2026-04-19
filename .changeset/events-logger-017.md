---
"@centient/events": patch
---

Bump `@centient/logger` dep to `^0.17.0`.

Follow-up to `@centient/logger@0.17.0` (which dropped the reserved `version`
context slot and stopped silently stripping user-supplied `version` fields).
No events API changes; runtime logger calls inside `jsonl.ts`, `replay.ts`,
and `stream.ts` continue to work unchanged.

Unblocks downstream `centient-labs/daemon#7` and any other consumer that
imports both `@centient/events` and `@centient/logger` and wants to move
to the 0.17.0 logger without a split-version install.

Ref: centient-labs/centient-sdk#45.
