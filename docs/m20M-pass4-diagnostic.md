# M2.0M Pass 4 Diagnostic — Why does the UI render zero when hook unit tests pass?

**Date:** 2026-05-12
**Status:** Diagnostic only. No code changes in this commit.

## TL;DR

The UI **never calls `createFinancingHooks`**. The financing hooks pass
unit tests because the verifier calls `createFinancingHooks(src)` and
asserts the return value. But `Module1Financing.tsx` computes capex
through a different path (`computePhaseCost` for the active phase
only), and `computeCapitalStack` still reads deprecated per-facility
fields (`tranche.ltvPct`, `tranche.principal`) that Pass 3 hid from
the UI without removing from the calc path.

Three intertwined bugs combine to produce the zero rendering:

1. **Hook contract not consumed by UI.** `createFinancingHooks` lives
   in `lib/financing-hooks.ts` and is referenced only by
   `scripts/verify-m20M-pass3.ts`, `scripts/verify-m20M.ts`, the
   design doc, and CLAUDE.md. No call site in `Module1Financing.tsx`.
2. **Capital Stack reads stale per-facility fields.**
   `computeCapitalStack(tranches, equityContribs, projectCapexTotal)`
   computes debt as `tranche.principal > 0 ? tranche.principal : projectCapexTotal * tranche.ltvPct/100`.
   Pass 3 dropped both `principal` and `ltvPct` (Debt %) inputs from
   the TrancheCard UI. New facilities default to `ltvPct=0` (input
   never surfaced), so `totalDebt = 0` for every facility added
   post-Pass-3.
3. **Equity contributions cleared by migration.** Pass 3 migration
   cleared `equityContributions[]` (Equity Tranches section dropped
   from UI; equity is supposed to auto-compute now). But
   `computeCapitalStack` still walks `equityContribs` to build the
   equity breakdown. After migration, the array is empty, so
   `totalEquity = 0` always.

The Capital Structure Overview reads from `stack = computeCapitalStack(...)`,
so when both `totalDebt = 0` and `totalEquity = 0`, every card shows
zero. The schedules also render zero because they're derived from
the same `phaseTranches` whose `ltvPct = 0` produces empty drawdown
schedules in `computeFinancing`.

## Trace

### Path 1: Inputs Summary Tables (works correctly post-Pass 3)

`Module1Financing.tsx:917` builds `inputsSummary` by iterating every
phase, every visible asset, calling `computeAssetCost` directly with
the full `costLines` array, and summing per-period capex. This
ignores `activePhaseId` so it correctly returns project-wide totals.
Inputs Summary Tables render non-zero values when cost lines exist.

### Path 2: Capital Structure Overview (renders zero)

`Module1Financing.tsx:843` computes a single-phase `phaseCost` for
the active phase only:

```ts
const phaseCost = computePhaseCost(phase, project, costLines, ...);
const capexPerPeriod = phaseCost.perPeriod;
```

`stack = computeCapitalStack(phaseTranches, phaseEquity, phaseCost.total)`
uses this single-phase total. Then:

- `phaseEquity = equityContributions.filter(... phaseId === phase.id)` is
  always empty after Pass 3 migration (which cleared all
  `equityContributions`).
- `phaseTranches` is non-empty when the user added facilities, but
  the calc reads each `tranche.ltvPct` which Pass 3 stopped exposing
  in the UI. Existing snapshots may carry the old value (e.g. 70),
  but new facilities default to `ltvPct = 0` per
  `makeDefaultFinancingTranche`. Result: `totalDebt = 0` for new
  facilities, `totalEquity = 0` for every project.

### Path 3: Schedules (render zero)

`Module1Financing.tsx:865` builds `resultsMap = Map<facilityId, FinancingResult>`
by iterating `phaseTranches` and calling
`computeFinancing(tranche, facilityPhase, facilityCapex, ...)`.
`computeFinancing` produces a `drawSchedule` from the tranche's
configured drawdown method (`capex_basis`, `debt_equity_ratio`,
etc.) using `tranche.ltvPct / 100` as the multiplier. With
`ltvPct = 0`, every period draws zero, so every schedule (Drawdown,
Repayment, Combined Debt Service, Capital Stack Movement) renders
zero.

### Method 2 line-item table missing

`renderMethodInputs(id, cfg, patch)` at line 148: for `id === 2`,
the helper returns only a placeholder paragraph:

```tsx
<div data-testid="funding-method-2-inputs">
  Per-line debt% / equity% configured under each cost row in Tab 3 (next sub-pass).
  Per-asset override via the existing inheritance toggle.
</div>
```

The "next sub-pass" never landed. `cfg.lineItemRatios` schema exists
(`{ master: FundingMethod2LineRatio[] }`) but no UI surface to edit
it.

## Root cause summary

Three things must change in Pass 4:

A. **Stop using `computeCapitalStack` with deprecated fields.**
   Build Capital Structure Overview from `funding` (already produced
   via `computeFunding(financingConfig, capexPerPeriod_project_wide)`)
   and `equity` (already produced via `computeEquity(financingConfig,
   funding, projectInKindLandValue)`). For per-facility debt
   allocation, use `tranche.facilitySharePct` (Pass 3 schema) over
   `funding.debtEquitySplit.debt.sum()`.

B. **Project-wide capex feeds the funding calc, not single-phase.**
   Replace `capexPerPeriod = phaseCost.perPeriod` with
   `inputsSummary.totals` (project-wide aggregate, all phases).
   `funding`, `equity`, and the schedules need to consume this.

C. **Method 2 line-item table.** Build a real editable table in
   `renderMethodInputs` for `id === 2` keyed off the union of cost
   line ids across the project. Each row carries `debtPct` (editable)
   and `equityPct = 100 - debtPct`. Persists to
   `financingConfig.lineItemRatios.master[]`.

## Hook layer fate

The `createFinancingHooks` factory + `FinancingDataHooks` contract
remain useful as the contract for future modules. They're not
broken; they're just unused by the current UI because the UI was
written before the hook contract landed and was never refactored.
Pass 4 keeps the hook layer intact (no breaking changes) and
optionally points the UI at it. For minimum scope, Pass 4 inlines
the equivalent project-wide capex computation into Module1Financing
(matches Inputs Summary Tables' approach) and leaves the hook
contract as the documented API for downstream Revenue / OpEx / Cash
Flow engines.

## Acceptance test for the fix

reference shape project:
- 1 phase, 4 construction periods
- 1 asset, BUA 130,874 sqm
- 1 cost line: Construction, `rate_per_bua`, value 4500, even
  phasing, periods 0..4
- 1 facility: Method 1 fixed ratio 70/30

Expected DOM values after the fix:
- Inputs Summary Table 1 row for Branded Apt: 588,933,000 total
- Capital Structure Overview Total Funding: 588,933,000
- Capital Structure Overview Total Debt (Sources): 412,253,100
- Capital Structure Overview Total Equity (Sources): 176,679,900
- Drawdown schedule for the facility: non-zero totals matching the
  capex × 70% per period.

Pass 4's verifier runs this fixture and asserts each value reads
from the DOM (or from the computed values via the same code paths
the UI uses).

## Plan

1. This diagnostic note (no code changes).
2. Fix 10 (force fix zero render): rewire Capital Structure Overview
   to consume `funding` + `equity` (project-wide), bypass
   `computeCapitalStack`'s stale-field path. Verify reference fixture
   renders 588M in the DOM.
3. Fix 9: Asset filter replaces Phase filter (`assetFilter` field;
   migration converts `phaseFilter`).
4. Fix 1: Method 2 line-item ratio table.
5. Fix 2: Funding Basis block above facilities.
6. Fix 3: Capital Structure Overview content per brief (sources +
   uses + gap chip).
7. Fix 6: universal accounting number formatter
   (`formatAccounting`).
8. Fix 4: compact field layout (2-3 fields per row in TrancheCard +
   project settings).
9. Fix 7: Schedules restructure (drop Drawdown standalone, replace
   Repayment with Debt Movement, add Finance Cost, restructure
   Equity Movement, drop empty period columns).
10. Fix 5 + Fix 8: Drawdown periods only + Total row styling
    applied universally + Equity Movement formatting.
11. Verifier + CLAUDE.md.
