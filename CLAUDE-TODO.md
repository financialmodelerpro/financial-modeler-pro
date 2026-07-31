# Pending Work & Backlog

> Forward-looking only: active follow-ups, in-progress work, backlog, legacy reference. Completed phase narratives live in **CLAUDE-FEATURES.md** (archive) and `git log` (authoritative). Do not re-add "Recently Completed" sections here when closing a phase, write the closure into CLAUDE-FEATURES.md instead.

---

## PARKED FOR DISCUSSION, the AI_REVIEW_GUIDE.md audit (2026-07-31)

`AI_REVIEW_GUIDE.md` sits at the repo root, **untracked**, and is scheduled for discussion on 2026-08-01. It is a repository audit dated 2026-07-31 that was NOT produced by any Claude Code session on this project (no session transcript references it, and it has never been committed on any branch). **Treat it as untrusted input**: of the claims checked so far, one was materially wrong and one proposed the wrong fix. It is useful, not authoritative.

**Status of each finding, verified rather than assumed:**

| Finding | Status |
|---|---|
| Critical: open email relay, `/api/email/send` | **RESOLVED by deletion**, commit `921135b4`. Verified live: the endpoint now 404s. Note the audit's fix direction ("make auth mandatory") was WRONG: the endpoint had no caller at all, so securing it would have hardened a stale name around dead code. Deleted instead, with the misnamed `RESEND_WEBHOOK_SECRET`, the orphaned `accountConfirmation` template, and the dead `resendRegistrationId()` Apps Script helper |
| Critical: transcript generation by regId+email | **CLOSED BY DECISION.** Public by design, confirmed by Ahmad. Do not re-report |
| Critical: certificate PII via public lookup | **CLOSED BY DECISION.** Same |
| High: certificate-image lookups | **CLOSED BY DECISION.** Same |
| High: transcript-link, "require owner session on GET, POST and DELETE" | **PARTLY WRONG, and one piece still open.** DELETE already validates the `training_session` cookie (`route.ts:134`), so the audit is wrong there. Read access is closed by the decision above. **`POST` remains an unauthenticated WRITE**: any caller can mint a share-link row for any regId+email+courseId. Disclosure-by-design does not answer a write path. Raised once, not re-raised, awaiting a decision |
| High: stored XSS via unsanitized CMS icon HTML, `app/(portal)/page.tsx:463` | **NOT VERIFIED.** No diagnosis run |
| Medium: unsanitized newsletter HTML in the admin browser, `NewsletterTab.tsx:541` | **NOT VERIFIED** |
| 4 correctness / React findings (hook order, render-time random IDs, swallowed fetch failures, sync effect updates) | **NOT VERIFIED** |
| Quality gate: "lint failed with 401 errors and 268 warnings" | **CONFIRMED EXACTLY.** `npm run lint` reports `669 problems (401 errors, 268 warnings)` as of 2026-07-31. Type-check passes |

**For the discussion:** the unverified items are the actual agenda, since the security items are either resolved or closed by decision. The two XSS-shaped findings are the highest-value things left to check, and the lint baseline is a real and independently confirmed blocker to using lint as a CI gate.

**Housekeeping:** the file is untracked, so a working-tree clean would lose it. It has deliberately never been committed (Ahmad's instruction on 2026-07-31). Decide whether to commit it or move it out of the repo.

---

## ⭐ START HERE (current focus, 2026-06-17)

**REFM Modules 1-6 are built; Module 7 Reports is the next module surface.** The **Excel MODEL export** (`lib/excel/`) and **PDF export** (`lib/pdf/`) are complete module-for-module mirrors. The Excel export is a HARDCODED platform snapshot (every cell = the platform value as a constant; editing does NOT recalculate, re-export after changing inputs), one standard navy palette, tabs in module order; `verify-excel-export` 129/129. Module 6 Scenario Analysis is DONE (case-engine surface + multi-case assumptions grid with per-asset cost sourcing + attribution + percent-scale formatting + comparison matrix + a Year-on-Year Impact tab; exhaustively field-audited on the live project; `verify-module6-scenarios` 128/128). Version control: a project opens read-only (view/edit lock) and Edit offers edit-in-place / a different version / create-new + mid-session save-as-new (no more version churn). The earlier formula-driven Excel approach was retired in favour of this hardcoded mirror.

**NEXT / pending units:**
- **Module 7 Reports** (charts / dashboards): the remaining module surface (config: `module7` = Reports, currently a stub).
- **Two-way Sensitivity grid** on the Excel Returns tab: the one Module 5 section not yet mirrored (the on-screen + PDF grid already exist via `computeReturnsSensitivity`).
- **Scenario re-basing** in Module 6: promote a non-base case to base (deferred; needs per-case override recompute against the new base).
- Per-element override grammar can extend beyond `parcelFunding` if a scenario needs per-period velocity / profile curves (today those stay whole-array auto-capture).

---

## FLAG FOR REVIEW, `src/middleware.ts` has never run in production (2026-07-30, DECISION NEEDED)

Verified, not suspected: `app/` is the project source root and there is no `src/app`, so Next resolves middleware at the ROOT (`middleware.ts`) and `src/middleware.ts` is never compiled. `.next/server/middleware-manifest.json` is `{"middleware":{}}`, the build output never mentions middleware, and `/admin/cms`, `/admin/users`, `/admin/revenue` all return **200 unauthenticated** in production. The `/login` + `/admin/login` 307s that made it look alive come from `next.config.ts` redirects (which even comment that they are the primary handler).

**Severity is contained.** All 118 `/api/admin/*` routes are individually guarded (verified 401/403 unauthenticated), and admin pages render an empty client shell that `useRequireAdmin` bounces. So no data is exposed. What is missing is the documented defence-in-depth layer.

**Do NOT just move the file to the project root.** That ACTIVATES a gate that has never executed in production. If the NextAuth JWT `role` claim is not populated as `getToken` expects, every admin is locked out on the next deploy. Sequence: confirm the claim shape on a live token first, then move, then verify `/admin/*` still loads for an admin before it reaches prod. Root CLAUDE.md "Do NOT touch list" has been corrected to record the real state.

---

## FLAG FOR REVIEW, `refm_project_versions` exceeds the PostgREST 1000-row cap (2026-07-30, CORRECTNESS)

The table holds **1,399 rows**; an unbounded `select('*')` returns exactly **1,000** (18.9 MB) and silently drops the rest. PostgREST caps at 1000 by default and does not error. Any read in `src/hubs/modeling/platforms/refm/lib/persistence/server.ts` (11 query sites) that lacks an explicit `.range()` is already losing 399 rows.

This is a data-correctness bug, not a perf issue, and it grows. Audit each site and paginate the ones that must return everything (see the `paginate-large-tables` pattern). Not attempted yet; out of scope of the 2026-07-30 perf pass.

---

## PERF BACKLOG, Phases 2 to 4 (2026-07-30, diagnosed + measured, NOT applied)

Phase 1 shipped (parallelised sequential admin count queries: newsletter subscribers 1569ms -> 277ms, admin dashboard 855ms -> 281ms). The bigger wins are all still open, ranked by payoff per unit of effort:

1. **11.6 MB of unoptimized, uncacheable PNGs on the marketing home. Biggest single win, close to trivial.** Includes a **4.1 MB favicon** (`cms_content.header_settings.icon_url`, served as `<link rel="icon">` on every page of all three properties) and a 4.25 MB founder photo. Every one returns `Cache-Control: no-cache` from Supabase storage, so even with an ETag each navigation pays a blocking revalidation round-trip per image. Only 1 file in the repo uses `next/image` against 80 raw `<img>`; `next.config.ts` has no `images` config. Fix: resize + WebP, set a long `cacheControl` on the storage objects.
2. **Nothing is cached anywhere.** Zero `unstable_cache` / `'use cache'` / React `cache()` / `revalidateTag` in the codebase, and the busiest marketing pages are explicitly `revalidate = 0` (portal home, articles, contact, about, pricing, modeling, training). Result: `x-vercel-cache: MISS` on every hit, full SSR in `iad1` for every visitor. Measured cold start ~3.1s.
3. **Root-layout tax on every page sitewide.** `generateMetadata()` runs a `cms_content` query before `<head>` can flush, and `<PromoBanner />` is an async server component with no Suspense boundary costing 2 more Supabase queries. Latent landmine: the moment a Paddle API key is set, PromoBanner adds a live `GET api.paddle.com/discounts` to every page render (cached only 60s per lambda instance).
4. **Admin renders nothing server-side.** `app/admin/layout.tsx` is `'use client'` and returns `null` until `useSession()` resolves, so every admin page is a 5-hop serial waterfall (HTML shell -> ~520 KB JS -> `/api/auth/session` -> mount -> `/api/admin/*`). The layout gate is also redundant with the (currently dead) middleware.
5. **Heavy libs eagerly bundled**: pdf-lib 412 KB on `/admin/certificate-designer`, recharts 348 KB on `/admin/analytics`, tiptap/prosemirror ~340 KB on page-builder / communications-hub / live-sessions. All `next/dynamic` candidates.
6. **No streaming boundaries**: zero `loading.tsx` files in `app/`, so the slowest query on a page gates first paint for the whole page.

Not a problem, checked: fonts (self-hosted `next/font` Inter, preloaded), all script tags `async`, single 62 KB CSS bundle, no oversized assets in `public/`.

---

## FLAG FOR REVIEW, Existing-operations / historical-baseline inputs not consumed by the compute pipeline (2026-06-17)

Surfaced by the Module 6 exhaustive per-field audit on the live FMP RE HUB project (`verify-module6-field-census.ts`). About 11 existing-operations inputs are EMPIRICALLY inert, an override changes nothing in the full financials + returns snapshot:

- `phases[id=*].historicalBaseline.*` (currentAdr, historicalDebtDrawn, historicalCapexTotal, currentDebtOutstanding, last12MonthsRevenue, last12MonthsOpex, netBookValueFixedAssets, historicalEquityContributed, cumulativeDepreciationCharged)
- `assets[id=*].historicalPreCapex`
- `assets[id=*].historicalDebtAmount`

This is notable because the live project DOES show a Total Financing Cost of ~820M and a finite Min DSCR, i.e. debt is being serviced, yet perturbing the historical debt / capex / baseline inputs moves NO computed output. So either (a) existing-operations debt/equity/baseline is meant to seed the base model and is being silently dropped on the path `computeFinancialsSnapshot → computeReturnsSnapshot`, or (b) these are legacy fields superseded by another input and should be removed. The audit currently DROPS them from the Module 6 picker with the reason "existing-operations baseline input; not consumed by the scenario compute pipeline (audit finding)", so they are not silent dead levers in the grid, but the underlying engine question is unanswered.

Needs a SEPARATE engine-level investigation (not a Module 6 change). Do NOT alter the historical/operational baseline wiring silently; confirm intended behaviour first. Operational-phase fixture required (FMP RE HUB phase_1 is operational, so it reproduces).

---

## RESOLVED BY DELETION, the RESEND_WEBHOOK_SECRET rename (closed 2026-07-31)

This was a bookmarked plan to rename `RESEND_WEBHOOK_SECRET` to `EMAIL_BRIDGE_BEARER_SECRET`, on the premise that the variable had ONE live use: the bearer token for `POST /api/email/send`, "the Google Apps Script email bridge".

**The premise was wrong, and the rename was never needed.** Diagnosis on 2026-07-31 established that the endpoint had no caller at all:

- Zero callers anywhere in the tree. Nothing imports the route; no client, server, or cron call exists.
- All 8 templates it served already had native in-app senders through `sendEmail` (Brevo). The 8th, `accountConfirmation`, had no caller at all and was superseded by `confirmEmailTemplate`.
- `CLAUDE-FEATURES.md` recorded, at the Brevo migration itself (commit `166a8ecb`, 2026-05-11), that the last three Apps Script email triggers had been moved into Next.js and the bridge was "kept for backwards compat". It was a compatibility shim, not a dependency.
- Apps Script handles exam questions only; it does not send platform email. Our own Apps Script client is outbound-only.
- `RESEND_WEBHOOK_SECRET` was never set in Vercel, so the `if (secret)` gate never ran: the endpoint accepted unauthenticated requests in production and would render any of 8 branded templates, to any recipient, with caller-supplied data. That is phishing-grade, from a domain that passes SPF and DKIM.

**Action taken instead of the rename:** the route, the orphaned template, the dead `resendRegistrationId()` Apps Script helper, and the env var were all DELETED. Renaming would have hardened a stale name around an endpoint that should not exist. Nothing to carry forward.

Standing lesson: a "live dependency" recorded in a commit message is an assertion, not evidence. This one was inherited across two sessions and a Resend purge before anyone tested it.

---

## In Progress

| Feature | Current State | What Remains |
|---------|--------------|--------------|
| **AI Agents** | Market rates + research agents wired | Contextual help agent (stub only) |
| **Pricing / Subscriptions** | **LIVE (paid tiers shipped).** The plan/entitlement + payment system is built and enforced: admin Plan Builder (`entitlement_plans` + `plan_permissions` + `features_registry` + `user_permissions`, migs 158-168), the live REFM gate (`resolveUserGate` + `gate.ts`) enforcing modules/exports/scenarios/versioning/branding/project cap/trial + grace-lapse, unified pricing pages (`/pricing/<segment>`), and the Paddle billing system (adapter + webhook + in-dashboard billing tab + upgrade/downgrade + cancel + convert-to-manual + manual invoices + revenue ledger + subscription lifecycle emails, migs 170-183). See CLAUDE.md (Entitlements / Subscription-management / Post-expiry-grace / Subscription-email sections) + CLAUDE-DB.md for detail. | Backlog: Brevo engagement webhook (open/click/bounce) to replace the removed Resend webhook; wire the server Paddle API key in Admin>Payments to light up live Paddle-side flows (founder task). |
| **Branding** | Brand Colors section moved into `/admin/header-settings` (2026-04-28, commit `ab5db30`). `/admin/branding` is a 5-line redirect. Drives `--color-primary` / `--color-secondary` via `BrandingThemeApplier`. | None, Header Settings owns brand colors + logos + favicon + header text + header layout in one place; Page Builder owns page copy. |

---

## REFM Module Status (2026-06-17)

Current LIVE status. For per-pass narrative see [CLAUDE-REFM.md](CLAUDE-REFM.md) + memory `project_*` files.

| Module | Name | Status |
|--------|------|--------|
| Module 1 | Project Setup / Costs / Financing | **LOCKED** at M2.0 Pass 58 (base). Funding Methods 2 + 3 calculate + gap-size the drawdown (2026-06-01); Funding Gap + Cash Sweep + Dividend waterfall live. |
| Module 2 | Revenue + CoS + Schedules + Escrow | **LOCKED** at Pass 9N. |
| Module 3 | Operating Expenses | **LOCKED** at Pass 5d. |
| Module 4 | Financial Statements | **DONE.** Schedules / P&L / CF / BS. Balances by construction (BS reconciles AND Direct == Indirect closing cash every period). |
| Module 5 | Returns & Valuation | **DONE.** IRR/MOIC on FCFF/FCFE/Dividends + terminal value + RE metrics + multi-partner returns + exit / sensitivity / per-asset. Tabs: Returns / RE Metrics / Case Comparison. |
| Module 6 | Scenario Analysis | **DONE (grid 2026-06-15, b9281cae).** Surface over the case engine: case list, multi-case **assumptions grid** (rows grouped by category with plain-English labels + asset/phase/facility attribution, columns = every case incl. an editable Management; curated key-driver default + "show all" toggle + add-row picker), comparison matrix, and a **Year-on-Year Impact tab** (per-period divergence per case; debt/equity split deduped to one block; drawdown is principal, excludes IDC). Construction levers are MODEL-AWARE: per-asset `costOverrides` win over the phase-level master (real rates, not 0/stale seed), zero/unused dropped. Percent-scale detection per field (fractions 0-1 vs whole 0-100) renders all percents at 2dp; rates/prices accounting. Exhaustively field-audited on the live project (`verify-module6-field-census`). Only the construction-timeline override stays on the backlog. |
| Module 7 | Reports & Visualizations | Stub (next module surface). |

**Cases (scenario management), shipped 2026-06-03:** Management Case = base; Downside + Upside are field-override cases (renamable, add custom). Topbar Case switcher + Returns Case Comparison tab. Engine `lib/cases/applyOverrides.ts` (merge) + `lib/cases/assumptionGrid.ts` (grid labels / categories / curated set), verify-cases 35/35. See the NEXT SESSION block above for follow-ups.

## Remaining backlog

**Module 1 financing:**
- Funding Method 2 (Net Funding Requirement) + Method 3 (Cash Deficit Funding) — display-only Funding Gap sub-tab live; wire Net Cash Required output into actual debt drawdown sizing.
- True per-asset financing schedule breakdown across multi-asset phases.
- DSCR breach alerts (M5 dependency).
- Sharia Murabaha / Ijara product templates, multi-currency, refinancing flows.

**Module 4 financial statements (remaining, non-blocking — BS balances + CF methods tie):**
- **D-2** per-asset (phase-filtered) CF revenue ignores DSO (project-level CF correct).
- **D-3** Cash Sweep interest savings full P&L mutation (ships memo-only; BS balances under sweep without it).
- **D-6** P&L + CF phase-filter column (UI parity with BS).
- Per-asset capex non-uniform spread within construction windows (project totals stay exact via financing engine).
- PIT-handover recognition recognises post-handover cohorts at handover (Unearned can go briefly negative); M4 mirrors Module 2 exactly, statements still balance. Optional Module 2 recognition tweak to defer later cohorts.
- ~~BS imbalance / manual reconciliation against reference~~ **RESOLVED 2026-05-25** (escrow + recognition root causes; balances by construction).

**Module 5 returns:**
- Equity waterfall + IRR hurdle math.
- Cash-sweep with full operating cashflow (capex-only proxy ships today as Method 4 placeholder).

**Module 6 scenarios:**
- **Construction-timeline overrides** (future unit, deferred 2026-06-15): let a scenario override construction duration / start delay (`phases[id=X].constructionPeriods` / `constructionStart` / `startDate`). These are scalar phase fields that round-trip the grammar, but a value-only override is INSUFFICIENT: the engine reads them to derive the period axis + handover, while the per-phase `byPhase` revenue / opex / occupancy arrays and each cost line's baked `startPeriod` / `endPeriod` are stored separately and do NOT move with the scalar (the phase-date cascade was deliberately disabled). Needs a cascade-on-override that re-windows the `byPhase` arrays and recomputes cost-line start/end periods, then recomputes on the corrected axis. Engine/grammar work. Until then the curated levers stay value-only (construction cost rates, contingency %, etc., which DO round-trip cleanly).

**Cross-module:**
- Excel + PDF exports rebuilt against the locked v8 schema.
- Project type-bank presets ("Saudi mixed-use", "Branded residences", "Hotel-led resort") seeded into Tab 2.
- Playwright e2e for the per-asset Costs Inputs surface.

---

## Not Started, Modeling Platforms

| Platform | Slug |
|----------|------|
| Business Valuation Modeling | `bvm` |
| FP&A Modeling Platform | `fpa` |
| Equity Research Modeling | `erm` |
| Project Finance Modeling | `pfm` |
| LBO Modeling Platform | `lbo` |
| Corporate Finance Modeling | `cfm` |
| Energy & Utilities Modeling | `eum` |
| Startup & Venture Modeling | `svm` |
| Banking & Credit Modeling | `bcm` |

All have config in `src/config/platforms.ts` + corresponding rows in `platform_modules` admin table. No platform content yet. When a platform starts active development, create `CLAUDE-{slug}.md` per the per-platform MD convention (see CLAUDE-MODELING-HUB.md).

---

## Legacy Reference

`_legacy_backup/js/refm-platform.js`, 7,599-line original CDN implementation.
- AppRoot: lines 1-70 | State: 72-200 | Calculations: 200-900
- Excel export: 900-1,900 | Project Manager UI: 1,900-3,800
- Main render: 3,800-5,700 | Module 1 UI: 5,700-7,520 | Stubs: 7,520-7,598
