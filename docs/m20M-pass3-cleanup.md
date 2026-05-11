# M2.0M Pass 3, Tab 4 Financing Cleanup

**Date:** 2026-05-12
**Scope:** Drop Single Asset toggle, fix capex hook post Pass 7,
remove per-facility debt%/principal/drawdown-method inputs (auto-
derive from chosen funding method), re-add asset-scope option,
simplify repayment to 3 methods (no sub-method), drop Equity
Tranches section (auto-compute), add 3 Inputs Summary Tables
(Funding / Debt / Equity), fix Schedules math (Closing = Opening
+ Drawdown + IDC Capitalized - Principal Repaid), verify Auto-IDC
post Pass 7. Schema stays v8 (additive + deprecation).

---

## Fix matrix

| # | Area | Change |
|---|------|--------|
| 1 | Inputs view toggle | Drop "Combined / Single Asset" toggle entirely. Inputs always operate on Combined Project basis. `viewMode` deprecated (migration reverts `single_asset` -> `combined`). |
| 2 | Capex hook (zero bug) | Audit `getCapexExclLandInKind` etc. post Pass 7. `computeAssetCost` already filters lines per `targetAssetId === asset.id || undefined`. Verify aggregation across phases yields non-zero for projects with cost lines (verifier asserts MAAD-shape capex). |
| 3 | Facility ratio inherits | Remove per-facility `debtPct` + `principal` inputs. Facility principal auto-computes from chosen funding method (Method 1: capex × debt%; Method 2: cost-line ratios; Method 3: net funding × debt%; Method 4: cash deficit × debt%). Multi-facility split via `facilitySharePct` (sums to 100% across facilities; single facility defaults to 100). |
| 4 | Facility scope | Re-expose `scope: 'project' \| 'phase' \| 'asset'`. Asset-specific opens asset picker. Pass 2 dropped asset option; Pass 3 restores. |
| 5 | Drawdown method | Drop per-facility drawdown method dropdown. Schedule auto-derives from chosen funding method. `drawdownMethod` deprecated. |
| 6 | Repayment | Drop `equalRepaymentSubMethod` (Equal Total / Equal Principal). Equal Repayment defaults to equal_principal (declining balance). Cash Sweep drops `sweepRatio` input (defaults 100% above min cash). Three methods total: Equal Repayment, Year-on-Year %, Cash Sweep. |
| 7 | Equity Tranches | Drop entire Equity Tranches UI section. Equity auto-computes (Total Funding × equity%; Cash equity = Total Equity - Land In-Kind; Land In-Kind auto-detects from Tab 3 Land In-Kind cost line). `equityTranches` field deprecated on schema. |
| 8 | Inputs Summary Tables | 3 stacked tables at bottom of Inputs sub-tab: Total Funding Required, Total Debt Required, Total Equity Required. Rows = assets (project-wide), cols = periods, Total in 2nd position. Equity Total row breaks into Cash + In-Kind sub-rows. |
| 9 | Schedules math | Fix closing balance formula: `Closing = Opening + Drawdown + IDC Capitalized - Principal Repaid` (interest paid is separate cash event, doesn't affect debt balance). Flow rows have Total in 2nd position; balance rows don't. Complete All Phases aggregation. |
| 10 | Auto-IDC post Pass 7 | Verify cross-tab Auto-IDC integration still emits per-asset locked cost lines into Tab 3 after the Pass 7 per-asset rewrite. `applyIdcToCapex` already emits `AutoIdcCostLineSeed[]` with `targetAssetId` populated. Verifier asserts seed shape. |

---

## Schema changes (v8 additive + deprecation)

### Deprecated (kept for back-compat, migration drops/ignores)

- `Project.financing.viewMode` (Fix 1). Migration reverts `single_asset` -> `combined`, clears `selectedAssetId`.
- `Project.financing.equityTranches` (Fix 7). Migration drops the array; equity auto-computes.
- `FinancingTranche.debtPct` / `FinancingTranche.principal` (Fix 3). Migration ignores; principal auto-derives from method.
- `FinancingTranche.drawdownMethod` (Fix 5). Migration ignores; schedule auto-follows funding method.
- `FinancingTranche.equalRepaymentSubMethod` (Fix 6). Migration ignores; Equal Repayment is single mode.
- `FinancingTranche.sweepRatio` (Fix 6). Migration ignores; Cash Sweep defaults 100% above min cash.

### Re-exposed / new

- `FinancingTranche.scope: 'project' | 'phase' | 'asset'` (Fix 4). Already exists on schema; UI surfaces asset option again.
- `FinancingTranche.facilitySharePct?: number` (Fix 3). New optional field for multi-facility split (0-100, sums to 100% across facilities in the same scope). Single facility defaults to 100.

### Calc engine

- `computeFunding` already supports the 4 methods. No signature changes.
- `computeFacilityPrincipal(facility, fundingResult)`: new helper that returns the facility's principal allocation given the project-level funding result and the facility's `facilitySharePct`.
- Funding/Debt/Equity Summary Tables: new helpers `computeFundingPerAssetPerPeriod(project, phases, assets, costLines, fundingResult)` returning `Map<assetId, PeriodArray>` for the per-asset asset rows.

---

## Migration `migrateM20mPass3Financing`

Idempotent. Runs on every hydrate (`stripV8Wrapper` / `stripWrapper` / `migrateLegacyToV8`).

For each snapshot:
1. If `project.financing.viewMode === 'single_asset'`, set to `'combined'` and clear `selectedAssetId`.
2. If `project.financing.equityTranches` is a non-empty array, log via stamping a one-time banner; clear the array.
3. For each `FinancingTranche`:
   - Ignore `debtPct`, `principal`, `drawdownMethod`, `equalRepaymentSubMethod`, `sweepRatio` (keep on schema for legacy snapshot reads but stop relying on them).
   - If multiple facilities exist in the snapshot and none carry `facilitySharePct`, default to equal split (100 / N per facility).
   - Single facility: default `facilitySharePct = 100`.

Banner stamped on snapshots that needed flattening: `M20M_PASS3_NOTICE = "Financing simplified, facility ratios now auto-compute from funding method. Equity tranches auto-computed."`.

---

## UI changes

### Tab 4 Inputs (revised layout)

```
TAB 4: FINANCING

[1. Inputs]  [2. Schedules]

────────────────────────────────────────
PROJECT FINANCING SETTINGS
  Minimum Cash Reserve: [5,000,000] SAR
  Phase Filter: [All Phases v]

────────────────────────────────────────
(no view toggle, always Combined)

FUNDING METHOD:
  ( ) Method 1: Fixed Ratio (Debt% / Equity%)
  ( ) Method 2: Line-Item Based
  ( ) Method 3: Net Funding Requirement
  ( ) Method 4: Cash Deficit Funding

────────────────────────────────────────
LAND FUNDING (per parcel)

────────────────────────────────────────
DEBT FACILITIES                          [+ Add Facility]

  Facility 1: Senior Construction Loan
    Lender, scope (project/phase/asset), interest, tenor, grace,
    IDC treatment (Capitalize/Expense), Repayment Method
    (Equal Repayment / Year-on-Year % / Cash Sweep),
    Facility Share % (when multiple facilities).

    NO debt% input. NO principal input. NO drawdown method dropdown.
    NO Equal Total / Equal Principal sub-method.

(no Equity Tranches section)

────────────────────────────────────────
INPUTS SUMMARY TABLES (auto-computed)

  Table 1: Total Funding Required (asset rows x period cols + Total)
  Table 2: Total Debt Required (asset rows x period cols + Total)
  Table 3: Total Equity Required (asset rows x period cols + Total
           with Cash + In-Kind sub-rows in Total)
```

### Tab 4 Schedules

Existing 6 tables stay (Capital Stack Summary, Drawdown per facility,
Repayment per facility, Combined Debt Service, IDC Summary, Equity
Schedule, Capital Stack Movement). Fix 9 corrects the closing balance
formula and ensures All Phases aggregation walks across phases.

---

## Cross-tab integration

- **Auto-IDC** (Tab 4 -> Tab 3): unchanged math. `applyIdcToCapex` emits seeds keyed by `targetAssetId`. Pass 7's per-asset table renders them as locked rows in the appropriate asset's section.
- **Land In-Kind -> Equity Tranche** (Tab 3 -> Tab 4): auto-detection moves into the equity auto-computation. No user input. `equityTranches[]` is no longer the carrier.
- **Financing hooks** (`getCapexExclLandInKind` etc.): unchanged contract. Verifier asserts hooks return real per-period data given a Pass 7 fixture.

---

## Commit plan

1. This design note.
2. P3-Fix 1: drop view toggle + migration `migrateM20mPass3Financing` step 1.
3. P3-Fix 3: drop per-facility debt% + principal + facilitySharePct (calc + UI).
4. P3-Fix 5: drop drawdown method dropdown + auto-derive.
5. P3-Fix 6: drop equal repayment sub-method + sweep ratio.
6. P3-Fix 7: drop Equity Tranches section.
7. P3-Fix 4: re-add asset scope option.
8. P3-Fix 8: Inputs Summary Tables (Funding / Debt / Equity).
9. P3-Fix 9: schedules math + All Phases aggregation.
10. P3-Fix 2 + P3-Fix 10 + verifier: capex hook audit, Auto-IDC verification, `scripts/verify-m20M-pass3.ts` + CLAUDE.md.

Each commit type-checks clean; Vercel verified per push.

---

## Deferred

- Multi-investor equity waterfall (sponsor / JV partner / etc.). Currently equity is aggregate.
- Playwright spec (verifier covers schema + migration + UI source markers; manual smoke handles the UI flow).
- Real `getClosingCashBalance` from M3 Cash Flow engine (still uses the local simulation stub).
