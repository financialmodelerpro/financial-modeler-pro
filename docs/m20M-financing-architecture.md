# M2.0M Financing, Definitive Architecture

**Date:** 2026-05-11
**Scope:** Tab 4 Financing becomes the "funding layer," it depends on upstream data via parameter-named hooks. Architecture future-links to Revenue / OpEx / Cash Flow engines that will ship later.

---

## Core principle: parameter-based hooks, not module names

Every upstream data source is a hook keyed by what it returns, not which module produces it. If Module 5 ships after Module 3, sequencing changes but hook names stay stable.

Hook contracts live in `docs/financing-hooks.md`. Each hook contract documents:
- Return type (`PeriodArray` = `number[]` indexed by project period 0 = Y0).
- Default when source engine not yet present.
- Purpose-named engine that will populate it (not module number).

Financing engine reads hooks. When an upstream engine ships, hooks return real data automatically. Financing code does NOT change.

---

## 4 funding methods + land special treatment

User picks ONE funding method per project. Land funding is configured per-parcel and runs in parallel.

### Method 1, Fixed Debt-to-Equity Ratio
Simplest. Global debt% / equity%. Total funding = `getCapexExclLandInKind()`. Period-by-period drawdown follows capex schedule × debt%.

### Method 2, Line-Item Based Financing
Each cost line carries its own debt%/equity% in a master template. Per-asset override via Pass-4 inheritance pattern (override entry on the line with `debtPctOverride` + `equityPctOverride`). Each line's contribution × its ratio.

### Method 3, Net Funding Requirement
Net of available cash sources:
- `getCapexExclLandInKind() - getPreSalesCollections() - getOperatingCashFlow() - existingCash` (user input).
- Result × debt% / equity%. Pre-sales + operating CF hooks currently return zero; method works on capex alone today, auto-extends when upstream ships.

### Method 4, Cash Deficit Funding
Period-by-period dynamic. Maintain `minimumCashReserve` (scalar or `PeriodArray`). When period closing cash < min, draw debt + equity per ratio to fill the gap. Depends on `getClosingCashBalance(prevPeriod)` hook; today's implementation simulates with `initialCash + sum(capex outflows up to prevPeriod) + sum(funding drawn up to prevPeriod) - sum(interest paid up to prevPeriod)`. Replaces simulated value with real Cash Flow engine output when CF ships.

### Land special treatment (separate from method 1-4)

Each parcel has `ParcelFundingConfig`:
- `100pct_equity` (default, most common).
- `100pct_debt` (rare, land-only loan).
- `custom_split` (user-defined debt% / equity%).
- `in_kind` (landowner contributes, auto-detected from Tab 3 `land-inkind` line).
- `deferred_payment` (paid in installments over construction, with own start/end + phasing).

Optional `facilityId` links debt-funded land to a specific facility.

---

## Asset-level toggle (Combined vs Single Asset)

Top of Tab 4: `View: [Combined Project] [Single Asset ▼]`. When Single Asset selected, every schedule + summary filters to that asset's slice. Switching back to Combined preserves all data.

---

## Schedules sub-tab, 6 outputs

1. **Capital Stack Summary** (Sources / Uses / LTV / match chip).
2. **Combined Debt Schedule** (per period: opening, drawdowns, IDC capitalized, repayment, closing). Per-facility breakdown expandable.
3. **Equity Schedule** (per period: opening, cash contributions, in-kind contributions, land equity, closing).
4. **Finance Cost Schedule** (per period: opening debt, interest charge, IDC capitalized, IDC expensed, cash paid, closing). **Dual tracking** of accounting capitalization vs cash paid, required for IFRS 23 + future P&L hook.
5. **Drawdown Schedule per facility** (per facility: drawdown, cumulative, undrawn, commitment fee).
6. **Funding by Period Summary** (per period: Capex, Pre-Sales[hook], Operating CF[hook], Net Funding Required, Debt Drawdown, Equity Drawdown).

Each schedule supports Combined + per-facility filter pills + granularity toggle (Annual / Quarterly / Monthly).

---

## Inputs sub-tab, 3 summaries

1. **Asset Funding Summary** (per asset: Total Cost, Debt, Equity, Debt%).
2. **Total Project Funding Summary** (Total Capex / Excl Land In-Kind / Excl All Land + Total Debt + Total Equity (Cash + In-Kind) + LTV).
3. **Funding by Period** (Debt Drawdown / Equity Cash / Equity In-Kind / Total).

---

## IDC dual tracking

Per facility, `idcTreatment: 'capitalize' | 'expense' | 'mixed'`.

- **Capitalize**: IDC added to asset cost basis (Tab 3 auto-line per asset, `id = auto-idc__{facilityId}__{assetId}`, `isLocked=true`). Cash interest paid tracked separately.
- **Expense**: IDC charged to P&L immediately (future M5 hook). No Tab 3 line.
- **Mixed**: capitalize during construction (or until `idcMixedSplitPeriod`), expense afterwards. Both tracks maintained in schedules.

PIK (`pikEnabled`): interest accrues to principal balance instead of cash. Common for mezzanine. Accounting IDC = period interest; cash interest paid = 0; principal grows.

---

## 3 repayment methods per facility

Already exist in M2.0L `RepaymentMethod` enum, extended by Pass 5:
- **A. Fixed Tenor** = `straight_line` (equal principal) or `equal_periodic_amortization` (annuity).
- **B. Management-Defined %** = `manual` with `repaymentManualDistribution[]` per period (sum = 100).
- **C. Cash Sweep** = `cashsweep_continuous` / `cashsweep_from_period` / `cashsweep_min_cash`. Sweep ratio + min cash configurable.

---

## Schema additions (v8 stays additive)

```ts
type FundingMethodId = 1 | 2 | 3 | 4;

interface FundingMethod1Config { debtPct: number; equityPct: number; }
interface FundingMethod2LineRatio { lineId: string; debtPct: number; equityPct: number; }
interface FundingMethod2Config {
  master: FundingMethod2LineRatio[];
  // Per-asset override stored on existing CostOverride via two new optional
  // fields debtPctOverride + equityPctOverride; no separate map needed.
}
interface FundingMethod3Config { existingCash: number; debtPct: number; equityPct: number; }
interface FundingMethod4Config {
  initialCash: number;
  minimumCashReserve: number | number[];  // scalar or PeriodArray
  debtPct: number;
  equityPct: number;
}

type ParcelFundingType = '100pct_equity' | '100pct_debt' | 'custom_split' | 'in_kind' | 'deferred_payment';

interface ParcelFundingConfig {
  parcelId: string;
  fundingType: ParcelFundingType;
  customDebtPct?: number;
  customEquityPct?: number;
  deferredSchedule?: {
    type: 'even' | 'manual_pct';
    startPeriod: number;
    endPeriod: number;
    distribution?: number[];
  };
  facilityId?: string;
}

interface ProjectFinancingConfig {
  fundingMethod: FundingMethodId;
  fixedRatio?: FundingMethod1Config;
  lineItemRatios?: FundingMethod2Config;
  netFundingConfig?: FundingMethod3Config;
  cashDeficitConfig?: FundingMethod4Config;
  parcelFunding: ParcelFundingConfig[];
  viewMode: 'combined' | 'single_asset';
  selectedAssetId?: string;
}

interface Project {
  ...existing
  financing?: ProjectFinancingConfig;  // optional for back-compat
}
```

Existing `FinancingTranche[]` (debt facilities) and `EquityContribution[]` (equity tranches) stay unchanged. Pass 5's `costCategory` + `costDriver` on cost lines preserved.

---

## Migration

`migrateM20MFinancing` (idempotent):
1. If `project.financing` undefined: initialize empty config with `fundingMethod: 1`, default 70/30, `parcelFunding: []`, `viewMode: 'combined'`.
2. If prior M2.0L `financingTranches` carries data without `project.financing` wrapper, preserve facilities AS-IS; just stamp the wrapper.
3. Banner `M20M_FINANCING_NOTICE`: `"Financing module upgraded. Configure your funding method and capital stack in Tab 4."`

---

## UI architecture

### Tab 4 Inputs layout

```
[1. Inputs]  [2. Schedules]

Currency header: "All figures in SAR"

View: [Combined Project] [Single Asset ▼]

────────────────────────────────────────
FUNDING METHOD (top-level radio)
( ) Method 1: Fixed Debt-to-Equity Ratio   [inputs: debt% / equity%]
( ) Method 2: Line-Item Based Financing    [inputs: master table + override toggle]
( ) Method 3: Net Funding Requirement      [inputs: existing cash + ratio]
( ) Method 4: Cash Deficit Funding         [inputs: initial cash + min reserve + ratio]

────────────────────────────────────────
LAND FUNDING (per parcel)
Parcel: Land 1                            [funding type dropdown]
  [inputs per type]
Parcel: Land 2                            [funding type dropdown]
  [inputs per type]

────────────────────────────────────────
EQUITY TRANCHES                            [+ Add Tranche]
[existing M2.0L list]

────────────────────────────────────────
DEBT FACILITIES                            [+ Add Facility]
[existing M2.0L list, all 18 fields per Pass 5 schema]

────────────────────────────────────────
FUNDING SUMMARIES (3 cards): Asset / Total / By Period
```

### Tab 4 Schedules layout (6 tables, unchanged from M2.0L Pass 5 shape, relabeled per the new framing)

---

## Cross-tab integration

- **IDC → Tab 3 Costs.** Capitalize / Mixed → auto-line per asset. Existing M2.0L pattern.
- **Land In-Kind → Equity Tranche.** Existing M2.0L pattern.
- **Capex → Financing via hook.** `getCapexExclLandInKind()` reads Tab 3 Results Table 3.

---

## Commit plan

1. **This file + `docs/financing-hooks.md`** (design notes, first commit).
2. **Schema additions** (`ProjectFinancingConfig` + 4 method configs + `ParcelFundingConfig`) + migration + banner.
3. **Hook layer** (`src/hubs/modeling/platforms/refm/lib/financing-hooks.ts`) implementing `FinancingDataHooks` over current Costs engine + zero-stubs for Revenue / OpEx / CF.
4. **UI shell** in Tab 4: funding method radio + Method 1 fully wired + Methods 2/3/4 with input forms (calc-engine wiring iterates next). Land Funding section. View-mode toggle.
5. **Verifier `verify-m20M.ts` + CLAUDE.md / CLAUDE-TODO.md updates + Vercel deployment check per commit.**

---

## Deferred from this pass (acceptable per brief)

- **Methods 2-4 full calc-engine wiring.** Inputs persist + the funding-method radio drives downstream Schedules' "Net Funding Required" row. Method 2 line-item application, Method 3 net-of-revenue, Method 4 period-by-period deficit math land in the next sub-pass when Revenue/OpEx/CF engines ship. Hooks return zeros, so Method 3 today = Method 1 (full capex split) and Method 4 today = static capex profile.
- **Real `getClosingCashBalance` from CF engine.** Today: simulated locally.
- **Cash sweep based on REAL closing cash** (depends on above).
- **Playwright spec**, verifier + dev-server smoke covers schema; Playwright deferred.
- **DSCR / LTV covenant breach alerts** (M5 dependency).

These are documented in `CLAUDE-TODO.md` as M2.0M sub-pass work.

---

## Pattern decisions for future engines (Revenue / OpEx / CF)

When Revenue / OpEx / Cash Flow engines ship, each should:
- **Implement the corresponding hook(s)** in `financing-hooks.ts` (mutate the existing single source of truth, do NOT duplicate the helper).
- **Hook keys are stable**; do not rename. New aspects of an engine surface as new hooks, never as modifications of existing ones.
- **Return `PeriodArray` indexed by project period 0 = Y0.** Phase offsets handled by the financing engine; sources return project-period-aligned arrays.
- **Return zeros**, NOT undefined, when an asset has no data. Empty array allowed only when the engine doesn't run for the entire project.

Future engines' calc code should not import directly from Financing. They expose hooks; Financing consumes.
