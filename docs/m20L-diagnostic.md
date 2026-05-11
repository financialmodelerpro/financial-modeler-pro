# M2.0L — Diagnostic Notes (2026-05-11)

## TL;DR

The cost-line "duplication" the user is seeing in Tab 3 is real and
structural. Asset selector + 3 summary cards + sub-unit metric round-
trip + phase-scoped period dates + granularity remount + single Results
table are ALL implemented correctly per their M2.0j closure blocks. The
missing pieces are: (a) manual-phasing currency chips, (b) per-row
period chip strip, (c) % of Selected Lines checkbox picker, (d) Results
filter pill bar. Financing tab currently has 5 drawdown methods, 5
repayment methods, single-IDC-toggle; brief calls for 6 drawdown / 7
repayment / 3 IDC treatments, multi-facility shape, capital stack
overview, 6 schedule tables, cross-tab integration.

---

## Bug 1 — Cost line duplication (ROOT CAUSE)

`makeDefaultCostLines(phaseId, cp)` in `module1-types.ts:1186` returns
10 lines with **hardcoded ids** ('land-cash', 'land-inkind',
'construction-bua', ...). `buildWizardSnapshot.ts:161` runs:

```ts
const costLines = phases.flatMap((p) => makeDefaultCostLines(p.id));
```

A two-phase project ends up with 20 cost lines whose **ids collide
across phases**: `{id:'land-cash', phaseId:'phase_1'}` and `{id:'land-
cash', phaseId:'phase_2'}` both exist.

Downstream impact:

- **`module1-store.ts` `updateCostLine(id, patch)`** (line 225–227)
  uses `c.id === id` to match. Updating one phase's line updates the
  OTHER phase's line silently. Same for `removeCostLine`.
- **`Module1Costs.tsx:1141` Results sub-tab**: `linesForThisAsset`
  filter does NOT scope by `phaseId === a.phaseId`, so for every asset
  row in the Capex-by-Period table it walks all 20 lines. Most fall
  through (lineTotal=0) but React rendering produces colliding keys
  and the user sees identical rows.
- **`percent_of_selected` lines** carry `selectedLineIds:
  ['construction-bua', ...]`. Calc resolves by id match across the
  whole costLines array; in multi-phase projects this resolves both
  phases' lines (double-counts in some paths).

**Fix path**: phase-scope the ids. Compose
`${baseId}__${phaseId}` at create time, add `deriveLineBaseId(id)`
that strips the suffix for stage/role derivation, migrate legacy
duplicate-id snapshots in place. Also: fix the Results filter to
include `c.phaseId === a.phaseId`.

## Bug 2 — Asset selector + 3 summary cards

Implemented at `Module1Costs.tsx:1424–1585`. Confirmed working. The
user's "duplication" perception in the Inputs surface is the
per-asset cost segregation (N asset sections × M cost lines each).
Resolves to N×M visible rows by design (Fix 16). Compounding: when
multi-phase lines collide as in Bug 1, the per-asset filter would
still render only one phase's lines via `linesForAsset`'s phaseId
clause, BUT the store's collision means edits propagate across
phases.

## Bug 3 — Sub-unit metric Area↔Units round-trip

`switchMetric()` at `Module1Assets.tsx:1307–1319` is mathematically
correct: stores currentArea, derives count on switch to Units,
returns currentArea verbatim on switch back to Area. Round-trip
preserves total sqm IFF `unitArea > 0`. Bug user reports likely
boils down to: (a) `unitArea` was 0 at switch time (no unit-size
entered), so derived area = 0 on the return trip; or (b) UI editing
overwrote `metricValue` between switches. Adding a defensive snapshot
of the prior-area on the SubUnit row's local state + a warning when
`unitArea=0` AND `metric=units` (already present at line 1346) is
the right hardening.

## Bug 4 — Phase-scoped period dates

`Module1Costs.tsx:1488–1497` correctly reads `phase.startDate` and
threads `phaseScopedPeriodLabel` into every `AssetCostSection`.
`getPeriodLabel(idx, phaseStart, modelType)` returns "Dec 26" for
Phase 2 (start 2026) Y1. Capex by Period table at line 1109–1127
applies `(phaseStartYear - projectStartYear)` offset. **Confirmed
working**.

## Bug 5 — Granularity remount

`Module1Costs.tsx:1626` carries `key={`summary-${granularity}`}` on
`SummaryTables`. Remounts on toggle. **Confirmed working**.

## Bug 6 — Single Capex by Period table

Confirmed at `Module1Costs.tsx:1087–1192`. Three other tables
removed; per comment at 1194–1200. **Confirmed working**.

## Bug 7 — Missing UX patterns

Walkthrough of current `Module1Costs.tsx`:
- Manual % phasing currency chips: NOT PRESENT. Lines 656–714
  render a numeric % grid only.
- Per-row period chip strip below cost line: NOT PRESENT.
- % of Selected Lines picker UI (Incl./Excl. Dev Fee + checkbox
  list): only a select dropdown today.
- Results filter pill bar: NOT PRESENT (only Inputs has the asset
  selector).

## Bug 9 — Financing current state

`Module1Financing.tsx` (551 lines) renders a single facility-tranche
list + equity contributions + per-period schedule. Schema present:
`FinancingTranche` (5 drawdown methods, 5 repayment methods,
single `idcCapitalize: boolean`, no fees, no covenants, no
prepayments). `EquityContribution` (3 timings, no type, no IRR
hurdle / preferred return).

Brief calls for the matrix to widen:
- Drawdown methods → 6 (add `matched_to_capex`, `front_loaded`,
  `equal_periodic`, `custom_schedule`; clarify the existing 5)
- Repayment methods → 7 (add `equal_periodic_amortization`,
  `bullet`, `balloon`, `custom_schedule`)
- IDC treatment → 3 (`capitalize` / `expense` / `mixed`)
- Multi-facility with `facilityType` enum (senior_construction,
  senior_term, mezzanine, bridge, bullet, other)
- Fees (upfront + commitment, with per-treatment choice)
- Covenants (DSCR, LTV; informational)
- Equity tranches by `type` (cash / in_kind / jv) + IRR hurdle +
  preferred return + auto-detect from Land In-Kind cost line
- Cross-tab: IDC capitalised auto-generates read-only cost line per
  asset in Tab 3

## Fix plan

1. Phase-scope cost line ids → fix duplication.
2. Add `migrateM20lDedupeCostLineIds` (idempotent, runs on hydrate).
3. Fix `linesForThisAsset` in Results to filter by `phaseId`.
4. Add manual-phasing currency chips + per-row chip strip + %
   of-Selected picker + Results filter pill bar.
5. Extend Financing schema additively (v8 stays): equity tranche
   gains `type` / `irrHurdle` / `preferredReturn` / `autoDetected
   FromCostLine` / `source` / `scope` / `scopeId`. Debt tranche
   gains `facilityType` / `lender` / `tenorPeriods` / `availability
   Periods` / `gracePeriods` / `interestRateType` / `baseRate` /
   `spreadBps` / `upfrontFeePct` / `upfrontFeeTreatment` /
   `commitmentFeePct` / `dscrCovenant` / `ltvCovenant` /
   `idcTreatment` (replaces boolean) / `idcMixedSplitPeriod` /
   `balloonPct` / `sweepRatio` / `prepayments[]` / `pikEnabled`.
   Old `idcCapitalize` boolean stays for legacy read; new
   `idcTreatment` wins when set.
6. Add 6 drawdown + 7 repayment method enums.
7. Calc engine: `computeCapitalStack`, `computeIdcSummary`,
   `applyIdcToCapex` (returns auto cost lines for Tab 3),
   `computeDrawdownSchedule` per method, `computeRepayment
   Schedule` per method, `computeCombinedDebtService`.
8. UI: Capital Structure Overview cards, expand existing tranche
   editor with new fields, Schedules sub-tab with 6 tables, filter
   pill bar.
9. Cross-tab: IDC capitalized lines surface in Tab 3 Costs as
   read-only auto-lines (rendered under each asset section).
10. Verifier + Playwright + screenshots.

Deferred per brief:
- DSCR alerts (Module 5 dependency)
- Equity waterfall + IRR hurdle math (Module 4)
- Cash Sweep with full Operating CF (Module 5 dependency, ships
  with capex-only proxy + revenue × 0.4 placeholder)
- Sharia-compliant Murabaha/Ijara notes (later)
- Multi-currency (later)

## Constraints honoured

- v8 schema bump avoided; all additive optional fields.
- Backward compat: legacy `idcCapitalize: boolean` continues to be
  read when new `idcTreatment` is undefined.
- Em-dash sweep stays clean.
- M2.0d → M2.0j functionality preserved.
