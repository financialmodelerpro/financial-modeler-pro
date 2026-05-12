# Cost <- Revenue Hooks (Pass 10 Fix 10)

**Date:** 2026-05-12
**Status:** Contract stub. Implementation lands with Module 2.1 Revenue.

## What this is

Commission cost lines must scale against a revenue stream the user
hasn't built yet. Module 2.1 Revenue is the canonical revenue engine.
Until M2.1 ships, the cost engine reads zero-stub PeriodArrays via
two hooks on `FinancingDataHooks`:

- `getTotalRevenueCashBasis(assetId?): PeriodArray`
- `getTotalRevenueSaleBasis(assetId?): PeriodArray`

Both return `zeros(totalPeriods + 1)` today (`financing-hooks.ts`).

## New CostMethod values

```ts
| 'percent_of_revenue_cash'  // value% × revenue collected per period (cash basis)
| 'percent_of_revenue_sale'; // value% × revenue recognised per period (sale basis)
```

`calculateItemTotal` returns 0 for both methods today (no revenue
exists pre-M2.1). The per-period commission distribution arrives via
the hook PeriodArray, NOT a single total, because revenue timing
matters: a Commission line at 4% of cash revenue paid in Y3 needs to
match the cash collection schedule, not be spread evenly across the
construction window.

## What M2.1 must populate

When `Module 2 (Revenue Analysis)` ships, the hook implementations
swap from zero-stubs to real values. Contract:

**`getTotalRevenueCashBasis(assetId?)`**
- Cash collections per project period.
- For Sell strategy: pre-sale + handover payment timing per asset
  cohort (10% deposit at signing, 90% at handover or per the cohort's
  payment schedule).
- For Operate strategy: hospitality revenue collected per period
  (ADR × occupancy × days × room count, growing per indexation).
- For Lease strategy: rent collected per period (rate × area, growing
  per indexation, gated by handover date).
- For Sell + Manage strategy: parent asset contributes sale receipts;
  companion Operate asset contributes hospitality revenue.
- When `assetId` is set, scope to that asset; when omitted, sum
  across all visible assets.

**`getTotalRevenueSaleBasis(assetId?)`**
- Revenue RECOGNISED per project period (P&L timing), distinct from
  cash collection.
- For Sell: recognised at handover under IFRS 15 (point-in-time) for
  most cases; over-time when the contract qualifies.
- For Operate / Lease: same as cash basis when no straight-line
  rent free periods or step-up clauses exist; otherwise straight-line
  amortisation per IFRS 16 lessor.

The two bases can differ by years for off-plan sales (cash collected
during construction, recognition at handover). The cost engine reads
both; the user picks which basis their commission contract follows.

## Calc engine wiring (deferred to M2.1 closure)

`computeAssetCost` will gain a phase 3 step (after current direct +
indirect resolution):

```ts
// Phase 3: revenue-tied lines
if (line.method === 'percent_of_revenue_cash') {
  const rev = hooks.getTotalRevenueCashBasis(asset.id);
  // rate% * rev[t] for every period t
  const perPeriod = rev.map((v) => v * (clamp(line.value, 0, 100) / 100));
  // merge into asset breakdown
}
```

Pass 10 ships the schema + method labels + hook stubs only. The
phase-3 wiring + dropdown filter (only show revenue-methods on
Sell / Sell + Manage / Operate / Lease strategies) lands with M2.1.

## File locations

- `src/core/calculations/index.ts`, calculateItemTotal switch cases
  for `percent_of_revenue_cash` / `percent_of_revenue_sale` (return 0 today)
- `src/hubs/modeling/platforms/refm/lib/financing-hooks.ts`, hook
  signatures + zero-stub implementations
- `src/hubs/modeling/platforms/refm/lib/state/module1-types.ts`,
  CostMethod union + COST_METHODS array + COST_METHOD_LABELS

## Until M2.1 ships

User can SELECT the method on a Commission cost line. The line
renders with method label in the dropdown. The Total column shows 0
(correctly, since no revenue is recognised yet). When M2.1 ships,
the same line picks up real values from the hook.
