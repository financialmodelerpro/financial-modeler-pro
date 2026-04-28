# Supabase backup snapshots

Version-controlled JSON snapshots of production data written by maintenance scripts. Keep all files forever for audit.

- `apps_script_roster_*.json` — pre-cutover Apps Script Google Sheet snapshots written by `scripts/backup_apps_script_students.ts`.
- `stuck_watch_2026-04-28.json` — full dump of every `certification_watch_history` row that was below threshold and not bypassed at the start of the watch tracking rebuild Phase 5 sweep. Captured by `scripts/diagnose_stuck_watch.ts` before any writes. Used to identify the 4 students unblocked by Phase 5 (`muhammadtayyabmadni07`, `yusra.tufail`, `daniyal1012`, `fakhrizanul`) and as the rollback baseline if anything in the sweep needed to be undone.
- `phase5_recovery_2026-04-28.json` — post-sweep audit dump from `scripts/phase5_recovery.ts` covering the 4 stuck students. Records pre-write state, write payload, and the resulting `admin_audit_log` row id per student. Pairs with the `phase5_recovery_script` audit entries.
