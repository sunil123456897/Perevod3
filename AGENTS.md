# Autonomous Web-Novel Translation Studio — Navigation & Guardrails

- **Verification gate (`red/green`)**: Run `npm test && npx tsc --noEmit` after any edit to `lib/` or `scripts/`. Mechanical typography, punctuation (`:[ \t]*—`, `?..`, `!..`, `...`), and pipeline invariants are enforced in [`lib/audit-fixes.test.ts`](lib/audit-fixes.test.ts).
- **Database serialization**: Read and write `data/novels_db.json` exclusively via `parseDiskDatabasePayload` and `serializeDiskDatabasePayload` in [`lib/storage-idb.ts`](lib/storage-idb.ts).
- **Novel QA, repair & Rulate export**: Reach for [`.agents/skills/webnovel-ru-qa-and-rulate/SKILL.md`](.agents/skills/webnovel-ru-qa-and-rulate/SKILL.md) and run `node scripts/forensic-novel-audit.ts --range <start>-<end>` ([`scripts/forensic-novel-audit.ts`](scripts/forensic-novel-audit.ts)).
