# Modeling Hub, Claude Code Project Brief
**Last updated: 2026-05-12**

Modeling Hub (`app.financialmodelerpro.com`) is the interactive financial modeling workspace. Each modeling discipline lives as a platform with one or more modules. The Hub itself is the wrapper around the platform catalog, admin sync, and shared shell; platform-specific behavior lives in per-platform MDs.

> **See also:**
> - [CLAUDE.md](CLAUDE.md), Root project brief, session rules, stack, both-hub auth, envs
> - [CLAUDE-REFM.md](CLAUDE-REFM.md), Real Estate Financial Modeling (live platform)
> - [CLAUDE-FEATURES.md](CLAUDE-FEATURES.md), Archived feature narratives + phase histories
> - [CLAUDE-DB.md](CLAUDE-DB.md), Database tables, migrations log
> - [CLAUDE-ROUTES.md](CLAUDE-ROUTES.md), Routes + components + lib structure

---

## Modeling Platforms (`src/config/platforms.ts`)

| Slug | Name | Status | Brief |
|------|------|--------|-------|
| `real-estate` | Real Estate Financial Modeling (REFM) | Live | [CLAUDE-REFM.md](CLAUDE-REFM.md) |
| `bvm` | Business Valuation Modeling | Coming Soon | (none yet) |
| `fpa` | FP&A Modeling Platform | Coming Soon | (none yet) |
| `erm` | Equity Research Modeling | Coming Soon | (none yet) |
| `pfm` | Project Finance Modeling | Coming Soon | (none yet) |
| `lbo` | LBO Modeling Platform | Coming Soon | (none yet) |
| `cfm` | Corporate Finance Modeling | Coming Soon | (none yet) |
| `eum` | Energy & Utilities Modeling | Coming Soon | (none yet) |
| `svm` | Startup & Venture Modeling | Coming Soon | (none yet) |
| `bcm` | Banking & Credit Modeling | Coming Soon | (none yet) |

Per-platform MDs are created when that platform starts active development. The root scoping table in CLAUDE.md routes platform-specific tasks to the corresponding `CLAUDE-{platform}.md` file.

---

## Platform & Module Admin Sync (P-Sync, 2026-05-07)

**P-Sync (ships):** Closes the loop between three previously disjoint module/platform listings (the static `MODULES` constant in REFM, the legacy `modules` table in admin, the hardcoded marketing `PLATFORMS` config) by adding:
- Two new Supabase tables (`platform_modules` + `platform_module_pages`)
- 9 API endpoints under `/api/platforms/[platformSlug]/modules/...` + `/api/admin/platform-module-pages/...`
- Admin 2-level UI at `/admin/platform-modules`
- Dynamic REFM sidebar fetch (`usePlatformModules` hook with static fallback)
- 3 marketing routes (`/modeling-hub`, `/modeling-hub/[platformSlug]`, `/modeling-hub/[platformSlug]/[moduleSlug]`)

RLS public-read filters `status='hidden'` / `visible=false`; service-role bypasses for admin writes. 60s ISR. 7 commits.

Full commit-by-commit narrative archived in **CLAUDE-FEATURES.md** if needed.

### P-Sync conventions (applies to all downstream platform/module work)

- **Source of truth lives in Supabase, not in TypeScript constants.** M2.1 Revenue and downstream module additions go through `platform_modules` (admin UI) instead of editing `MODULES` in `modules-config.ts`. Static constants stay as bootstrap fallback only.
- **Three-way sync is intentional.** Admin edit → workspace sidebar (`/api/platforms/.../modules`) + marketing site (`/modeling-hub/...`) within 60s ISR. One row update, three surfaces.
- **Page-sections are jsonb, not normalized.** Each marketing section's `content_blocks` holds its own typed shape (`HeroContent` / `FeaturesContent` / `HowItWorksContent` / `CtaContent` / `TestimonialsContent`). Admin edits via JSON textarea.
- **Legacy `modules` table stays** as platforms-storage despite name predating the platform/module distinction. Rename cost > benefit.
- **RLS:** anon role never reads `status='hidden'` modules or `visible=false` page sections. Service-role bypasses for admin writes. No write policies needed for anon.

### P-Sync verifier
```bash
npx tsx scripts/verify-psync.ts                 # P-Sync platform/module admin sync (108 pass / 0 fail / 3 skip)
npx playwright test tests/e2e/psync-flow.spec.ts   # 4 specs
```

---

## Modeling Hub Auth (Modeling Hub-specific bits)

Full auth shape (NextAuth provider, device trust, OTP flow, scrypt password storage, admin bypass) lives in **CLAUDE.md** under "Authentication Systems → Modeling Hub". Key Hub-specific touch points:

- **Subdomain rewrite**: `app.financialmodelerpro.com/` rewrites to `/modeling` (URL unchanged). See `next.config.ts`. Do NOT touch.
- **Clean auth URLs**: `/signin` → `/modeling/signin`, `/register` → `/modeling/register`.
- **Sidebar shell**: every platform consumes the shared shell layout at `src/components/refm/` (folder name retained from REFM origin). Module 1 status pill colors + Inputs/Results sub-tab pattern + FAST blue input style are documented per-platform.

---

## Module display numbering: position, NOT `platform_modules.number` (2026-07-30)

`platform_modules` carries TWO different numbers and they are not interchangeable:

- **`number` is a stable ROUTING id.** `SLUG_TO_COMPONENT_NUMBER` in `src/shared/entitlements/moduleCatalog.ts` maps `slug -> component number -> module_N` feature key. It deliberately never renumbers when an admin reorders or hides a module, which is exactly what makes it safe for routing and WRONG for display.
- **The 1-based position in `display_order` is what users see.** Admin (`/admin/platform-modules` renders `i + 1`, real number only in the row tooltip), the workspace sidebar and Plan Builder all number this way.

**`orderModulesForDisplay()` in `moduleCatalog.ts` is the single source of truth** (drop hidden, sort by `display_order` with `number` as tiebreak, assign 1-based position). `toSidebarNavList`, `deriveModuleFeatureRows` and the public marketing page (`app/modeling/[slug]/page.tsx`) all route through it. Do not re-derive this rule anywhere.

The bug it fixes: the marketing page rendered the raw `number`, so with Portfolio (8) and Market Data (9) hidden it showed "Module 10: Collaborate" and "Module 11: API Access" where admin and the sidebar both showed 8 and 9. Modules 1 to 7 matched only by coincidence, because their routing id happened to equal their position. `verify-psync` pins this with a fixture where position differs from routing number, asserts sidebar and marketing produce identical numbering, and asserts the marketing page no longer contains `number: m.number`.

The marketing page reads `platform_modules` live and falls back to the hardcoded list in `src/hubs/modeling/config/platforms.ts` ONLY when the table is empty. That fallback had drifted to the PRE-SWAP ordering (M6 "Reports & Visualizations", M7 "Scenarios & Sensitivity"); it is now pinned to `modules-config.ts` by a `verify-psync` parity check.

---

## Modeling Hub task scoping

Use this when a task touches the Hub wrapper (sidebar, platform list, admin sync) without diving into a specific platform's calc engine:

| Task | Read ONLY these paths |
|------|-----------------------|
| Platform / module admin sync | `app/admin/platform-modules/` `app/api/platforms/[platformSlug]/modules/` `app/api/admin/platform-module-pages/` `src/lib/modeling/platform-modules/` |
| Hub sidebar / shell | `src/components/refm/` (shared shell) `src/hubs/modeling/` |
| Marketing routes | `app/modeling-hub/` `app/(portal)/modeling-hub/` |
| Hub auth | See CLAUDE.md scoping table → "Modeling Hub auth" |
| Platform-specific (REFM, ...) | See per-platform MD (CLAUDE-REFM.md, ...) |
