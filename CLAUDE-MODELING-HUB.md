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
npx tsx scripts/verify-psync.ts                 # P-Sync platform/module admin sync (70 pass / 0 fail / 3 skip)
npx playwright test tests/e2e/psync-flow.spec.ts   # 4 specs
```

---

## Modeling Hub Auth (Modeling Hub-specific bits)

Full auth shape (NextAuth provider, device trust, OTP flow, scrypt password storage, admin bypass) lives in **CLAUDE.md** under "Authentication Systems → Modeling Hub". Key Hub-specific touch points:

- **Subdomain rewrite**: `app.financialmodelerpro.com/` rewrites to `/modeling` (URL unchanged). See `next.config.ts`. Do NOT touch.
- **Clean auth URLs**: `/signin` → `/modeling/signin`, `/register` → `/modeling/register`.
- **Sidebar shell**: every platform consumes the shared shell layout at `src/components/refm/` (folder name retained from REFM origin). Module 1 status pill colors + Inputs/Results sub-tab pattern + FAST blue input style are documented per-platform.

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
