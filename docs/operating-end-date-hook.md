# Operating End Date hook (M5 / terminal valuation contract)

**Tab 2 Pass 3 Fix 3, 2026-05-12.**

## What

Every hospitality asset (`strategy === 'Operate'` and every
`isCompanion === true` companion) carries an Operating End Date sourced
from its phase. The date is the LAST day of the phase's operating
window:

```
end_year = phase.startDate.year
         + (phase.constructionPeriods - phase.overlapPeriods)
         + phase.operatingPeriods
         - 1
operatingEndDate = Date.UTC(end_year, 11, 31)  // Dec 31 of end_year
```

Phases are annual (M2.0i locked `modelType === 'annual'` for inputs;
construction + operations periods are integer year counts). Each period
== 1 calendar year.

## Where

`src/core/calculations/index.ts`:

```typescript
export function computeOperatingEndDate(
  asset: Asset,
  phase: Phase | undefined,
): Date | null;

export function formatOperatingEndDate(date: Date | null): string;
```

`computeOperatingEndDate` returns `null` when the phase is missing or
`operatingPeriods <= 0` (the asset is not operational). The display
helper renders `Mon YYYY` (e.g. `Dec 2039`).

## UI contract

Tab 2 AssetCard surfaces the date with the testid
`asset-{id}-operating-end-date`. The inner value cell carries
`asset-{id}-operating-end-date-value`. Caption is fixed:

> Operating end date from Phase Setup. Edit phase operating period to
> change.

`UsefulLifeForm` no longer renders for Operate or companion assets;
only Lease assets keep depreciation (their terminal value concept is a
roll, not a horizon).

## M5 / valuation hook contract

The brief specifies a `getOperatingEndDate(assetId): Date` hook on the
M5 surface. Today (Tab 2 Pass 3) that hook resolves to the pure helper
below; once M5 ships a FinancingDataHooks-style hooks bag, it will
expose `getOperatingEndDate(assetId)` that internally looks up the
asset + phase and calls `computeOperatingEndDate(asset, phase)`. The
M5 implementer should read the helper directly when anchoring
horizons:

```typescript
import { computeOperatingEndDate } from '@/src/core/calculations';

const endDate = computeOperatingEndDate(asset, phase);
if (!endDate) {
  // asset is not operational; no terminal valuation
  return null;
}
const terminalYear = endDate.getUTCFullYear();
// drive DCF horizon, terminal cap-rate valuation, exit-cash-flow
```

There is no Zustand action to write this value; the date is derived,
not stored. When the user changes `phase.operatingPeriods` or
`phase.constructionPeriods` in Project Setup, the date updates on the
next render automatically.

## Why not Useful Life

Useful Life was a depreciation horizon (per asset type catalog default
or per-asset override). It's still applicable for Lease assets and any
future depreciable asset (Sell-with-Manage shell, parking structure).
But for hospitality the user's mental model is "the year operations
stop" rather than "years of depreciation life". The two collapse only
when construction + operating periods == useful life, which is rarely
the case. Operating End Date is the cleaner anchor and the cash-flow
horizon already needs it for terminal value.
