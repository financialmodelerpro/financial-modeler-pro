# Financial Modeler Pro, Claude Code Project Brief
**Last updated: 2026-06-04.**

**Module status (REFM platform), one line each. Full narrative + commits live in [CLAUDE-REFM.md](CLAUDE-REFM.md), NOT here:**
- **Module 1 (Setup / Costs / Financing)**: LOCKED at M2.0 Pass 58 (base). Funding Methods 2/3 gap-sized; conditional IDC + iterative fixed-point solver. Financing sub-tabs: Inputs / Schedules / Funding Gap / Cash Sweep. Dividends are ONE project-level after-debt policy (`Project.dividendPolicy` + `dividendStartYear`) with a terminal 100% payout in the engine.
- **Module 2 (Revenue + CoS + Schedules + Escrow)**: LOCKED at Pass 9N.
- **Module 3 (Operating Expenses)**: LOCKED at Pass 5d.
- **Module 4 (Financial Statements)**: WIP. BS balances by construction; Direct CF == Indirect CF every period. Phase-filtered P&L stops at EBITDA; phase CF shows Operations+Investing; BS is consolidated-only. P&L/CF/BS render from shared pure builders (`lib/reports/m4Reports.ts`) that the on-screen tabs AND the PDF both consume.
- **Module 5 (Returns & Valuation)**: Sponsor-IRR view (FCFF / FCFE / Distributed Equity + terminal value + RE metrics + Case Comparison).
- **Cases (scenarios)**: Management base + override cases; topbar switcher + Returns Case Comparison; per-input "≠ Management" override badge; scenario edits in the change_log; viewing a case never starts an edit session.
- **Platform infra**: project-switch state-leak fixed; session-based versioning + per-version change_log; schema-tolerant reads; paginated version history. **PDF full-project report** (`lib/pdf/generateProjectPdf.ts` on pdf-lib) mirrors every module tab via shared `lib/reports/` builders (m4/opex/capex/financing/cos), with per-module part picker + number-scale + **version picker** in `ExportModal` (file named after the chosen version); Excel export next. **Auto-updating platform walkthrough guide** (`lib/guide/`, Topbar "Guide" button): in-app view + PDF/Markdown download, structure derived from the MODULES + MODULE_TABS registries.

Verifier reality + outstanding ops (migrations pending on prod) live in [CLAUDE-REFM.md](CLAUDE-REFM.md). Full suite green via `npx tsx scripts/verify-*.ts`.

**M2 lock conventions** (apply to M3+ unless overridden):
- The reference Excel at repo root is the verification benchmark, not a behavioural spec. Every reference-specific behaviour stays configurable; never hard-code currency, locale, escrow, or DSO defaults into engine paths.
- Engine storage is project-axis-indexed (`arr[0]` = first active project year). Only the UI window changes per asset / strategy.
- Vintage matrices (cohort year × cash year, cohort year × recognition year, capex year × CoS year) are the canonical mechanic for both recognition and cash distribution.
- PIT recognition handover = LAST construction year (`phaseStart + cp − 1 − projectStart`), NOT first operations year. Verifier A2-1..A2-5 pin this.
- See CLAUDE-REFM.md for the full Pass 7-9 narrative; older pass detail is archived to CLAUDE-FEATURES.md.

> **See also:**
> - [CLAUDE-MODELING-HUB.md](CLAUDE-MODELING-HUB.md), Modeling Hub wrapper, platform catalog, P-Sync admin conventions
> - [CLAUDE-REFM.md](CLAUDE-REFM.md), Real Estate Financial Modeling (REFM), Module 1 status + conventions
> - [CLAUDE-DB.md](CLAUDE-DB.md), Database tables, storage buckets, migrations log
> - [CLAUDE-FEATURES.md](CLAUDE-FEATURES.md), Feature status, archived phase narratives (M1.R → M1.13d pre-M2.0 + M2.0 → M2.0i post-rebuild)
> - [CLAUDE-ROUTES.md](CLAUDE-ROUTES.md), All page routes, API routes, components, lib structure
> - [CLAUDE-TODO.md](CLAUDE-TODO.md), Pending work, backlog, legacy reference
> - [ARCHITECTURE.md](ARCHITECTURE.md), Three-tier folder rationale, alias guide, boundary rules
> - [PROJECT_HANDOFF.md](PROJECT_HANDOFF.md), Frozen 2026-05-02 snapshot for resuming a cold session (M1.7-era detail)

---

## STRICT SESSION RULES, READ FIRST

### Writing rule: NEVER use the reference client's name

The user has shared private reference Excel models that we use as a verification benchmark only. The client / model name **must never appear in this codebase**, including:
- UI strings (tooltips, captions, hints, formula text, error messages, labels)
- Code comments
- Variable / function / file names
- Commit messages, PR descriptions, branch names
- Project documentation, MD files, README
- Test fixtures (use generic names like `refAsset`, `refPhases`, "the reference fixture")

If you need to refer to a behaviour learned from the reference Excel, use phrasing like "the reference model", "the reference benchmark", or "the reference design" — never the client's actual name. Any historical references that slip through must be scrubbed when found.

The reference Excel files at the repo root are `.gitignore`-listed and must stay that way. Do not commit them.

### Writing rule: NEVER use em-dashes

**NEVER use em-dashes (the long dash, U+2014) anywhere.** This applies to ALL output: code, code comments, UI strings, JSX text, tooltips, error messages, commit messages, documentation markdown, prompts, agent briefs, anything.

Use one of these instead, depending on intent:
- A comma, when separating clauses (most common substitute).
- A colon, when introducing a list or definition.
- Parentheses, for asides.
- "and" or "or" or "and/or", when joining alternatives.
- A period plus new sentence, when the second clause stands alone.

Em-dash sweep across `src/` + `scripts/` is complete (zero remaining as of 2026-05-20). Do not introduce new ones.

### Scoping: Read ONLY the files for your task domain

| Task | Read these paths + MDs |
|------|------------------------|
| Training (auth / dashboard / assessment / certificate) | `app/training/` `app/api/training/` `app/api/t/` `src/lib/training/` `src/components/training/` |
| Modeling Hub auth | `app/modeling/signin/` `app/modeling/confirm-email/` `app/api/auth/` `src/lib/shared/` |
| Modeling Hub wrapper (sidebar, platform catalog, admin sync) | **+ CLAUDE-MODELING-HUB.md.** `app/admin/platform-modules/` `app/api/platforms/` `app/api/admin/platform-module-pages/` `src/lib/modeling/platform-modules/` `src/components/refm/` `src/hubs/modeling/` `app/modeling-hub/` |
| REFM platform (Real Estate, Modules 1-4) | **+ CLAUDE-MODELING-HUB.md + CLAUDE-REFM.md.** `app/refm/` `app/modeling/` `src/components/refm/` `src/lib/modeling/` `src/hubs/modeling/platforms/refm/` `src/core/calculations/` |
| Admin panel | `app/admin/` `src/components/admin/` `app/api/admin/` |
| Email system | `src/shared/email/` |
| Landing pages / CMS | `app/(portal)/` `app/about/` `app/articles/` `app/pricing/` `src/components/landing/` `app/api/cms/` |
| Shared (auth / formatters / device trust) | `src/lib/shared/` `src/core/` |
| Navbar / layout | `src/components/layout/` |

Read only the rows your task touches. Per-platform MD loads only when working on that platform; the global CLAUDE.md stays lean.

### End-of-session rule
**ALWAYS update CLAUDE.md files at the end of every session** to reflect:
- Any new files created (add to the correct folder list in CLAUDE-ROUTES.md)
- Any feature status changes (update the Feature Status table in CLAUDE-FEATURES.md)
- Any new environment variables added
- Any new database tables or migrations (add to CLAUDE-DB.md)
- Platform-specific work: update the relevant `CLAUDE-{platform}.md`, NOT the root CLAUDE.md

### Do NOT touch list
- `next.config.ts`, subdomain routing is live and correct; clean auth URL rewrites + redirects added; app. `/register` rewrite goes to `/modeling/register` (dedicated page, NOT `/modeling/signin?tab=register`)
- `src/middleware.ts`, `/admin/:path*` protection is live; `/admin/login` AND `/admin` root excluded
- `app/globals.css`, design system tokens, do not restructure
- `vercel.json`, deployment config is live
- `supabase/migrations/`, never edit existing migrations; create new ones only
- Any feature marked Complete unless explicitly asked by the user
- Cross-feature shared files (`src/lib/shared/`, `src/shared/email/`) without explicit instruction

---

## Project Overview

**Financial Modeler Pro**, Multi-hub SaaS platform with three web properties:

| Property | Domain | Purpose |
|----------|--------|---------|
| Main site | `financialmodelerpro.com` | Marketing, admin, portal, auth |
| Training Hub | `learn.financialmodelerpro.com` | Financial modeling courses |
| Modeling Hub | `app.financialmodelerpro.com` | Interactive financial modeling tools |

**Stack: Next.js 16 (App Router) + TypeScript strict + Tailwind CSS 4 + Supabase**

---

## Tech Stack

Next.js 16 (App Router) + TypeScript strict + Tailwind 4 + Supabase. State Zustand, charts Recharts, NextAuth (Modeling Hub) + custom session (Training Hub), Brevo email, hCaptcha, Anthropic SDK, ExcelJS + react-pdf for exports. Full version pinning in `package.json` + extended detail in [ARCHITECTURE.md](ARCHITECTURE.md).

## Authentication (summary)

Two independent stacks. Full per-flow detail (sign-in / register / OTP / device trust / admin bypass) in [CLAUDE-FEATURES.md](CLAUDE-FEATURES.md).

- **Training Hub** (learn.): custom session `training_session` cookie + bcrypt password in `training_passwords`. Source of truth = Google Apps Script roster. `email_confirmed` is `!== false`-truthy (null counts as confirmed for pre-migration-027 students).
- **Modeling Hub** (app.): NextAuth.js Credentials JWT (1hr) + scrypt password in `users.password_hash`. Admin role bypasses both EmailNotConfirmed + DEVICE_VERIFICATION_REQUIRED checks.
- **Device trust**: shared `fmp-trusted-device` cookie + `trusted_devices` table (30-day, keyed by email not UUID).

## Subdomain Routing (`next.config.ts`)

- `learn.fmp.com/` -> rewrites to `/training`. `app.fmp.com/` -> rewrites to `/modeling`. URL unchanged in both.
- Clean auth URLs `/signin`, `/register`, `/forgot` resolve per-subdomain to the matching training / modeling page.
- Cross-domain main-site paths redirect to `financialmodelerpro.com`.

Navbar uses plain `<a>` with absolute URLs via `NavbarServer.absolutizeHref()` + file-level `APP_URL` / `LEARN_URL` constants (never raw `process.env`).

## Design System

Single source of truth: `app/globals.css`. Tokens: `--color-primary*`, `--sp-1..5` (8px grid), `--font-h1..micro`. Component classes: `.card`, `.kpi-card`, `.btn-primary`, `.table-standard`, `.input-assumption` (yellow assumption cells). Per-platform input variants documented in the platform's MD (REFM FAST navy-pale input lives in `src/hubs/modeling/platforms/refm/components/modules/_shared/inputStyles.ts`). Never use Tailwind utility classes for layout tokens.

## Deployment + Health

Vercel auto-deploys on push to `main`. Environment variables documented in `.env.example` + the Vercel dashboard. Key ones: `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `NEXTAUTH_SECRET` / `NEXTAUTH_URL` / `BREVO_API_KEY` / `HCAPTCHA_SECRET_KEY` / `ANTHROPIC_API_KEY` / `CRON_SECRET`.

```bash
npm run type-check   # tsc --noEmit (zero errors required)
npm run build        # next build --webpack (avoids MAX_PATH on Windows/OneDrive)
npm run verify       # type-check + lint + build
```

`GET /api/health` -> `{ status: 'ok', platform: 'financial-modeler-pro', version: '3.0', timestamp }`. Per-platform verifier scripts live in the platform's MD (REFM = `npx tsx scripts/verify-*.ts`, 25 scripts; current counts in [CLAUDE-REFM.md](CLAUDE-REFM.md)).
