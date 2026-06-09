# Pending Work & Backlog

> Forward-looking only: active follow-ups, in-progress work, backlog, legacy reference. Completed phase narratives live in **CLAUDE-FEATURES.md** (archive) and `git log` (authoritative). Do not re-add "Recently Completed" sections here when closing a phase, write the closure into CLAUDE-FEATURES.md instead.

---

## ⭐ START HERE (Excel MODEL export, true-mirror; Module 1 done, NEXT = Module 2)

**Active build: the formula-driven Excel MODEL export** (`lib/excel/{styles,buildModelWorkbook}.ts`; verifier `scripts/verify-excel-export.ts`; ExportModal "Excel Model (beta)"). Every calc cell is a real Excel formula off the Assumptions tab with the platform value cached via `fcell` for Node reconciliation; circular debt/IDC/sweep resolved by Excel iterative calc (post-processed into the .xlsx zip). Delivered module by module, each reconciled. Full plan + per-unit narrative: git log + memory (`project_excel_export_*`).

**MODULE 1 LOCKED (formula-driven, true-mirror).** Sheets: Cover, Assumptions (pure inputs + defined names), Timeline, Land & Area, Capex, Financing. Conventions now in place across all sheets:
- **Land & Area**: asset-wise (no sub-unit rows), grouped Residential / Hospitality / Retail with group totals; GDV residential-only.
- **Formatting**: Calibri 9.5; accounting number format (zero = dash, negatives in parens); all % 2dp; contiguous totals are `SUM(range)`; FAST input cells = navy-pale fill + navy text (matches the PDF).
- **Frozen 4-row period header** on every schedule: row 3 period-end dates ("Dec YYYY"), row 4 period index, **Period 0 = the opening = Dec(startYear-1)**; periods from col E (Capex from col F, it has an extra Quantity col), Total inside the frozen block, freeze rows 1-4 + the label/Total columns; no repeated year rows inside schedules.
- **Capex**: single per-asset block in Table 1 (Cost line, UOM, Rate, **Quantity** = live basis, Total = Rate × Quantity, then periods = Total × allocation %); allocation % inputs on top; the 4 platform tables (incl land / excl in-kind / excl total land). Cross-asset-allocated lines + `rate_x_specific_subunit` stay engine-sourced (cached). UOM labels for `rate_x_parking_area` / `rate_x_support_area` added in `capexReports.ts`.
- **Scale + decimals selector** in ExportModal (full/thousands = 0dp, millions = 1dp default; money bases scale, rates/counts don't).

**MUST-CONVERT (Financing, knowingly deferred):** the Financing sheet carries three cached per-period budget rows (IDC cash budget, cash-sweep budget, gap-sized debt drawdown) so the per-facility roll-forward stays acyclic this unit. Convert these (and the Method-1 cash-equity split) to live Cash-Flow / funding-split references when the Cash-Flow unit lands (where the genuine Financing↔CF circularity appears and Excel iterative calc becomes load-bearing). Do not leave them silently.

**NEXT = Module 2 (Revenue + Cost of Sales) as real formulas**: Sell (velocity → sale value → cash/recognition cohort vintages via SUMPRODUCT), Hospitality (keys × days × occupancy × ADR with indexation), Lease (area × occupancy × indexed rate); CoS joint-factor V2. Add the revenue driver inputs to Assumptions. Then Module 3 Opex (formulas), Module 4 Fixed Assets + Statements, Module 5 Returns, final Checks. Reuse the `lib/reports/` builders for cached `result` values; keep the look (no gridlines, navy bars, FAST colours).

**Open follow-up (optional):** refactor the M1/M2/M3 on-screen output tabs to also consume the `lib/reports/` builders (only M4 does today), so the on-screen structure shares one source with the PDF.

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

## REFM Module Status (2026-05-25)

Current LIVE status. For per-pass narrative see [CLAUDE-REFM.md](CLAUDE-REFM.md) + memory `project_*` files.

| Module | Name | Status |
|--------|------|--------|
| Module 1 | Project Setup / Costs / Financing | **LOCKED** at M2.0 Pass 58 (base). Funding Methods 2 + 3 have Funding Gap sub-tab with display-only sizing math (Pass 2R-2V) + Cash Sweep + Dividend waterfall live (Pass 2S-2Z); engine wire-up to debt drawdown sizing still on backlog. |
| Module 2 | Revenue + CoS + Schedules + Escrow | **LOCKED** at Pass 9N. 133/133 + 46/46 verifier sections green. |
| Module 3 | Operating Expenses | **LOCKED** at Pass 5d. 38/38 + 24/24 verifier sections green. |
| Module 4 | Financial Statements | WIP. Schedules / P&L / CF / BS surfaces shipped. **Balances by construction**: BS reconciles AND Direct == Indirect closing cash every period (verified under escrow + handover/over-time recognition). 2026-05-25 root causes closed: escrow = restricted-cash asset (not liability); residential P&L revenue uses recognised series (matches Module 2). Per-line Reconciliation Bridge on the BS tab. 703 verifier sections green across 11 scripts (m4-bs-reconciliation 184). |
| Module 5 | Returns & Valuation | **Live.** IRR/MOIC/NPV/Payback on FCFF/FCFE/Dividends + terminal value + RE metrics + multi-partner returns (per-type % split) + exit/sensitivity/per-asset blocks. RE Metrics tab carries development / income-exit / hospitality / residential / lease KPIs. Returns tabs: Returns / RE Metrics / **Case Comparison**. |
| Module 6 | Reports & Visualizations | Not started (next phase). |

**Cases (scenario management), shipped 2026-06-03:** Management Case = base; Downside + Upside are field-override cases (renamable, add custom). Topbar Case switcher + Returns Case Comparison tab. Engine `lib/cases/applyOverrides.ts`, verify-cases 19/19. See the NEXT SESSION block above for follow-ups.

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
