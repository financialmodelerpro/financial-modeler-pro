# Financing Data Hooks, Contract Reference

**Date:** 2026-05-11
**Owner:** M2.0M Financing
**Consumer:** `src/hubs/modeling/platforms/refm/lib/financing-hooks.ts` (`FinancingDataHooks` interface)

---

## Core principle

Hook names describe **what data they return**, not **which module produces it**. If the Operating Cash Flow engine ships before the Revenue engine, the call sites still read `getOperatingCashFlow()` and `getPreSalesCollections()` from the same hook layer. Future engines populate hooks; Financing only consumes.

Every hook either returns a `PeriodArray` (alias for `number[]`, indexed by project period, 0 = Y0 = project start year), a scalar, or a small typed object. Where an upstream engine is not yet implemented, the hook returns a deterministic stub (usually all zeros) so Financing math runs end-to-end on day one and lights up automatically when the upstream engine arrives.

`PeriodArray` length conventions:
- **Project-period aligned.** Index 0 = project Y0; length = `project.totalPeriods` (annual today; granularity-flexed via `distributeAnnualToPeriods`).
- **Zeros NOT undefined** for periods with no activity. Empty array is allowed only when the engine doesn't run at all (e.g., Revenue when no asset has a revenue strategy).
- Phase offsets are the **financing engine's** responsibility, not the source engine's. Sources return project-period-aligned arrays.

---

## Hook catalog

### `getCapexExclLandInKind() : PeriodArray`

**Returns:** Total capex outflow per project period, excluding land in-kind contributions.

**Why excl. land in-kind:** in-kind land is satisfied by an equity tranche of type `in_kind`, not by debt/equity cash drawdown. Including it would double-count.

**Source today:** M2.0L Tab 3 Costs engine (`computeAssetCosts` → `AssetCostBreakdown.perPeriodCapexExclLandInKind`). Aggregated across all assets in the project.

**Future source:** Same engine. Stable.

**Default if missing:** Throw. This hook MUST be available — it is the only one with no zero-stub fallback. Financing without capex is meaningless.

---

### `getCapexInclLandInKind() : PeriodArray`

**Returns:** Total capex outflow per project period including land in-kind.

**Used by:** Capital Stack Summary "Total Uses" row. Reports the full economic cost picture even though in-kind land is satisfied non-cash.

**Source today:** M2.0L Tab 3 Costs (`AssetCostBreakdown.perPeriodCapex`).

**Future source:** Same.

**Default:** Throw if missing (same reasoning as above).

---

### `getCapexExclTotalLand() : PeriodArray`

**Returns:** Total capex outflow per project period excluding ALL land (both cash and in-kind).

**Used by:** Method 1 / 2 LTV calculations where bank policy is "no debt against raw land." Also used to compute the "Hard + Soft Construction Only" denominator in some debt covenants.

**Source today:** M2.0L Tab 3 Costs (`AssetCostBreakdown.perPeriodCapexExclTotalLand`).

**Future source:** Same.

**Default:** Throw if missing.

---

### `getLandInKindValue() : number`

**Returns:** Total imputed value of land contributed in-kind across the project (scalar, in project currency).

**Used by:** Equity tranche auto-row (`type: 'in_kind'`, `autoDetectedFromCostLine: true`). Capital Stack Summary "Equity In-Kind" row.

**Source today:** Sum of all M2.0L Tab 3 cost lines with `costType = 'land_in_kind'` (derived by `deriveCostType` from `costCategory + costDriver`).

**Future source:** Same.

**Default:** `0`.

---

### `getPreSalesCollections() : PeriodArray`

**Returns:** Cash receipts from off-plan sales per project period.

**Used by:** Method 3 (Net Funding Requirement) as a negative term in the funding gap, and by Method 4 (Cash Deficit) as a positive cash inflow that reduces the deficit.

**Source today:** **Zero-stub.** Returns `Array(totalPeriods).fill(0)`.

**Future source:** Revenue engine (M2.1) when Sell + Sell+Manage strategies emit pre-sale collection schedules. Likely keyed off `Asset.revenueStrategy + Asset.preSaleCollectionSchedule`.

**Default:** Zeros (NOT undefined). Methods 3 and 4 compute correctly today, just behave as if pre-sales = 0.

**Why the stub doesn't change Financing behavior:** When pre-sales = 0, Method 3's denominator collapses to `capex - 0 - 0 - existingCash`, which is the standard simple-LTV math anyone expects.

---

### `getOperatingCashFlow() : PeriodArray`

**Returns:** Net operating cash flow per project period (revenue minus opex minus tax, positive when surplus).

**Used by:** Method 3 net funding (negative term), Method 4 cash deficit (positive cash inflow), and the future Cash Sweep repayment method (sweep ratio × OCF).

**Source today:** **Zero-stub.**

**Future source:** Combination of Revenue (M2.1) + Operating Expenses (M2.2) + Tax (M2.3 or later) engines. Likely composed in the Cash Flow engine (M3) which is the canonical owner.

**Default:** Zeros.

**Why the stub is safe:** Cash sweep methods clip negative sweeps to zero; when OCF = 0, sweep = 0 and the facility relies purely on its fixed-tenor schedule (matching today's M2.0L behavior).

---

### `getClosingCashBalance(prevPeriod: number) : number`

**Returns:** Project closing cash balance at the end of period `prevPeriod`. Used by Method 4 to decide whether the cash deficit threshold has been crossed.

**Used by:** Method 4 ONLY. (`if (closingCash[t-1] < minimumCashReserve) drawTo(minimumCashReserve)`.)

**Source today:** **Local simulation** (not a real cash flow engine call). Computed inline as:

```
initialCash
  + sum(funding drawn[0..prevPeriod])
  - sum(capex outflows[0..prevPeriod])
  - sum(interest paid[0..prevPeriod])
```

**Future source:** Cash Flow engine (M3). When M3 ships, this hook switches to `cashflowEngine.closingCash[prevPeriod]` and the local simulation is deleted in one place.

**Default:** Local simulation as described.

**Why this matters for Method 4:** today the simulation ignores revenue / opex / tax flows, so the deficit calc is "what cash will I have AFTER paying capex + interest from a starting kitty?" — useful for a construction-only project but understates available cash for an operating asset. The M3 swap makes it correct.

---

### `getDepreciationSchedule() : PeriodArray`

**Returns:** Total depreciation expense per project period.

**Used by:** Future P&L interest-coverage covenants, and future tax shield calc when interest expense splits cap/expense.

**Source today:** Zero-stub.

**Future source:** Tab 3 Costs engine. Already partially implemented as `classifyAssetCapex` returns `Depreciation` allocation, but is not yet rolled up to a project-period array.

**Default:** Zeros.

---

### `getRevenueSchedule() : PeriodArray`

**Returns:** Gross revenue per project period.

**Used by:** Diagnostic only today (Capital Stack Summary "Project Revenue" line, hidden until Revenue engine ships). Future DSCR covenants.

**Source today:** Zero-stub.

**Future source:** Revenue engine (M2.1).

**Default:** Zeros.

---

### `getOperatingExpenses() : PeriodArray`

**Returns:** Operating expense per project period.

**Used by:** Same as revenue, diagnostic + future covenants.

**Source today:** Zero-stub.

**Future source:** OpEx engine (M2.2).

**Default:** Zeros.

---

## Future hooks (placeholders only, not implemented in M2.0M)

The following hooks will be added when their consumer code arrives. They appear here so the names are reserved and engine authors know which slot to fill.

- `getTaxableIncome() : PeriodArray` — Tax engine. Needed for after-tax DSCR.
- `getDistributableCash() : PeriodArray` — Cash flow waterfall engine (M4 equity returns). Drives cash sweep AFTER mandatory debt service.
- `getEquityIRR() : number` — Equity waterfall engine (M4). Drives preferred-return + IRR-hurdle calculations on equity tranches.
- `getReserveAccountBalance(reserveType, prevPeriod) : number` — Reserve account engine. Tracks DSRA, capex reserve, replacement reserve.

---

## Implementation pattern

The hooks live in **one file**: `src/hubs/modeling/platforms/refm/lib/financing-hooks.ts`. They are pure functions reading from the Module 1 project snapshot + (in the future) other engine outputs. The Financing calc engine accepts an instance of `FinancingDataHooks` as a constructor argument so the hooks can be mocked in tests.

```ts
export interface FinancingDataHooks {
  getCapexExclLandInKind(): PeriodArray;
  getCapexInclLandInKind(): PeriodArray;
  getCapexExclTotalLand(): PeriodArray;
  getLandInKindValue(): number;
  getPreSalesCollections(): PeriodArray;
  getOperatingCashFlow(): PeriodArray;
  getClosingCashBalance(prevPeriod: number): number;
  getDepreciationSchedule(): PeriodArray;
  getRevenueSchedule(): PeriodArray;
  getOperatingExpenses(): PeriodArray;
}

export function createFinancingHooks(project: Project): FinancingDataHooks { /* ... */ }
```

When an upstream engine ships:
1. Open `financing-hooks.ts`.
2. Replace the zero-stub return with a real call to the upstream engine.
3. Hook name stays the same; consumer call sites in Financing never change.
4. Tests for that hook flip from "returns zeros" to real value assertions; everything downstream of the hook is already wired.

---

## Versioning rules

- **Hook names are stable.** Never rename a hook even if the engine that produces it changes. Renaming forces a sweep across all consumers; we have explicitly chosen the cost of one extra hook over the cost of renaming.
- **New aspects of an engine surface as new hooks**, never as additions to an existing hook's return type. If Revenue grows a separate "deposits" stream, that becomes `getPreSaleDeposits()`, not a new key on `getPreSalesCollections()`.
- **Hook return type changes are version bumps.** Adding a field to a struct return is OK; changing array length semantics or unit is not. The current contract is "PeriodArray indexed by project period, length = `project.totalPeriods`, currency = project currency" and that contract is frozen.
