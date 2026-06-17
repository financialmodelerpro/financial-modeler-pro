# Pending Work & Backlog

> Forward-looking only: active follow-ups, in-progress work, backlog, legacy reference. Completed phase narratives live in **CLAUDE-FEATURES.md** (archive) and `git log` (authoritative). Do not re-add "Recently Completed" sections here when closing a phase, write the closure into CLAUDE-FEATURES.md instead.

---

## ⭐ START HERE (current focus, 2026-06-17)

**REFM Modules 1-6 are built; Module 7 Reports is the next module surface.** The **Excel MODEL export** (`lib/excel/`) and **PDF export** (`lib/pdf/`) are complete module-for-module mirrors. The Excel export is a HARDCODED platform snapshot (every cell = the platform value as a constant; editing does NOT recalculate, re-export after changing inputs), one standard navy palette, tabs in module order; `verify-excel-export` 129/129. Module 6 Scenario Analysis is DONE (case-engine surface + multi-case assumptions grid with per-asset cost sourcing + attribution + percent-scale formatting + comparison matrix + a Year-on-Year Impact tab; exhaustively field-audited on the live project; `verify-module6-scenarios` 128/128). Version control: a project opens read-only (view/edit lock) and Edit offers edit-in-place / a different version / create-new + mid-session save-as-new (no more version churn). The earlier formula-driven Excel approach was retired in favour of this hardcoded mirror.

**NEXT / pending units:**
- **Module 7 Reports** (charts / dashboards): the remaining module surface (config: `module7` = Reports, currently a stub).
- **Two-way Sensitivity grid** on the Excel Returns tab: the one Module 5 section not yet mirrored (the on-screen + PDF grid already exist via `computeReturnsSensitivity`).
- **Scenario re-basing** in Module 6: promote a non-base case to base (deferred; needs per-case override recompute against the new base).
- Per-element override grammar can extend beyond `parcelFunding` if a scenario needs per-period velocity / profile curves (today those stay whole-array auto-capture).

---

## FLAG FOR REVIEW, Existing-operations / historical-baseline inputs not consumed by the compute pipeline (2026-06-17)

Surfaced by the Module 6 exhaustive per-field audit on the live FMP RE HUB project (`verify-module6-field-census.ts`). About 11 existing-operations inputs are EMPIRICALLY inert, an override changes nothing in the full financials + returns snapshot:

- `phases[id=*].historicalBaseline.*` (currentAdr, historicalDebtDrawn, historicalCapexTotal, currentDebtOutstanding, last12MonthsRevenue, last12MonthsOpex, netBookValueFixedAssets, historicalEquityContributed, cumulativeDepreciationCharged)
- `assets[id=*].historicalPreCapex`
- `assets[id=*].historicalDebtAmount`

This is notable because the live project DOES show a Total Financing Cost of ~820M and a finite Min DSCR, i.e. debt is being serviced, yet perturbing the historical debt / capex / baseline inputs moves NO computed output. So either (a) existing-operations debt/equity/baseline is meant to seed the base model and is being silently dropped on the path `computeFinancialsSnapshot → computeReturnsSnapshot`, or (b) these are legacy fields superseded by another input and should be removed. The audit currently DROPS them from the Module 6 picker with the reason "existing-operations baseline input; not consumed by the scenario compute pipeline (audit finding)", so they are not silent dead levers in the grid, but the underlying engine question is unanswered.

Needs a SEPARATE engine-level investigation (not a Module 6 change). Do NOT alter the historical/operational baseline wiring silently; confirm intended behaviour first. Operational-phase fixture required (FMP RE HUB phase_1 is operational, so it reproduces).

---

## ACTIVE FOLLOW-UP, Rename RESEND_WEBHOOK_SECRET to EMAIL_BRIDGE_BEARER_SECRET (2026-05-11)

After the Brevo re-migration, the env var name `RESEND_WEBHOOK_SECRET` is misleading: it doubles as the bearer token for `POST /api/email/send` (used by the Google Apps Script bridge) and has nothing to do with Resend anymore. Rename to a vendor-neutral `EMAIL_BRIDGE_BEARER_SECRET` in a future commit. Steps:

1. Add `EMAIL_BRIDGE_BEARER_SECRET` to Vercel env vars with the same value as `RESEND_WEBHOOK_SECRET`.
2. Update `app/api/email/send/route.ts` to read `EMAIL_BRIDGE_BEARER_SECRET` (fallback to legacy `RESEND_WEBHOOK_SECRET` for one deploy cycle).
3. Update Apps Script to send the new header name.
4. Remove the legacy `RESEND_WEBHOOK_SECRET` env var + the legacy fallback after one deploy cycle.
5. Update `.env.example` + `app/api/admin/env-check/route.ts` to reflect the new name.

Out of scope for the email vendor migration; bookmark it here so it doesn't get forgotten.

---

## In Progress

| Feature | Current State | What Remains |
|---------|--------------|--------------|
| **AI Agents** | Market rates + research agents wired | Contextual help agent (stub only) |
| **Pricing / Subscriptions** | `/admin/pricing` is now a single Platform Pricing surface (no tab bar). Plans + Page Content + Pricing Features + Module Access tabs all removed across 2026-04-27 / 2026-04-28. Migration 145 dropped `pricing_plans`. Page Builder → Pricing owns hero + FAQ for the public page. Plan-based feature gating ripped out (commit `d8405e5`); REFM stubs `canAccess()` → `false`. | Reintroduce plan-based gating as a focused new feature spec when paid tiers go live (server-enforced from day one, built on the surviving `platform_pricing` + `platform_features` + `plan_feature_access` tables). |
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
