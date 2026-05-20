# PROJECT_HANDOFF.md

**Last updated: 2026-05-20.**

Cold-session entry point. Pre-2026-05-12 detail (M1.R → M1.13d Module 1 build) lived here once and has been archived to [CLAUDE-FEATURES.md](CLAUDE-FEATURES.md). What follows is the current map for picking the project up cold.

## Where you are now

REFM (Real Estate Financial Modeling) is the live platform. Module status (2026-05-20):

- **Module 1** (Project Setup / Costs / Financing): **LOCKED** at M2.0 Pass 58.
- **Module 2** (Revenue + CoS + Schedules + Escrow): **LOCKED** at Pass 9k.
- **Module 3** (Operating Expenses): **LOCKED** at Pass 5c.
- **Module 4** (Financial Statements): WIP at Pass 2M (P&L + Direct CF + Indirect CF + BS + IDC + Schedules sub-tabs all shipped).
- Verifier suite: **465 / 465 sections green** across 11 scripts.

## What to read next

1. [CLAUDE.md](CLAUDE.md), root project brief + session rules.
2. [CLAUDE-REFM.md](CLAUDE-REFM.md), REFM platform status + Module 1 conventions.
3. [CLAUDE-FEATURES.md](CLAUDE-FEATURES.md), per-feature archives + pre-M2.0 Module 1 history.
4. [CLAUDE-TODO.md](CLAUDE-TODO.md), current backlog.
5. [CLAUDE-ROUTES.md](CLAUDE-ROUTES.md), folder + route map.
6. [CLAUDE-DB.md](CLAUDE-DB.md), database schema + migration log.
7. [ARCHITECTURE.md](ARCHITECTURE.md), three-tier folder rationale + alias rules.

Auto-memory (auto-loaded each session): `MEMORY.md` plus the `project_*` / `feedback_*` / `reference_*` files alongside it carry decisions, locked-in patterns, and gotchas from prior sessions.

## What to do first

If touching REFM: run `npx tsx scripts/verify-revenue-rebuild.ts && npx tsx scripts/verify-phase-date-preservation.ts && npx tsx scripts/verify-m4-bs-reconciliation.ts` to confirm the baseline still passes locally. If any fail, that's your starting line; do not push code changes until the suite is green again.

If touching auth / training / admin: read the relevant scope row in CLAUDE.md, stay within those paths, and verify with the matching feature test in CLAUDE-FEATURES.md.
