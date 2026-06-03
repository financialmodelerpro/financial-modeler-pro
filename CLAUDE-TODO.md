# Pending Work & Backlog

> Forward-looking only: active follow-ups, in-progress work, backlog, legacy reference. Completed phase narratives live in **CLAUDE-FEATURES.md** (archive) and `git log` (authoritative). Do not re-add "Recently Completed" sections here when closing a phase, write the closure into CLAUDE-FEATURES.md instead.

---

## ⭐ NEXT SESSION, 2026-06-04 (Cases follow-ups, then Reports)

**Context:** Scenario/case management shipped 2026-06-03 (commits `bb19ae6` Phase 1 + `2682a35` Phase 2). Management Case = base; Downside + Upside are field-override cases; topbar Case switcher + Returns "Case Comparison" tab are live. Full design + status in memory `project_cases_feature_plan.md` and [CLAUDE-REFM.md](CLAUDE-REFM.md).

**Pick up tomorrow, in order:**

1. **Verify the cases feature in-browser** (Ahmad): switch Management → Downside/Upside, edit a few inputs, confirm overrides record + Reset works, confirm Case Comparison KPIs + deltas look right, confirm save/reload round-trips cases.
2. **Case follow-up A, viewing shouldn't start an edit session.** Switching the active case currently marks the project dirty (persists last-viewed case) and can auto-start a version session just from viewing. Exclude `activeCaseId`-only changes from the dirty detection (`module1-sync` onStoreChange / hasUncommittedEdits), keeping cases-content + base edits as real edits.
3. **Case follow-up B (optional), inline override badges.** Per-input "≠ Management" badge + Reset on a scenario case, across the 5 modules. Deferred in Phase 1 (Case Manager + comparison tab cover visibility). Decide if it's worth the cross-module input plumbing.
4. **Case follow-up C (optional), describe scenario edits in the change_log.** `diffSnapshots` doesn't yet walk `cases`, so scenario-only edits save with an empty change_log. Extend the diff to summarise per-case override changes if version history needs it.
5. **Then: start the Reports phase** (Module 6). Scope a reporting surface that can pull the Case Comparison + each module's outputs (builds on the PDF export work). Open a fresh scope-pass before coding.

**Done last session (for reference):** PDF export full per-asset breakdowns + per-line/per-stage capex; versioning generic-naming fix; M5 flexible partner equity split; RE Metrics dropped Per-Asset Economics + added development/income-exit/hospitality/residential/lease KPIs; cases Phase 1 + 2.

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
