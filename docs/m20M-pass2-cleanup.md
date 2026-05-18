# M2.0M Pass 2, Tab 4 Financing Cleanup

**Date:** 2026-05-11
**Scope:** 13 targeted fixes simplifying Tab 4 Financing surface. Schema stays v8 (additive + deprecation, no breaking changes). Calc engine refactored around a single uniform funding flow.

---

## Guiding principle: one uniform output pipeline

All 4 funding methods produce the same downstream shape:
1. **Total funding need** (method-specific math).
2. **Period allocation** matching the capex schedule from Tab 3.
3. **Debt + equity split** per period using the project ratio.

Funding methods diverge only at step 1. Steps 2 + 3 are method-agnostic. This collapses 4 schedule rendering paths to one.

---

## Fix matrix

| # | Area | Change |
|---|------|--------|
| 1 | Calc | `computeFunding(method, projectData)` returns `{ totalNeed, periodArray, debtEquitySplit }` for every method. Schedule renderers consume this uniform shape. |
| 2 | UI | "LTV %" labels replaced with "Debt %". Equity % auto-fills to 100 - Debt. Schema field stays `debtPct`. |
| 3 | UI | `facilityType` dropdown hidden. Schema field kept; new facilities default `'senior_construction'`. |
| 4 | UI | Every "the reference model" user-facing string replaced with a neutral equivalent. Internal names, comments, function ids unaffected. |
| 5 | Schema + Calc + UI | Repayment methods reduce to 3: `equal_repayment` (sub: `equal_total` or `equal_principal`), `year_on_year_pct`, `cash_sweep`. Legacy values migrate (bullet/balloon/custom -> equal_repayment + year_on_year_pct as nearest equivalent). |
| 6 | Schema + UI | `Project.financing.minimumCashReserve` moves to top-level. Old `cashDeficitConfig.minimumCashReserve` migrates. All methods + cash-sweep respect the floor. |
| 7 | UI | IDC treatment dropdown shows Capitalize + Expense only. "Mixed" schema retained; migrates to Capitalize on hydrate. |
| 8 | UI + Migration | Facility `scope` dropdown shows project + phase. Existing `scope='asset'` facilities migrate to `'phase'` using the asset's parent phase. |
| 9 | UI | All Financing schedule cells use `formatScaledForExport` (no K/M suffix). Header line carries the scale indicator. |
| 10 | Schema + UI | `Project.financing.phaseFilter: 'all' \| string` adds a Phase Filter pill above the schedules; `'all'` default aggregates all phases. |
| 11 | Calc + UI | `computeEquity(financing, fundingResult, landInKindValue)` returns equity cash + in-kind contributions per period. Capital Stack Summary surfaces equity rows; new "Equity Schedule" table added to Schedules sub-tab. |
| 12 | UI | Every flow-row schedule renders a "Total" column in 2nd position (after Description). Balance rows render "-" in the Total slot. |
| 13 | Verify | Auto IDC cost line generation still works after Mixed treatment dropped (Capitalize is the only treatment that emits an auto line). |

---

## Schema additions / deprecations (v8 additive)

```ts
interface ProjectFinancingConfig {
  // ... existing fields preserved
  /** P2-Fix 6: project-level cash floor applied across all methods. */
  minimumCashReserve?: number;
  /** P2-Fix 10: '__all__' or a specific phase id. Default '__all__'. */
  phaseFilter?: string;
}

// P2-Fix 5: new enum
type RepaymentMethod =
  | 'equal_repayment'
  | 'year_on_year_pct'
  | 'cash_sweep'
  // Legacy values retained on the type for snapshot compat; UI never emits them.
  | 'cashsweep_continuous' | 'cashsweep_from_period' | 'cashsweep_min_cash'
  | 'straight_line' | 'equal_periodic_amortization'
  | 'bullet' | 'balloon' | 'manual' | 'custom_schedule';

interface FinancingTranche {
  // ... existing fields preserved
  /** P2-Fix 5: sub-mode on equal_repayment. */
  equalRepaymentSubMethod?: 'equal_total' | 'equal_principal';
  /** P2-Fix 5: year-on-year percent schedule (sums to 100). */
  yearOnYearPctSchedule?: number[];
  /** P2-Fix 5: cash-sweep config. */
  cashSweepConfig?: { startingYear: number; sweepRatio: number };
}
```

Migration `migrateM20mPass2Financing` (idempotent):
- Move `cashDeficitConfig.minimumCashReserve` -> `project.financing.minimumCashReserve` when the top-level field is undefined.
- Map legacy repayment methods:
  - `straight_line` -> `equal_repayment` + sub `equal_principal`
  - `equal_periodic_amortization` -> `equal_repayment` + sub `equal_total`
  - `cashsweep_*` -> `cash_sweep`
  - `bullet` -> `equal_repayment` (1-period repayment) + sub `equal_total`
  - `balloon` -> `year_on_year_pct` (auto schedule favours late periods)
  - `manual` -> `year_on_year_pct` (carries over `repaymentManualDistribution`)
  - `custom_schedule` -> `year_on_year_pct`
- Stamp default `equalRepaymentSubMethod='equal_total'` on equal_repayment facilities missing the field.
- Map `idcTreatment='mixed'` -> `'capitalize'`.
- Map `scope='asset'` -> `'phase'` using the parent phase of `scopeId`/`assetId`.
- Stamp `phaseFilter='__all__'` when missing.

---

## Calc engine, uniform pipeline

```ts
export interface FundingResult {
  totalNeed: number;
  periodArray: number[];      // length = totalPeriods + 1
  debtEquitySplit: { debt: number[]; equity: number[] };
}

export function computeFunding(
  method: FundingMethodId,
  ctx: { hooks: FinancingDataHooks; financing: ProjectFinancingConfig; capexExclInKind: number[] },
): FundingResult;
```

Method math:
- **Method 1, Fixed Ratio:** `totalNeed = sum(capexExclInKind)`; `periodArray = capexExclInKind`.
- **Method 2, Line-Item:** identical period array; debt/equity ratio is per-line in the future, but Pass 2 ships with project-wide ratio fallback.
- **Method 3, Net Funding:** `totalNeed = sum(capex - preSales - opCF - existingCash + minCashReserve)`. Pre-sales + opCF return zeros today (hook stubs).
- **Method 4, Cash Deficit:** period-by-period. Pre-sim closing cash via `getClosingCashBalance(t-1)`; when `< minCashReserve`, top up to the floor.

Repayment per facility (P2-Fix 5):
- **Equal Repayment / equal_total:** annuity PMT against tenor.
- **Equal Repayment / equal_principal:** straight-line principal + accrued interest.
- **Year-on-Year %:** percent schedule applied against principal; calc engine normalises to 100.
- **Cash Sweep:** apply `sweepRatio` to surplus above `minimumCashReserve`. Enforces no future negative cash via forward-look.

---

## Equity computation

```ts
export interface EquityResult {
  totalEquityNeed: number;
  inKindContribution: number;
  cashContribution: number;
  /** Cash equity allocated to periods proportional to debt drawdown timing. */
  cashPerPeriod: number[];
  /** In-kind contribution lump (typically period 0 / first construction year). */
  inKindPerPeriod: number[];
  openingPerPeriod: number[];
  closingPerPeriod: number[];
}
```

Sourced from `(1 - debtPct/100) * totalNeed - landInKindValue`. User-added equity tranches supplement; auto-detected in-kind tranches preserve existing behaviour.

---

## UI changes (Tab 4 Inputs)

```
TAB 4: FINANCING
[1. Inputs]  [2. Schedules]

PROJECT FINANCING SETTINGS
  Minimum Cash Reserve: [_______] SAR  (applies to all methods + sweep)

VIEW: [Combined Project] [Single Asset v]
PHASE FILTER: [All Phases v]

FUNDING METHOD (radio)
  ( ) Method 1: Fixed Debt-to-Equity Ratio
  ( ) Method 2: Line-Item Based Financing
  ( ) Method 3: Net Funding Requirement
  ( ) Method 4: Cash Deficit Funding

LAND FUNDING (per parcel)
EQUITY TRANCHES                       [+ Add]
DEBT FACILITIES                       [+ Add]
  Facility N
    Lender / Principal (Total: ...) / Debt % (was LTV) / Rate / Tenor / Grace
    Repayment Method: Equal Repayment / Year-on-Year % / Cash Sweep
      (Equal Repayment sub-mode: Equal Total / Equal Principal)
    IDC Treatment: Capitalize / Expense
    Scope: Project-wide / Phase-specific
FUNDING SUMMARIES (3 cards)
```

## UI changes (Tab 4 Schedules)

```
Filter: [All Phases v] [Combined v]
Granularity: Annual / Quarterly / Monthly

1. Capital Stack Summary
   Source              Amount         % of Total
   Equity Cash         ...            ...
   Equity In-Kind      ...            ...
   Senior Debt         ...            ...
   TOTAL               ...            100%

2. Drawdown Schedule              Total | DEC 25 | DEC 26 | ...
3. Repayment Schedule             Total | DEC 25 | DEC 26 | ...
4. Combined Debt Service          Total | DEC 25 | DEC 26 | ...
5. IDC Summary                    (already has total)
6. Equity Schedule (new)          Total | DEC 25 | DEC 26 | ...
7. Capital Stack Movement         Total | DEC 25 | DEC 26 | ...
```

Total in 2nd position for flow rows; balance rows show "-".

---

## Verifier

`scripts/verify-m20M-pass2.ts` covers schema additions / deprecations, migration mapping (5 legacy repayment values + min-cash move + scope='asset' rewrite + IDC mixed -> capitalize + phaseFilter default), calc correctness (uniform funding shape, annuity PMT, year-on-year sum=100, cash-sweep min-cash floor, equity = funding x (1-debt%) - in-kind), and UI source markers (no "LTV" / "the reference model" in Tab 4, facility type hidden, IDC dropdown has 2 options, scope has 2 options, phaseFilter pill present, equity rows in capital stack, Equity Schedule table present, Total column 2nd position across schedules, no K/M suffix in cells, em-dash sweep clean).

---

## Commit plan

1. This design note (`docs/m20M-pass2-cleanup.md`).
2. P2-Fix 4: drop "the reference model" UI strings.
3. P2-Fix 2: "LTV %" -> "Debt %" labels.
4. P2-Fix 9: Financing cells use `formatScaledForExport`.
5. P2-Fix 6: move `minimumCashReserve` to top-level; UI moves; migration.
6. P2-Fix 3: hide facility type dropdown.
7. P2-Fix 7: IDC dropdown to 2 options; migration `mixed -> capitalize`.
8. P2-Fix 8: scope dropdown to 2 options; migration `asset -> phase`.
9. P2-Fix 5: 3-method repayment enum + sub-method + cash sweep config + migration.
10. P2-Fix 10: `phaseFilter` schema + UI pill; aggregation behaviour.
11. P2-Fix 1: uniform funding flow refactor.
12. P2-Fix 11: equity computation + Capital Stack + Equity Schedule.
13. P2-Fix 12: Total column 2nd position across schedules.
14. Verifier `verify-m20M-pass2.ts` + CLAUDE.md update.

Each commit type-checks clean. Vercel verified after the final push (build is cumulative; intermediate states all type-clean, so any commit hash is a valid revert point).

---

## Deferred from this pass

- Method 2 (Line-Item) per-line debt% application stays the project-wide fallback; per-line override math lights up when the Costs engine surfaces per-line ratio inputs in a follow-up sub-pass.
- Cash-sweep "no future negative cash" enforcement is a single-pass forward look; M3 Cash Flow engine will replace the local-sim closing-cash hook later (no consumer change, by hook contract).
- DSCR / LTV covenant breach alerts (M5 dependency, same as M2.0M).
- Playwright spec; verifier + manual smoke covers the surface this pass.
