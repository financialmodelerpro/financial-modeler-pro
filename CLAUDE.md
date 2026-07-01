# Financial Modeler Pro, Claude Code Project Brief
**Last updated: 2026-06-30.**

**Module status (REFM platform), one line each. Full narrative + commits live in [CLAUDE-REFM.md](CLAUDE-REFM.md), NOT here:**
- **Module 1 (Setup / Costs / Financing)**: LOCKED at M2.0 Pass 58 (base). Funding Methods 2/3 gap-sized; conditional IDC + iterative fixed-point solver. Financing sub-tabs: Inputs / Schedules / Funding Gap / Cash Sweep. Dividends are ONE project-level after-debt policy (`Project.dividendPolicy` + `dividendStartYear`) with a terminal 100% payout in the engine.
- **Module 2 (Revenue + CoS + Schedules + Escrow)**: LOCKED at Pass 9N.
- **Module 3 (Operating Expenses)**: LOCKED at Pass 5d.
- **Module 4 (Financial Statements)**: DONE. Schedules / P&L / CF / BS. BS balances by construction; Direct CF == Indirect CF every period. Phase-filtered P&L stops at EBITDA; phase CF shows Operations+Investing; BS is consolidated-only. P&L/CF/BS render from shared pure builders (`lib/reports/m4Reports.ts`) that the on-screen tabs AND the PDF both consume.
- **Module 5 (Returns & RE Metrics)**: DONE. Sponsor-IRR view (FCFF / FCFE / Distributed Equity + terminal value + RE metrics + per-asset + Case Comparison). RE Metrics tab carries editable Lender Covenants (DSCR / ICR / Debt Yield + LTV at peak debt = debt / GDV, since LTV at exit is a trivial 0%); pure display layer over the snapshot, no engine change.
- **Module 6 (Scenario Analysis)**: LIVE. A surface over the case engine (no engine rebuild): case list, multi-case assumptions grid (model-aware curated levers + config-inert gating, exhaustively field-audited on the live project), comparison matrix, and a Year-on-Year Impact tab (per-period divergence per case; debt/equity split deduped to one block; debt drawdown is principal, excludes IDC). Presentation in `lib/cases/assumptionGrid.ts` + `lib/reports/caseYoYReport.ts`; engine `applyOverrides`/`snapshot-diff` untouched. Was "Reports"; swapped with Module 7.
- **Module 7 (Reports & Visualizations)**: stub (next module surface).
- **Cases (scenarios)**: Management base + override cases; the active case drives the WHOLE model + all exports (not just the comparison); topbar switcher + Returns Case Comparison + the Module 6 page; per-input "≠ Management" override badge; scenario edits in the change_log; viewing a case never starts an edit session. Engine `lib/cases/applyOverrides.ts` (value-only overrides, base never mutated; per-element grammar via `snapshot-diff.PER_ELEMENT_ARRAYS`).
- **Platform infra**: project-switch state-leak fixed; session-based versioning + per-version change_log. **View/edit lock**: a project opens read-only (no version churn) until you click Edit, which presents an **Edit choice** (edit this version in place / edit a different version / create a new version) plus a mid-session **Save as new version** (`startEditInPlace` / `saveAsNewVersion` in `lib/persistence/module1-sync.ts`); schema-tolerant reads; paginated version history. **PDF full-project report** (`lib/pdf/generateProjectPdf.ts` on pdf-lib) mirrors every module tab via shared `lib/reports/` builders (m4/opex/capex/financing/cos), with per-module part picker + number-scale + **version picker** in `ExportModal` (file named after the chosen version). **Excel MODEL export** (`lib/excel/buildModelWorkbook.ts`): a HARDCODED platform snapshot (every computed cell is the platform value written as a constant, editing does NOT recalculate, re-export after changing inputs), now a FULL module-for-module mirror of every module. 14 tabs in MODULE ORDER (Cover, Inputs, Timeline, Land & Area, Capex, Financing, Revenue, Opex, Schedules, P&L, Cash Flow, Balance Sheet, Returns, Checks); each output tab is a section-for-section mirror built from the SAME shared `lib/reports/` builders + snapshots the on-screen tabs use. Inputs holds EVERY input grouped by domain band in module order (Project / Phases / Land / Assets / Sub-units / Returns / Capex, then FINANCING / REVENUE / OPEX INPUTS). ONE standard navy palette (navy tabs + totals, deep-navy section bands, pale-navy subtotals, navy-pale inputs, red only for genuine check failures); the verifier locks the palette + tab order. Verifier `verify-excel-export` 129/129; two-way Sensitivity grid (Returns) is the one pending unit. **Auto-updating platform walkthrough guide** (`lib/guide/`, Topbar "Guide" button): in-app view + PDF/Markdown download, structure derived from the MODULES + MODULE_TABS registries.

- **Entitlements & Pricing (LIVE, 2026-06-22)**: admin-controlled plan/feature system on `features_registry` + `plan_permissions` + `entitlement_plans` + `user_permissions` (migs 158-165). **Resolver** `src/shared/entitlements/resolveOverrides.resolveEffectiveFeatures` (plan coverage + per-user overrides, override-wins, expiry-ignored) is REUSED everywhere; the live REFM gate (`resolveUserGate` + `gate.ts`, reads the live `users` row not the JWT) enforces module/export/scenarios/save+versioning/branding/sensitivity, the project cap (active = non-archived, mig 161 `refm_projects.archived`), and trial expiry. Admin never blocked; unknown plan = access-preserving safety net. **Admin (one consolidated Users tab + Plan Builder)**: `/admin/users` (+ `/admin/users/[id]` = the merged former "User Access" panel: resolved entitlements, grant/revoke overrides, plan assign, trial) and `/admin/plans` (features + limits + price + Most-Popular/badge + non-module visibility + Trial **length (days)** + coupons). **ONE shared plan-setting path** `setUserPlan`. **Plans reconciled** to trial/solo/pro/firm (mig 160). **Pricing single source of truth = entitlement_plans** (prices mig 162, popular/badge mig 163, feature visibility mig 164, trial_days mig 165). **UNIFIED + path-based (2026-06-25):** ONE shared `app/pricing/PricingPageBody.tsx` (server-loads via `loadPricingCatalog`) renders the polished `PricingExplorer` (platform picker -> per-platform `LivePlanCards` + comparison) in BOTH contexts. The `PricingExplorer` island is SESSION-AWARE: logged-out keeps the `/register` handoff, logged-in runs in-app checkout/trial + resume (no separate marketing-vs-app design or URL). **Clean per-platform URL `/pricing/<segment>`** (`app/pricing/[platform]/page.tsx`): segment SOURCE-DERIVED via `platformPricingSegment`/`platformSlugForSegment` in `src/hubs/modeling/config/platforms.ts` (shortName lowercased, REFM->refm, slug fallback; unknown -> picker). Bare `/pricing` = picker. Dashboard "Get access" + live-platform marketing CTA both link the SAME `/pricing/<segment>`; old `?platform=`/`/modeling/pricing` redirect (next.config). hero/FAQ stay Page Builder; footer legal links publish-status driven. `platform_pricing` + `/admin/pricing` retired. **Payments LIVE (Paddle adapter implemented, sandbox):** provider-agnostic `src/shared/payments/` (adapters paddle[implemented]/paypro[stub], registry, config, signature); checkout route -> active provider adapter -> Paddle.js overlay (`paddleBrowser.ts`, client token only); webhook `/api/payments/webhook/[provider]` verifies HMAC + reuses `setUserPlan` (idempotent). `paddleEnv.paddleEnvMismatch` guards sandbox/live token mismatch; `/admin/payments` badge = client_token+webhook_secret (Paddle Billing has no api_secret). Verifiers: `verify-entitlement-gate` 92, `verify-payments-structure` 65, `verify-subscription-management` 204, `verify-trial-days` 7, `verify-pricing-display` 23, `verify-user-overrides` 13, `verify-footer-legal-links` 12, `verify-plan-builder-modules` 16, `verify-pricing-application-ready` 49, `verify-feature-description` 41. See [CLAUDE-ROUTES.md](CLAUDE-ROUTES.md) + [CLAUDE-DB.md](CLAUDE-DB.md) for the per-route/migration detail.

- **Subscription Management & Billing (2026-06-29, sandbox-first)**: full self-service + admin billing on top of the single plan path. **Diagnostic webhook logging** (`[payments-webhook]` arrived/verified/rejected). **In-dashboard billing tab** (modeling dashboard in-page `activeView`; `BillingView` + `SubscriptionPanel`): per-platform subscriptions (mig 177 `user_platform_subscriptions`, one section per live platform, source-driven), view/cancel-at-period-end/invoices (in-app iframe viewer)/update-card (Paddle hosted), upgrade/downgrade with the target plan's full feature list + a Paddle **preview** differential (PATCH /subscriptions/{id}/preview) + monthly<->annual interval change, and the **timing rule** (upgrade immediate / downgrade deferred to next cycle via mig 178 scheduled cols + the `apply-scheduled-changes` cron, daily in vercel.json). **Single source of truth** (mig 179): `setUserPlan` keeps the per-platform row (store B) in sync on EVERY plan write so the gate (store A) + billing panel + admin views never diverge: a MANUAL plan writes the full row (source manual, dates, amount); every other caller (trial shortcut, self-serve trial, approval queue, the webhook's setUserPlan call) does a PARTIAL `syncPlatformSubscriptionFields` UPDATE-only of `plan_key`+`status` that PRESERVES webhook-owned metadata (source, paddle ids, Paddle dates) and is a no-op when no row exists (no fabricated `paddle`-defaulted row). All trial paths now also apply the SAME live-Paddle guard the plan route uses (shared `PADDLE_BILLED_BLOCK_MESSAGE` + `isUserLivePaddle`, 409) so a Paddle-billed user is never silently moved to trial; the `/admin/users` status dropdown converges store B status manual-only (never clobbers Paddle status). gate honors `expires_at` (additive only; mirrors trial). (2026-06-30: convergence-at-source fix, closes the admin-Trial-vs-billing-Firm divergence from any path; gate access logic unchanged.) **Manual (offline/bank) plans**: admin assigns plan+start+expiry+amount in `/admin/users/[id]`; live-Paddle users are BLOCKED from a silent change. **Admin Revenue** (`/admin/revenue`, mig 180 `payment_transactions` ledger): total + Paddle(reconcilable)/manual split, by month/year/custom + by plan, DB-aggregated. **Convert-to-manual** (safe): period-end default (cancel Paddle at period end + scheduled conversion applied by the subscription.canceled webhook / cron) or immediate (warned). All Paddle calls server-side; key never client-side. Resolver/gate core + admin bypass + none/unknown UNCHANGED. Verifiers: `verify-subscription-management` 204, `verify-entitlement-gate` 92. **Migs 176-180 each were applied to prod as shipped (176-180 done).** Founder TODO: set the server Paddle API key in Admin>Payments (scopes subscription.read+write, transaction.read) to light up the Paddle-side flows. Per-route/migration detail in [CLAUDE-ROUTES.md](CLAUDE-ROUTES.md) + [CLAUDE-DB.md](CLAUDE-DB.md).

- **Post-expiry access (read-only grace + lapse, 2026-06-30)**: a plan that expires no longer drops to instant lockout. The gate now computes a THREE-STATE lapse model purely from the plan's expiry date (the "lapse anchor"): **active** (`now < expiry`, full access), **grace** (`expiry <= now < expiry + 1 calendar month`, READ-ONLY: can log in + view projects, but edit / save / export / create / archive denied + a renew banner), **lapsed** (`now >= expiry + 1 month`, NO platform access like `none`, account still logs in, data NEVER deleted). Anchor priority (`resolveLapseAnchorMs` in `gate.ts`, shared by the live gate AND the admin list): trial -> `users.trial_ends_at`; manual -> `user_platform_subscriptions.expires_at`; canceled/expired Paddle -> `current_period_end` (active renewing -> no anchor). Pure helpers `computeLapseState` + `addCalendarMonths` + `writeBlockReason` (`READ_ONLY_GRACE` | `LAPSED`) in `gate.ts`; `computeGate` gains `lapseState`/`readOnly` (grace KEEPS the feature map so projects stay VIEWable; lapsed = denied like none). **Server-side read-only enforcement** at every write choke point: `POST /api/refm/projects` (create), `.../[id]/duplicate`, `.../[id]/versions` (save = the edit choke point), and the `/api/export/{pdf,excel}` routes via shared `src/shared/entitlements/exportGuard.assertExportAllowed` (the live export is client-side, so `ExportModal` read-only gate is the genuine point + the routes are defense-in-depth). `/refm` layout redirects LAPSED (not grace) to `/choose-plan` via `isNoPlanLockedOut(plan, isAdmin, lapseState)`; dashboard treats lapsed like no-plan. UI: grace renew banner + workspace read-only lock + suppressed Edit/Save/Export/New in `RealEstatePlatform`. **Admin user list** (`/admin/users`): new **Access** (auto active/grace/expired-lapsed by date) + **Expires** columns, computed server-side in `/api/admin/users` with the SAME shared helpers (no divergence from the live gate, correct between cron runs). **Admin bypass + none/unknown distinction UNCHANGED; no migration (reuses migs 177/179 columns); no data ever deleted.** Backward-compat: the legacy `trialExpired`/`planExpired` booleans (no `lapseState`) still map a full expiry to `lapsed`. Verifier `verify-entitlement-gate` 92 (adds grace/lapsed/read-only/anchor/admin-bypass-survives-grace cases).

- **Subscription email lifecycle (2026-07-01, Brevo, branded from financialmodelerpro.com)**: full lifecycle emails via the existing `src/shared/email` stack (`baseLayoutBranded` + `sendEmail`, sender `FROM.noreply`; `sendEmail` gained additive `attachments`, `FROM.support` added). Nine branded templates in `templates/subscription.ts`; dispatch + cron scan in `subscriptionEmails.ts` (self-contained, NEVER throws to caller). **Transactional** (wired at the trigger): welcome/active Paddle (webhook `activated` only, with the invoice PDF fetched SERVER-SIDE via `getInvoicePdfUrl` and attached + a `/dashboard#billing` link), welcome/active manual (admin plan route + convert-to-manual immediate, start/expiry, team-managed no-invoice, skips none/trial), canceled confirmation (self-service cancel route, "access until [period end]"), trial started (self-serve `startTrialForUser` + admin shortcut + approval queue). **Time-based** (daily cron `GET /api/cron/subscription-reminders`, CRON_SECRET, 10:00 UTC, added to vercel.json) at 1 week + 1 day before the date: trial ending (`trial_ends_at`), auto-renewal charge notice ("you'll be charged [amount], cancel before then") for auto-renewing Paddle only, ending-plan expiry ("access ends, renew") for manual + canceled Paddle. **Grace** emails: grace started (on first run after expiry) + grace ending (1wk/1d before grace end = expiry + 1 calendar month), reusing the gate's `computeLapseState`/anchor helpers (NO gate change). Auto-renew vs ending are DISTINCT (classified via a server-side `getSubscription()`; charge notice suppressed on uncertainty so a canceled sub never gets "you'll be charged"). **Idempotent + deduped** via `subscription_email_log` (mig 181, APPLIED 2026-07-01): claim-then-send keyed on (user, platform, type, threshold, anchor_day), so no double-sends and the cron is safe to re-run; anchor_day lets a renewal reminder re-fire for a new period. All Paddle calls server-side. Verifier `verify-subscription-emails` 45 (renders templates + asserts the charge-vs-ends distinction + every trigger wiring + dedupe + cron). Resolver/gate/enforcement UNCHANGED (`verify-entitlement-gate` 92).
- **Billing display fixes + manual invoices (2026-07-01)**: (1) subscription email footer standardized to the FMP company line "A PaceMakers Business Consultants Platform" (matching the pricing credibility line) via a `baseLayoutBranded` overrides param + a `subLayout` wrapper, replacing the Training Hub tagline. (2) **Paddle-wins source fix**: `storeUserPlatformSubscription` now sets `source:'paddle'` (+ clears stale manual `expires_at`/`amount_minor`/`note`) on activation, and `loadUserPaddleContext` treats a row as manual ONLY when there is no `paddle_subscription_id`, so a Paddle sub created over a prior manual record shows the Paddle subscription (not the stale "Managed by your team"). Billing-panel resolution only, NOT the gate. (3) **Combined invoices**: `/api/payments/invoices` merges Paddle invoices + manual receipts into one normalized `{id,source,...}` list; the panel renders it (+ viewer) in both the manual and Paddle branches, routing View by source. (4) **Manual invoices** (mig 182 `manual_invoices` + private `invoices` bucket): admin manual-assign / convert-to-manual-immediate with an amount generates an FMP + PaceMakers branded receipt PDF (`src/shared/payments/manualInvoice.ts`, pdf-lib), stores it privately, emails it (PDF attached), and lists it in billing; served via ownership-checked `GET /api/payments/manual-invoice/[id]` (short-lived signed URL). All Paddle calls server-side; resolver/gate/enforcement UNCHANGED. Verifier `verify-subscription-emails` 65 (renders a real receipt PDF). Mig 182 APPLIED 2026-07-01.
- **Account area cleanup (2026-07-01)**: the grace renew banner now ALSO renders on the modeling **dashboard** (`app/modeling/dashboard/page.tsx`, `data-testid="dashboard-grace-banner"`, gated on `ent.lapseState === 'grace'` from `useEntitlements`), so a grace user sees read-only-until-[date] + Renew on login, not only inside the workspace; lapsed still routes to `/choose-plan`. **Settings** (`app/settings/page.tsx`): the redundant Subscription card (Plan/Status/Projects/Upgrade) was REMOVED, it read the legacy `users.subscription_plan` off the NextAuth session (default `'free'`, a dead source separate from the entitlement gate, the cause of the stale "Plan: Free" display, and the ONLY user-facing reader of it), so the dashboard Billing tab is now the single subscription surface. Profile card gained editable **Company + Job Title (required) + Phone + City (optional)** and **profile-image upload/replace** (initials fallback). New authenticated `POST /api/user/avatar` -> `avatars` storage bucket (2 MB, jpg/png/webp) + `users.avatar_url`, shown in Settings + dashboard header/sidebar; `/api/user/profile` GET/PATCH extended (schema-tolerant, `action=profile`). No migration (avatar_url mig 002, company/job_title 172, phone/city 027 already exist). Resolver/gate/enforcement UNCHANGED; `verify-entitlement-gate` still 92.

Verifier reality + outstanding ops (migrations pending on prod) live in [CLAUDE-REFM.md](CLAUDE-REFM.md). Full suite green via `npx tsx scripts/verify-*.ts`.

**M2 lock conventions** (apply to M3+ unless overridden):
- The reference Excel at repo root is the verification benchmark, not a behavioural spec. Every reference-specific behaviour stays configurable; never hard-code currency, locale, escrow, or DSO defaults into engine paths.
- Engine storage is project-axis-indexed (`arr[0]` = first active project year). Only the UI window changes per asset / strategy.
- Vintage matrices (cohort year × cash year, cohort year × recognition year, capex year × CoS year) are the canonical mechanic for both recognition and cash distribution.
- PIT recognition handover = LAST construction year (`phaseStart + cp − 1 − projectStart`), NOT first operations year. Verifier A2-1..A2-5 pin this.
- See CLAUDE-REFM.md for the full Pass 7-9 narrative; older pass detail is archived to CLAUDE-FEATURES.md.

> **See also:**
> - [CLAUDE-MODELING-HUB.md](CLAUDE-MODELING-HUB.md), Modeling Hub wrapper, platform catalog, P-Sync admin conventions
> - [CLAUDE-REFM.md](CLAUDE-REFM.md), Real Estate Financial Modeling (REFM), platform status (Modules 1-7) + conventions + Excel/PDF export
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
| REFM platform (Real Estate, Modules 1-7) | **+ CLAUDE-MODELING-HUB.md + CLAUDE-REFM.md.** `app/refm/` `app/modeling/` `src/components/refm/` `src/lib/modeling/` `src/hubs/modeling/platforms/refm/` `src/core/calculations/` |
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

`GET /api/health` -> `{ status: 'ok', platform: 'financial-modeler-pro', version: '3.0', commit, timestamp }` (`commit` = `VERCEL_GIT_COMMIT_SHA`, so the deployed revision is verifiable: compare to `git rev-parse HEAD`). Per-platform verifier scripts live in the platform's MD (REFM = `npx tsx scripts/verify-*.ts`; current script list + counts in [CLAUDE-REFM.md](CLAUDE-REFM.md)).
