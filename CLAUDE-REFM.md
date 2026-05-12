# Real Estate Financial Modeling (REFM), Claude Code Project Brief
**Last updated: 2026-05-12, Tab 2 Pass 3 (Quick Fixes) ships on top of Tab 2 Pass 2 + Pass 1 + M2.0 Pass 10. Four commits land 3 quick fixes. T2P3-Fix 1 widens the Land Reconciliation "Equal" chip threshold from 0.5 to 1000 sqm / 1000 SAR so projects that tie within rounding noise read Equal instead of Under / Over, with an italic "(within rounding tolerance)" caption when the band kicks in. T2P3-Fix 2 makes companion.type inherit from parent.type: makeCompanionAsset reads parent.type, updateAsset propagates type edits live, and a new migrateT2P3CompanionType migration retroactively syncs legacy snapshots (wired into all 3 hydrate chains; idempotent). T2P3-Fix 3 replaces the period-count "Operating Period: X years" chip and the depreciation UsefulLifeForm with an Operating End Date sourced from the parent phase (computeOperatingEndDate helper: end_year = startDate.year + constructionPeriods - overlapPeriods + operatingPeriods - 1; returns Dec 31 of that year; null when phase missing or ops <= 0). Applied to every hospitality asset (Operate strategy + Sell+Manage companion); Lease assets keep UsefulLifeForm. M5 / terminal-valuation hook contract documented at docs/operating-end-date-hook.md. Verifier verify-tab2-pass3.ts 33/0 across 4 sections. Schema unchanged. Tab 1, Tab 3, Tab 4 untouched.

**Tab 2 Pass 2 (prior, still in place):** 4 data rules + 4 fixes. T2P2-Fix 1 rewrote computeAssetLandSqm so resolution follows the 4 data rules exactly (companion-zero -> multiParcelSplits -> explicit sqm > 0 -> no parcels in phase -> explicit percent > 0 -> no non-companion assets in phase -> autoByBua bua-share -> equal-share fallback when totalBua = 0). T2P2-Fix 2 swept companion guards across the asset card (Areas Row + per-asset NDA + NSA/BUA/GFA chips + footer summary + Land Recon list). T2P2-Fix 3 dropped the Area Reconciliation summary on companion. T2P2-Fix 4 auto-hid the recon block on non-companion assets with zero data across all 8 physical attributes.

**Tab 2 Pass 1 (prior, still in place):** 5 issues over 4 commits. T2-Fix 1 added the sqm/percent fall-through to autoByBua (refined in Pass 2). T2-Fix 2+3 rewrote LandReconciliationBlock as a 3-col structured table with Equal/Under/Over chips. T2-Fix 4 verified Revenue stays in the AssetAreaReconciliationBlock summary line (from Pass 10 Fix 7). T2-Fix 5a/b/c shipped the companion (Sell + Manage Operate sibling) corrections: Land Allocation hidden, Useful Life replaced with Operating Period chip from parent phase, companion sub-units auto-mirrored from parent's Sellable rows.**

> **See also:**
> - [CLAUDE.md](CLAUDE.md), Root project brief, session rules, stack, auth, envs
> - [CLAUDE-MODELING-HUB.md](CLAUDE-MODELING-HUB.md), Modeling Hub platform catalog + P-Sync conventions
> - [CLAUDE-FEATURES.md](CLAUDE-FEATURES.md), Archived Module 1 phase narratives (M1.R → M1.13d pre-M2.0, M2.0 → M2.0i post-rebuild)
> - [CLAUDE-DB.md](CLAUDE-DB.md), Database tables, migrations log
> - [CLAUDE-ROUTES.md](CLAUDE-ROUTES.md), Routes + components + lib structure

---

## REFM Design System

REFM (Module 1 tabs + shell + modals + Area Program tab) uses **FAST input blue** instead of `.input-assumption`:
- Input bg: `var(--color-navy-pale)` + text: `var(--color-navy)` via the local `inputStyle` constant in each component
- Calculated outputs use `calcOutputStyle`: `var(--color-grey-pale)` bg + `var(--color-heading)` text
- Established Phases 4.6 → 4.15 (2026-04-30), extended into M1.7 Area Program tab (2026-05-02)
- The `.input-assumption` class is reserved for actual financial-model assumption cells (rates, ratios, escalators) and continues to apply outside REFM

---

## REFM Verifier Scripts

```bash
# Module 1 regression-guard snapshot diff (single v8 baseline)
npx tsx scripts/module1-v5-diff.ts              # 47.8 KB baseline (sha256 824ef8e1706d)

# Per-phase verifiers (5 sections: schema/types / calc / state / source markers / Playwright UI)
# Current canonical green: verify-tab2-pass3.ts (Quick Fixes)
npx tsx scripts/verify-tab2-pass3.ts            # T2 Pass 3 Quick Fixes 1+2+3 (33/0)
npx tsx scripts/verify-tab2-pass2.ts            # T2 Pass 2 data rules + Fix 1+2+3+4 (24/0)
npx tsx scripts/verify-tab2-fixes.ts            # T2 Pass 1 Focused Fixes 1+2+3+4+5a+5b+5c (47/0)
npx tsx scripts/verify-m20costsCleanup-pass10.ts # M2.0 Pass 10 Cost cleanup + audit (55/0/0)
npx tsx scripts/verify-m20costsCleanup-pass9.ts # M2.0 Pass 9 Land zero forced fix (37/0/0)
npx tsx scripts/verify-m20costsCleanup-pass8.ts # M2.0 Pass 8 Costs cleanup (41/0/0)
npx tsx scripts/verify-m20costsCleanup-pass7.ts # M2.0M Pass 7 per-asset architecture (52/0/2)
npx tsx scripts/verify-m20M-pass4.ts            # M2.0M Pass 4 Financing force-fix (61/0/0)
npx tsx scripts/verify-m20M-pass3.ts            # M2.0M Pass 3 Financing simplification (42/0/0)
npx tsx scripts/verify-m20M-pass2.ts            # M2.0M Pass 2 Tab 4 Financing cleanup (50/0)
npx tsx scripts/verify-m20costsCleanup.ts       # M2.0M Pass 6 Costs cleanup (36/0)
npx tsx scripts/verify-m20M.ts                  # M2.0M Financing definitive rewrite (67/0/0)
npx tsx scripts/verify-m20L-pass5.ts            # Category + Driver + auto-derived CostType (31/0/0)
npx tsx scripts/verify-m20L-pass4.ts            # parent/child inheritance cost engine (30/0/0)
npx tsx scripts/verify-m20L.ts                  # M2.0L cost duplication fix + Financing build (74/0/2)
npx tsx scripts/verify-m20j.ts                  # M2.0j Module 1 audit + display 16 fixes (60/0/2)

# Older verifiers (M2.0 through M2.0i) still pass against current state and remain in scripts/.
# See CLAUDE-FEATURES.md "Module 1 (REFM) M2.0 Phase History" for per-verifier scope.

# Playwright e2e (current spec for live state)
npx playwright test tests/e2e/m20L-costs-financing.spec.ts  # 10 specs + dark-mode
npx playwright test tests/e2e/m20j-costs-audit.spec.ts     # 8 specs + dark-mode
# Older M2.0 → M2.0i specs live in tests/e2e/ and remain runnable.
# m20c-costs-financing.spec.ts is .skip()'d (frozen v6).
```

### Per-phase verification workflow (M1.7+)
Standing preference (2026-05-02): every REFM phase ships a `scripts/verify-[phaseId].ts` covering 5 sections:
1. **Database / persistence**: Supabase JSONB roundtrip via service-role
2. **Route smoke tests**: 401-without-auth gates; skips when `localhost:3000` is down
3. **Calculation correctness**: snapshot diffs + targeted assertions on fixture inputs
4. **State integrity**: load fixture into store, mutate via store actions, assert cascade
5. **UI rendering**: Playwright headless light + dark screenshots saved to `tests/screenshots/[phase]/{light,dark}-*.png`; skips when dev server is down or Playwright not installed

Test-user fixture id `00000000-0000-0000-0000-000000000000` with `ON DELETE CASCADE` cleans downstream rows on teardown. M1.7 reference: 25 pass / 0 fail / 2 skip without dev server.

**Dev dependencies**: `@playwright/test ^1.59.1` + chromium browser (`npx playwright install chromium`).

---

## Module 1 status (2026-05-12, **Tab 2 Pass 3: Quick Fixes**)

**Tab 2 Pass 3 (current, ships):** 3 quick fixes layered on Pass 2.
Schema unchanged. Tab 1 / Tab 3 / Tab 4 untouched.

- **Fix 1 (Land Recon tolerance band, ships):** the Equal chip and
  status footer now treat allocated-vs-NDA gaps under 1000 sqm and
  allocated-vs-Total Parcel Value gaps under 1000 SAR (currency
  units) as Equal. Below the band, status reads "✓ Equal" with an
  italic "(within rounding tolerance)" caption when the gap is
  non-zero. Out-of-band stays Under / Over.

- **Fix 2 (companion.type inherits from parent.type, ships):** three
  surfaces. (a) `makeCompanionAsset` factory reads `parent.type` so a
  Residential Sell + Manage parent yields a Residential Operate
  companion. (b) Store `updateAsset` action propagates `type` edits
  on the parent to every companion whose `parentAssetId` matches; runs
  regardless of whether strategy is in the patch. (c) New
  `migrateT2P3CompanionType` migration walks every snapshot's
  companions and copies `parent.type` when the two diverge. Wired into
  all 3 hydrate chains (`stripV8Wrapper`, `stripWrapper`,
  `migrateLegacyToV8`). Idempotent.

- **Fix 3 (Operating End Date replaces period count + Useful Life on
  hospitality, ships):** new helpers in `src/core/calculations`:
  - `computeOperatingEndDate(asset, phase): Date | null` returns Dec
    31 of `startDate.year + constructionPeriods - overlapPeriods +
    operatingPeriods - 1` (annual phase model since M2.0i). Returns
    `null` when phase missing or `operatingPeriods <= 0`.
  - `formatOperatingEndDate(date): string` returns 'Mon YYYY' (e.g.
    'Dec 2039') or '-' for null.

  Tab 2 AssetCard surfaces the date with testid
  `asset-{id}-operating-end-date` for every hospitality asset
  (`strategy === 'Operate'` OR `isCompanion === true`). Caption:
  *Operating end date from Phase Setup. Edit phase operating period
  to change.* The previous "Operating Period: X years" chip
  (companion only, Pass 1 Fix 5b) and `UsefulLifeForm` (regular
  Operate) are both replaced. Lease assets keep `UsefulLifeForm`
  because depreciation life still applies; the terminal-horizon
  concept does not (leases roll). M5 / terminal-valuation hook
  contract documented at `docs/operating-end-date-hook.md`.

- **Verifier:** `scripts/verify-tab2-pass3.ts` 33 pass / 0 fail across
  4 sections (Fix 1 markers + Fix 2 factory + store + migration
  end-to-end smoke test with retroactive inheritance + idempotency +
  Fix 3 helper math on real fixture + UI markers + M5 doc + em-dash
  sweep).

Commits (4): `d40ffd3` (Fix 1 tolerance band), `891611c` (Fix 2
companion type inheritance), `0209d89` (Fix 3 Operating End Date),
closure (verifier + CLAUDE update).

---

## Module 1 status (2026-05-12, **Tab 2 Pass 2: Data Ownership + Auto-Rendering**)

**Tab 2 Pass 2 (current, ships):** 4 data rules + 4 fixes. Audit doc
lands first per the brief; fixes follow naturally from the rules.
Schema stays v8 additive (no new fields). Tab 1 / Tab 3 / Tab 4
untouched.

- **Rule 1: Asset Land Allocation** has a strict resolution order:
  multiParcelSplits → explicit `landAllocation.sqm > 0` → autoByBua
  bua-share within phase → equal-share fallback when phase totalBua=0.
  Phase with no parcels returns 0; phase with no non-companion assets
  returns 0; companion always returns 0.

- **Rule 2: Companion has no physical attributes.** Companion does NOT
  carry Land Allocation, BUA / NSA / GFA, sub-unit area, land cost,
  area reconciliation, or area-based cost lines. Companion DOES carry
  mirrored sub-units (Pass 1 Fix 5c), Operating Period (Pass 1 Fix 5b),
  and ADR-based revenue inputs (M2.1 work).

- **Rule 3: Conditional rendering** of UI sections must respect data
  ownership.

- **Rule 4: Phase-level aggregation** sums only non-companion assets in
  that phase. Companions never contribute to phase land totals.

- **Fix 1 (`computeAssetLandSqm` rewrite, ships):** rewrites the calc
  function so the resolution order matches the rules exactly. Each
  gate is an early return so the function reads top-to-bottom in
  priority order. Companion guard moves to the top (Rule 2) so a
  companion never participates in any allocation math even when called
  with a fixture that has parcels in its phase. Phase parcels + phase
  non-companion assets are explicit gates; either being empty returns
  0 instead of accidentally allocating across phase boundaries.
  Sqm / percent modes with 0 explicit input still fall through to
  autoByBua (Pass 1 Fix 1 behaviour kept) so brand-new projects show
  meaningful per-asset values. Signature unchanged (5 args). Verifier
  Section 2 proves the math on the user's MAAD multi-phase fixture
  (Phase 1: parcel + no assets → 0 for any phantom call; Phase 2:
  Branded Apt + Residential split 50000 sqm by BUA proportion; Phase 3:
  Hotel + Retail split 40000 sqm by BUA proportion; companion always
  0; explicit sqm > 0 wins; equal-share fallback when totalBua=0).

- **Fix 2 (companion guard sweep, ships):** wraps the Areas Row
  (Support / Parking / GFA inputs), the per-asset NDA row, the
  NSA / BUA / GFA hierarchy chips, and the per-asset footer summary
  (BUA / NSA / Efficiency / Land cost) in `!asset.isCompanion`. The
  companion now renders just its header + Operating Period chip +
  Sub-units mirror; nothing else. Land Reconciliation Asset Allocations
  list filters out `isCompanion === true` so the recon never gets a
  phantom row for an asset that owns no land.

- **Fix 3 (companion drops Area Reconciliation summary, ships):**
  companion never renders the `AssetAreaReconciliationBlock` (the
  verification chip with BUA / NSA / Efficiency / Land Cost / Revenue).
  None of those concepts apply to a companion.

- **Fix 4 (auto-managed Area Reconciliation, ships):** non-companion
  assets that carry ZERO data in every physical attribute (no
  sub-units, no BUA, no NSA, no Support, no Parking, no land sqm, no
  land cost, no sub-unit revenue) auto-hide the recon block. The
  block reappears the moment the user enters any data. Surfacing
  "0 / 0 / 0%" on a brand-new empty asset is noise.

- **Verifier:** `scripts/verify-tab2-pass2.ts` 24 pass / 0 fail across
  5 sections (audit doc + Fix 1 calc end-to-end on MAAD multi-phase
  shape + Fix 2 companion guards + Fix 3+4 auto-managed recon +
  em-dash sweep).

- **Playwright spec:** `tests/e2e/tab2-pass2.spec.ts` (2 specs). First
  seeds the MAAD multi-phase snapshot (Phase 1 parcel + no assets;
  Phase 2 parcel + Branded Apt + Residential + companion; Phase 3
  parcel + Hotel + Retail) and asserts the `recon-asset-a-branded-sqm`
  cell renders non-zero post-Fix 1. Second asserts the companion card
  carries NO Land Allocation / Areas Row / NDA / hierarchy / footer /
  Area Reconciliation surfaces and DOES carry the Operating Period +
  companion badge. Captures screenshots to
  `tests/screenshots/tab2-pass2/`. Skips in headless dev without
  NextAuth; runs post-auth via `--headed`.

Commits (5): audit doc - Fix 1 - Fix 2+3+4 - verifier - closure.

---

## Module 1 status (2026-05-12, **Tab 2 Focused Fixes**)

**Tab 2 Focused Fixes (current, ships):** 5 issues scoped strictly to
Tab 2 (Assets & Sub-units). Tab 1, Tab 3, Tab 4 untouched per brief.
Schema stays v8 additive (SubUnit gains `parentSubUnitId?` +
`startingAdr?`; no other shape changes).

- **Fix 1 (per-asset Sqm Allocated population)**: `computeAssetLandSqm`
  sqm and percent modes now fall through to the autoByBua branch when
  the asset's allocation is 0, so brand-new projects with allocations
  not yet entered still surface a non-zero Sqm Allocated row in Land
  Reconciliation. Existing non-zero allocations keep their explicit
  values. MAAD-shape fixture (1 parcel, 1 asset, sqm=0) now returns
  22066 sqm via the equal-share fallback (Pass 10 Fix 9 path).

- **Fix 2 + 3 (Land Recon NDA + Land Value layout + chips)**:
  `LandReconciliationBlock` rewritten as a single 3-column structured
  table (Description / Sqm / Land Value, `data-testid="land-reconciliation-table"`).
  Always renders (no longer gated on `projectNdaEnabled`). Roads / Parks
  rows appear only when NDA is on; the Net Developable Area row is
  always shown (equals Total Parcel when NDA disabled). Per-asset rows
  surface BOTH `Sqm Allocated` AND `Land Cost`. Total Allocated row
  carries independent Equal / Under / Over chips on both columns via a
  shared `chipFor` helper: Sqm chip compares vs NDA, Land Cost chip
  compares vs Total Parcel Value. Unassigned Land row appears below the
  Total Allocated row. Status footer at the bottom summarises both
  columns side-by-side. The legacy red "short by X" section is gone.

- **Fix 4 (Revenue in sub-unit verification)**: no-op confirmation. The
  `Revenue` field in `AssetAreaReconciliationBlock`'s inline summary
  was added in Pass 10 Fix 7 (commit `aaf847b`) and is still in place.
  Verifier asserts the marker is present.

- **Fix 5a (companion Land Allocation hidden)**: Land Allocation block
  is wrapped in a `!asset.isCompanion` guard. Companion (Sell + Manage
  Operate sibling) inherits its units count from the parent and never
  carries land of its own; rendering Land Allocation on a companion
  was misleading.

- **Fix 5b (companion Operating Period chip)**: companion assets
  replace `UsefulLifeForm` with a read-only "Operating Period: X years"
  chip sourced from the parent phase's `operationsPeriods`. Caption
  directs the user to Project Setup to edit. Non-companion Operate /
  Lease assets keep the existing `UsefulLifeForm`.

- **Fix 5c (companion sub-units auto-mirrored from parent Sellables)**:
  - **Schema (additive)**: `SubUnit.parentSubUnitId?: string` marks a
    row as a companion shadow; `SubUnit.startingAdr?: number` carries
    the Average Daily Rate (the only editable field on a companion
    sub-unit).
  - **Factory**: `makeCompanionSubUnit(parentSubUnit, companionAssetId, preservedAdr?)`
    in `module1-types.ts`. metric='units', unitArea=0, metricValue =
    parent's metricValue (units mode) or `round(area / unitSize)` (area
    mode). unitPrice mirrors startingAdr so legacy revenue math still
    works.
  - **Store sync**: new `syncCompanionSubUnits(assets, subUnits)` helper.
    `addSubUnit / updateSubUnit / removeSubUnit` chain it after
    `syncCompanionUnits` so any change to the parent's Sellable list
    propagates to every companion. `updateAsset` `becomesSellManage`
    transition also seeds the initial mirror.
  - **Migration**: `migrateT2CompanionSubUnits` runs at the tail of
    every hydrate chain (`stripV8Wrapper / stripWrapper /
    migrateLegacyToV8`). For each companion asset, walks the parent's
    Sellable sub-units, preserves ADR by matching `parentSubUnitId`
    first then by lowered name as a fallback (so legacy snapshots with
    hand-edited companion sub-units carry ADR forward), drops sub-units
    whose parent has been deleted, and adds shadows for new parent
    Sellables with ADR=0. Idempotent.
  - **UI**: `SubUnitRow` has an `isCompanionSub` branch that renders
    Type (parent name) + Category ("Operable") as read-only mirrors,
    Area + Unit Size as muted dashes, Count derived from parent,
    `startingAdr` editable, Total Revenue = `count x ADR`, no delete
    cell. Sub-units header on companion hides the `+ Sub-unit` button
    + metric toggle and shows a small "Mirrored from parent. Edit ADR
    only." note.

- **Verifier**: `scripts/verify-tab2-fixes.ts` 47 pass / 0 fail across
  9 sections (calc fall-through math + Land Recon table + chip helper
  + Revenue summary marker + Fix 5a guard + Fix 5b chip markers +
  Fix 5c schema/factory/row branch + store integration + migration
  end-to-end smoke test with ADR preservation + idempotency + em-dash
  sweep).

Commits (3): `162c3ee` (Fix 1) - `a48d66a` (Fix 2 + 3) - `cfd1588`
(Fix 5a + 5b + 5c). Type-check + snapshot diff clean on every commit.

---

## Module 1 status (2026-05-12, **M2.0 Costs Cleanup Pass 10 (partial)**)

**M2.0 Pass 10 (current, partial ships):** Recovery + Architecture Restoration. User explicitly frustrated after Pass 9 regressions (collapsed default cost rows + lingering Land Zero in user's project + various polish gaps). Pass 10 ships 8 of 10 fixes; Fix 3 (hybrid architecture revert of Pass 7) and Fix 8 (accounting format sweep) are large-scope and deferred to follow-up. Mandatory regression audit at `docs/m20costs-pass10-regression-audit.md` shipped first per brief; documents 9 surfaces with file:line refs + implementation order. Verifier `scripts/verify-m20costsCleanup-pass10.ts` 43 pass / 0 fail / 0 skip across 10 sections.

- **Fix 6 (collapse foundation, ships):** Tab 2 Phase + Asset cards default-collapsed via localStorage `m20-phase-collapsed-{id}` / `m20-asset-collapsed-{id}`. Bulk event `m20-tab2-collapse-bulk` listened by each card. Top of Tab 2 ships Expand all / Collapse all buttons. Top of Tab 3 (inside `costs-inputs-asset-nav`) ships the same pair wired to the existing `m20-cost-row-collapse-bulk` event (Pass 9 Fix 6). Tab 4 Inputs Summary Tables wrapped in collapsible header with localStorage `m20-financing-summary-collapsed`. Tab 3 AssetCostSection stays expanded-by-default (active-asset work surface; collapsing defeats pill-click purpose). Cost line rows remain collapsed by default per Pass 9 Fix 6.

- **Fix 1 (collapsed cost row legibility, ships):** Pass 9 Fix 6 collapsed-by-default hid Value/Start/End/Phasing behind dashes; user read this as "inputs were removed". Pass 10 swaps the dashes for read-only formatted values: `formatScaled(effValue, 'full', decimals)` for Value, integers for Start/End, `PHASING_LABELS[effPhasing]` for Phasing. Chevron + row click still required to EDIT. Addresses the discoverability gap while keeping Fix 6 collapsed-default intact. New testids: `cost-{aid}-{lid}-{value,start,end,phasing}-collapsed`.

- **Fix 9 (Land Zero deeper fallback, ships):** Pass 9 Fix 8 widened `computeAssetBua` to fall back to `asset.buaSqm` when sub-units sum to 0. But `computeAssetLandSqm` autoByBua branch (line 206) still returned 0 when totalBua across ALL phase assets was 0 (every asset stub: no sub-units AND no buaSqm). Pass 10 closes the gap: when totalBua=0 and phase has at least one visible asset, fall back to equal-share allocation: `agg.totalAreaSqm / phaseAssets.length` per asset. Guarantees a non-zero land allocation the moment the user adds a parcel, even before any BUA is entered. **Playwright screenshot proof deferred**; verifier section 4 proves the math end-to-end on a MAAD-shape fixture (130874 BUA single asset still resolves 22066 sqm land via Pass 9 Fix 8 path; zero-BUA two-asset fixture splits 22066/2 evenly via Pass 10 Fix 9 path).

- **Fix 2 (auto-replicate cost lines on addAsset, ships):** Pass 7's per-asset architecture requires every CostLine to carry `targetAssetId` with composed id `${baseId}__${phaseId}__${assetId}`. Pass 7 migration replicated for existing assets, but `addAsset` never replicated for subsequent additions, leaving new assets with zero cost lines (Tab 3 effectively blank). `addAsset` now finds a phase peer, takes its cost lines as template, re-composes ids + retargets to new asset, appends. Falls back to `makeDefaultCostLines` re-composed when no peer exists. `removeAsset` cascade extended: also removes companion children (parentAssetId pointing at removed parent) + their sub-units + cost lines + costOverrides.

- **Fix 5 (NDA Recon polish, ships):** Asset allocations grid widens 2 → 3 columns: Asset | Sqm Allocated | Asset Land Cost. Per-asset land value via new `assetLandValueByAssetId` prop (computeAssetLandBreakdown). New Unassigned Land row (NDA - Total Allocated) shows positive value when under, dash when matched, red Over-allocated chip when over. Top summary line: when `projectNdaEnabled`, compares allocations against NDA (post-deduction) instead of gross parcels (drops the misleading "short by 10,630" message). New testids: `recon-asset-{id}-value`, `recon-allocated-value`, `recon-unassigned-sqm`, `recon-over-allocated-sqm`.

- **Fix 7 (Revenue in sub-unit verification summary, ships):** `AssetAreaReconciliationBlock` gains `totalRevenue` prop. Caller computes locally: sum of `metricValue * unitPrice` across revenue sub-unit categories (Sellable / Operable / Leasable); Support excluded. Inline summary now reads: `Verification: BUA X | NSA X | Eff X% | Land X | Land Cost X | Revenue X`. New testid: `asset-{id}-recon-revenue`.

- **Fix 4 (Sell + Manage Operate companion, ships):** Sell + Manage strategy now models as two linked assets: parent SELLS units, companion OPERATES them as hospitality post-handover. Schema additions on Asset (v8 additive): `parentAssetId / isCompanion / companionType: 'operate' / unitsFromParent`. `makeCompanionAsset(parent, units)` factory. `Store.updateAsset` bookkeeping on strategy switch: TO 'Sell + Manage' creates companion with current Sellable units snapshot; AWAY FROM cascade-removes companion + sub-units + cost lines + overrides. `Store.addSubUnit/updateSubUnit/removeSubUnit` thread through new `syncCompanionUnits(assets, subUnits)` helper that recomputes `unitsFromParent` on every companion from its parent's current Sellable units sum (identity-preserving so React shallow-equals short-circuits). `computeAssetLandSqm` filters companions out of phaseAssets aggregation AND returns 0 immediately when the asset itself is a companion (no double-counting of land). Tab 2 ManagementAgreementForm hidden for Sell+Manage (schema fields kept for back-compat; M2.1 Revenue picks up operate stream from companion). Companion renders a dashed-navy badge: "Auto-generated Operate companion. Units track parent (N keys from parent's Sellable sub-units). Removing the parent removes this companion."

- **Fix 10 (commission revenue hooks, ships):** Two new CostMethod values: `percent_of_revenue_cash` / `percent_of_revenue_sale`. Two new hooks on `FinancingDataHooks`: `getTotalRevenueCashBasis(assetId?)` / `getTotalRevenueSaleBasis(assetId?)` returning zero-stub PeriodArrays until M2.1 Revenue ships. Contract documented at `docs/cost-revenue-hooks.md`: M2.1 implementer swaps stubs for real PeriodArrays driven by cohort payment schedule (Sell) / ADR-occupancy-days-rooms (Operate) / rate-area-indexation (Lease) / parent+companion (Sell+Manage). `calculateItemTotal` returns 0 for both methods today (no revenue pre-M2.1; per-period commission distribution arrives via hook PeriodArray when revenue is non-zero). User can SELECT the methods on Commission cost lines today; Total column shows 0 correctly.

- **Fix 3 (hybrid project-wide + per-asset override architecture, ships):** Walks back Pass 7's per-asset CostLine architecture to a hybrid. Single project-wide master per (phaseId, baseId); each asset's Total recomputes per its own metrics on pill switch; lightweight per-asset Override toggle re-introduces `CostOverride[]` (NOT the Pass 4 stacked master+replica double-table). `migrateM20costsPass10Hybrid` walks every CostLine with non-companion `targetAssetId`, groups by (phaseId, baseId), picks the first asset's replica (by phase asset order) as canonical, recomposes the master id as `${baseId}__${phaseId}`, stamps `CostOverride` entries for replicas whose method / value / phasing / distribution / perSubUnitRates / startPeriod / endPeriod / disabled diverge. Rewrites `selectedLineIds` references. Idempotent. Companion-bound lines (parentAssetId asset) keep their targetAssetId. `M20_PASS10_NOTICE` banner: *"Cost lines simplified to project-wide. Where assets carried different rates, the first asset's rate was used as the master; per-asset overrides preserved."* Prioritised ahead of Pass 4 Financing / Pass 8 in `resolveBanner`. CostRow gains `✏ Override` / `↺ Inherit master` toggle next to the Total column (visible only on unlocked, non-custom, project-wide, expanded rows); `startOverride` seeds the override from master's current values. Store `addAsset` reverted from Pass 10 Fix 2 per-asset replication: new assets just inherit project-wide masters; `makeDefaultCostLines` seeded only when the phase has zero cost lines (first asset in brand-new phase). Snapshot baseline bit-identical (`scripts/baselines/module1-v5.json` 56.2 KB sha256 eb70b0b6e4ba).

- **Fix 8 (AccountingNumberInput sweep, ships):** Large-number bare `<input type="number">` sites swapped to AccountingNumberInput (focus = raw editable; blur = thousand-separator formatted). Tab 2 migrated: parcel area, sub-unit area + unit-size, asset Land Area + Custom Rate + Support Area + Parking Area + GFA Override. Tab 4 migrated: Method 3 Existing Cash, Project Minimum Cash Reserve. Inputs that stay bare (per brief): %-of-100 fields (Roads/Parks %, cashPct/inKindPct, land %, NDA Roads/Parks %, Management Fee/Owner %, funding method debt%/equity%, LTV/DSCR covenants, fee %s), period counts (Tenor, Availability, Grace, Repayment), Useful Life Years, sub-unit Count derived.

- **Schema migration banner:** `M20_PASS10_NOTICE` surfaces once when migration converts Pass 7 per-asset replicas to project-wide masters. Other Pass 10 fixes (Fix 1 / 2 / 4 / 5 / 6 / 7 / 9 / 10) are display-only or additive and need no migration step.

- **Verifier:** `scripts/verify-m20costsCleanup-pass10.ts` 53 pass / 0 fail / 0 skip across 12 sections (audit doc presence + each fix's source markers + calc fixture math + hybrid architecture markers + AccountingNumberInput sweep coverage + em-dash sweep + Pass 10 status in CLAUDE-REFM.md).

- **Playwright spec:** `tests/e2e/m20costs-pass10.spec.ts` (2 specs). Seeds a MAAD-shape snapshot into `module1-store` localStorage, navigates to /refm Tab 3, asserts Land (Cash) + Land (In-Kind) totals non-zero, captures screenshot to `tests/screenshots/m20costs-pass10/land-zero-proof.png`. Skips gracefully in headless dev without NextAuth; runs post-auth via `npx playwright test ... --headed`.

Commits (12): `5752454` (audit), `ca4c5ab` (Fix 6 collapse foundation), `2cff997` (Fix 1 readonly collapsed cells), `162d053` (Fix 9 deeper Land Zero fallback), `dfec7c7` (Fix 2 addAsset replication + Asset schema; Fix 3 later replaced this path), `aaf847b` (Fix 5 + 7 NDA Recon polish + Revenue in summary), `fc63dfa` (Fix 4 Sell+Manage companion), `56f0f12` (Fix 10 commission revenue hooks), `ba30e1a` (initial closure), `259c343` (Fix 3 hybrid architecture), `eb6d1b7` (Fix 8 AccountingNumberInput sweep + extended verifier), final closure (Playwright spec + CLAUDE-REFM.md final update). Type-check clean on every commit.

## Module 1 status (2026-05-12, **M2.0 Costs Cleanup Pass 9**)

**M2.0 Pass 9 (current, ships):** 8 fixes + mandatory diagnostic. Schema stays v8 additive (no new fields).

- **Mandatory diagnostic** at `docs/m20costs-pass9-land-zero-diagnostic.md` (commit first). Identifies root cause of the Land Cash / Land In-Kind cost lines rendering zero across 4 prior passes: `computeAssetBua` at `src/core/calculations/index.ts:136-140` has a narrower fallback than `resolveAssetAreaMetrics`. When an asset carries stub sub-units (`metricValue=0`), `computeAssetBua` returns 0 without trying `asset.buaSqm`. `resolveAssetAreaMetrics` was patched in M2.0L Fix 4 / Pass 3 widening; `computeAssetBua` was never patched. The autoByBua land allocation path walks `computeAssetBua` directly via `computeAssetLandSqm`, so `landSqm=0 -> landValue=0 -> cashLandValue=0 -> Land cost = 0`.

- **Fix 8 (Land zero forced fix)**: patch `computeAssetBua` + `computeAssetSellableBua` to fall back to `asset.buaSqm` / `asset.sellableBuaSqm` when sub-units exist but sum to zero. MAAD fixture (parcel 22,066 sqm x 98,450 SAR, 80% cash, asset with `buaSqm=130,874` + stub sub-unit) now renders Land (Cash) 1,737M + Land (In-Kind) 434M in `byLineId` end-to-end (verified by Section 2 of the Pass 9 verifier).

- **Fix 1 (round derived Count)**: `SubUnitRow` rounds the derived Count to a whole number via `Math.round(area / unitSize)`. Total Revenue uses the rounded count when in Units mode (so the displayed math stays self-consistent: `Total = roundedCount x Rate`). Applies to all category labels via `countUnitLabel` (Units / Keys / Beds / Bays / Tenants / Items).

- **Fix 2 (NDA Recon walk)**: `LandReconciliationBlock` gains a new walk + per-asset allocation block when `projectNdaEnabled=true`: Total Parcel Land - Roads% - Parks% = Net Developable Area, then asset allocations sum to NDA with `✓ matches NDA` chip when balanced. New data-testids: `land-reconciliation-nda-walk`, `recon-total-land`, `recon-roads`, `recon-parks`, `recon-nda`, `recon-asset-{id}-sqm`, `recon-allocated`.

- **Fix 3 (End period drop max cap)**: End input on cost line rows drops HTML5 max + JS clamp. User can enter any value. Informational chip "extends into operations period" when End > maxCp (does not block). Blocking error chip "End must be on or after Start" + red border + `aria-invalid` when End < Start. The "Clamp to maxCp" button (Pass 8) is gone.

- **Fix 4 (universal K/M strip)**: `formatScaledCurrency` now delegates to `formatAccounting` internally (zero -> "-", parens for negative, no K/M suffix). Every cell-rendering site in Module1Costs (16 sites) + Module1Assets (8 sites) + Dashboard + OverviewScreen swapped `formatScaled` -> `formatAccounting`. Scale indicator stays once in tab header via `currencyHeaderLine`. `formatScaled` remains exported for `AccountingNumberInput` which always uses `scale="full"` on raw editable inputs.

- **Fix 5 (caption drops = result)**: `costLineCaption` returns just the formula (e.g. `"4,500 x 130,874 sqm BUA"`); the trailing `"= 588,933,450"` part is gone. Total column to the right already shows the number. `CostLineCaptionInput.resolvedTotal` retained on the interface for API stability but ignored by the helper.

- **Fix 6 (collapsible cost line rows)**: `CostRow` gains per-row collapse state. Collapsed (default) shows Name + Method + dashes in Value / Start / End / Phasing + Total + Toggle + Delete. Expanded shows the full input surface. Chevron (▶/▼) at the start of the Cost Line cell toggles. localStorage persistence keyed `m20-cost-row-collapsed-{lineId}`. AssetCostSection header gains Expand all / Collapse all bulk buttons that rewrite localStorage for every visible line id and broadcast `m20-cost-row-collapse-bulk`; each row listens and re-reads its key.

- **Fix 7 (Phase 3 click crash guard)**: Tab 3 Inputs sub-tab no longer crashes with TypeError when the user clicks a phase with zero visible assets. Guards added at every downstream `activeAsset` dereference (`assetPhase`, `assetLines`, `assetBreakdown`, `assetMetrics`). The empty-phase render block (P8-Fix 3) was already in place; only the data-derivation lines above it were unguarded.

- **No migration**: every fix is in display / calc layer or input validation; no schema change, no banner.

- **Verifier**: `scripts/verify-m20costsCleanup-pass9.ts` 37 pass / 0 fail / 0 skip across 10 sections.

Commits (9): `56bdff4` (mandatory diagnostic) - `d107937` (Fix 8) - `9872a8e` (Fix 1) - `aeffe46` (Fix 2) - `037b5c5` (Fix 3) - `1434571` (Fix 4) - `30e31f3` (Fix 5) - `72a56e7` (Fix 6) - `8abb129` (Fix 7) - closure (verifier + CLAUDE.md). Type-check clean on every commit.

## Module 1 status (2026-05-12, **M2.0 Costs Cleanup Pass 8**)

**M2.0 Pass 8 (ships):** 8 targeted Costs cleanup fixes following Pass 7 verification. Schema stays v8 additive (`projectNdaScope` + `asset.subUnitMetric / assetRoadsPct / assetParksPct / assetNdaEnabled` + `resultsViewMode / resultsSelectedAssetId` added; `CostLine.costCategory / costDriver` and `SubUnit.metric` deprecated on schema).

- **Fix 1, NDA placement + scope toggle**: Tab 1 NDA card removed. Tab 2 Assets & Sub-units card lives below the Land Parcels totals row (light-amber background). New scope toggle (`Project-level` / `Per-Asset`): Project mode shows single Roads % + Parks % inputs + Gross / Net derivation; Per-Asset mode disables project-level inputs and surfaces Apply Roads/Parks + Roads % + Parks % on each asset card. Land COST always stays on gross land; NDA only reduces developable area consumed by `rate_per_nda` / capacity calcs.

- **Fix 2, sub-unit UX (3 sub-fixes)**:
  - 2a: Units mode = Area + Unit Size as inputs; Count is read-only derived (`Count = Area / Unit Size`). Editing Area back-calcs count; editing Unit Size preserves displayed Area.
  - 2b: Count header swaps to dynamic label (Units / Keys / Beds / Bays / Tenants) per dominant revenue sub-unit category + strategy + type via `countUnitLabel`.
  - 2c: `Asset.subUnitMetric` becomes the single source of truth per asset; per-row Metric dropdown column removed; asset-level Area / Units radio toggle above the sub-unit table converts all sub-units when switched (refuses with warning when any row would lose non-zero area via `canSwitchMetric`).

- **Fix 3, top-right phase dropdown**: removed from Tab 3 page header (Phase Filter inside Inputs sub-tab is sole navigation). Empty phase renders a helpful message + keeps Phase Filter active so the user can switch phases.

- **Fix 4, drop Category + Driver**: cost line table 11 cols -> 9 (Cost Line / Method / Value / Start / End / Phasing / Total / Toggle / Delete). Pass 5's Direct vs Allocated + driver split dropped from UI per user feedback; every cost line is per-asset (Pass 7 architecture). `CostLine.costCategory` + `costDriver` retained on schema for back-compat; calc engine treats every line as Direct. CostRow sub-rows use `colSpan={9}`; AssetCostSection tfoot Asset Subtotal label spans cols 1-6.

- **Fix 5, Start/End defaults**: new cost lines default `startPeriod=0`, `endPeriod=maxCp+1` where `maxCp = max(phase.constructionPeriods)`. Migration clamps legacy lines whose `endPeriod` exceeds `maxCp + 1` (e.g. legacy snapshot with hardcoded End=24 on a 4-period project now lands at 5).

- **Fix 6, %-of-selected picker visibility**: `PercentOfSelectedPicker` sub-row `<td colSpan>` synced from stale 11 to 9 (Pass 8's 9-col table). The picker contents (button + popover + chip strip) were intact from Pass 6 Fix 6; only the wrapping row's column span was wrong, causing the picker to render misaligned and occasionally clipped.

- **Fix 7, Phase filter no "All Phases"**: Tab 3 Phase Filter drops the `'__all__'` sentinel. Default = first phase with at least one visible asset (else first phase). Inputs sub-tab matches Pass 7 one-asset-at-a-time semantics; combined-across-phases view stays in Results (P8-Fix 8).

- **Fix 8, Results Combined / Single Asset toggle**: explicit radio toggle at the top of Results sub-tab (replaces the M2.0L filter pill bar). Single Asset surfaces an asset picker dropdown beside the radio. State persists via `Project.resultsViewMode` + `resultsSelectedAssetId` so the view survives reload. `SummaryTables` rekey on view+asset change so the per-period tables refresh immediately.

- **Migration**: `migrateM20costsPass8` is idempotent; runs in all 3 hydrate chains (`stripV8Wrapper` / `stripWrapper` / `migrateLegacyToV8`). Stamps `projectNdaScope='project'` when `projectNdaEnabled=true` and scope undefined; backfills `asset.subUnitMetric` from the first sub-unit's metric; clamps `costLine.endPeriod` to `maxCp+1`; defaults `project.resultsViewMode='combined'`. `M20_PASS8_NOTICE` banner surfaces once on first hydrate. `resolveBanner` prioritizes Pass 8 ahead of Pass 3 / Pass 7.

- **Verifier**: `scripts/verify-m20costsCleanup-pass8.ts` 41 pass / 0 fail / 0 skip across 10 sections.

Commits (10): `ae02b6f` (design note) - `31a3712` (Fix 1) - `7873107` (Fix 2) - `9cdd579` (Fix 4) - `f69c7bd` (Fix 5) - `3ebb9f1` (Fix 6) - `fb3dd91` (Fix 7) - `7831538` (Fix 3) - `8bc9c02` (Fix 8) - closure (migration + verifier + CLAUDE.md). Type-check clean on every commit.

## Module 1 status (2026-05-12, **M2.0M Pass 4 Tab 4 Financing cleanup**)

**M2.0M Pass 4 (ships):** 10 fixes + mandatory diagnostic after Pass 3 verification revealed Tab 4 was rendering zero despite unit-tested hooks. Schema stays v8 additive (`assetFilter` added to `ProjectFinancingConfig`).

- **Mandatory diagnostic** at `docs/m20M-pass4-diagnostic.md` (commit first). Root cause: UI never called `createFinancingHooks` (hook contract was documented but unconsumed); `computeCapitalStack` read deprecated `tranche.ltvPct` + `tranche.principal` that Pass 3 hid from UI; Pass 3 migration cleared `equityContributions[]` but stack still walked them. Three intertwined bugs combined to render zero across all schedules.

- **Fix 10 (force fix zero-rendering)**: route `computeFunding` through `inputsSummary.totals` (project-wide capex aggregate across ALL phases). Bypass `computeCapitalStack` entirely; derive stack directly from `funding + equity`. `phaseTranches` debt breakdown uses `tranche.facilitySharePct`. MAAD-shape fixture (1 phase, 1 asset, BUA 130874, rate 4500) now renders 588.9M in Capital Structure Overview Total Funding card.

- **Fix 9 (assetFilter replaces phaseFilter)**: new `Project.financing.assetFilter?: string` (sentinel `__combined__` = all assets). Top-of-Tab-4 dropdown rebuilt as Asset Filter (`data-testid="financing-asset-filter"`); options = Combined + per-asset (visible only). `phaseFilter` retained on schema for back-compat (no longer rendered).

- **Fix 6 (universal accounting format)**: new `formatAccounting` helper in `src/core/formatters/index.ts`. Contract: zero -> `"-"` (en-dash), negative -> `(1,234)` (parentheses), null / undefined -> `""` (blank), positive -> `1,234,567` (scaled, no K/M suffix). Page header line keeps the scale indicator. Applied across Module1Financing (3 sites) + Module1Costs Results.

- **Fix 1 (Method 2 line-item table)**: `renderMethodInputs(id=2)` replaces the "next sub-pass" placeholder with a real editable table. Rows = unique cost-line `baseId`s (composed `${baseId}__${phaseId}__${assetId}` deduped via `deriveLineBaseId`). Each row: Cost Line label + Debt % editable input + Equity % auto-derived (100 - debtPct). Writes to `financingConfig.lineItemRatios.master[]` keyed by baseId.

- **Fix 2 (Funding Basis block)**: new card `data-testid="financing-funding-basis"` between Funding Method radio and Land Funding section. 4 read-only fields: Method (active method label), Drawdown Basis (per-method source math description), Total Capex (excl Land In-Kind), Total Funding Need.

- **Fix 3 (Capital Structure Overview content)**: leads with Total Funding as headline KPI; splits Sources (Total Debt + Equity Cash + Equity In-Kind sub-cards) and Uses (Total Capex + LTV + Sources-vs-Uses chip) into clearly labelled blocks. New data-testids: `cap-stack-total-funding`, `cap-stack-equity-cash`, `cap-stack-equity-inkind`; dropped: `cap-stack-equity`, `cap-stack-sources`.

- **Fix 4 (compact field layout)**: TrancheCard inputs and outputs reflow from 4-per-row to 2-per-row grids. Tenor / Availability pair, Grace / Repayment pair; output cards (Total Debt Drawn / Total Interest / Total Repayment / Periodic Rate) reflow 4x1 to 2x2.

- **Fix 5 (drawdown periods only + Total row label)**: Inputs Summary Tables drop period columns where the funding total = 0 (operations periods stay hidden). Active period set derived once from `totalsRow` and shared across all 3 sub-tables. Bottom row label changed from `"TOTAL Total Funding Required"` to just `"Total"`. Total row styling kept: grey-pale fill + bold weight.

- **Fix 7 (Schedules restructure)**: drop standalone Drawdown schedule; replace Repayment with Debt Movement per facility (Opening Balance + Drawdown + Interest Capitalized + Principal Repaid + Closing Balance, ledger-style); add Finance Cost per facility (Interest Accrued + Interest Paid + IDC Capitalized + Expensed Interest = dual P&L vs cash tracking M5 will consume). Renumber: 1 Capital Stack Summary, 2 Debt Movement, 3 Combined Debt Service, 4 Finance Cost, 5 IDC Summary, 6 Equity Movement, 7 Capital Stack Movement.

- **Fix 8 (Equity Movement)**: replace Equity Schedule with Equity Movement (Opening Equity + Cash Contributions + In-Kind Contributions + Closing Equity). Mirrors Debt Movement shape for visual symmetry.

- **Migration**: `migrateM20mPass4Financing` (idempotent) stamps `assetFilter = '__combined__'` on any snapshot whose `project.financing.assetFilter` is undefined. Banner `M20M_PASS4_NOTICE` takes priority in `resolveBanner` cascade ahead of Pass 3 / earlier banners.

- **Verifier**: `scripts/verify-m20M-pass4.ts` 61 pass / 0 fail / 0 skip across 12 sections.

Commits (10): `d370b64` - `b297594` - `1404bc1` - `34326fa` - `465f041` - `23bdba4` - `9c36ec7` - `2b912f7` - `8f96e25` - `35a6c92` - closure. Type-check clean on every commit.

## Module 1 status (2026-05-12, **M2.0M Pass 3 Tab 4 Financing cleanup**)

**M2.0M Pass 3 (ships, superseded by Pass 4):** 10 targeted Tab 4 fixes simplifying the financing surface. Schema stays v8 additive (`facilitySharePct` + `scope` re-exposed on `FinancingTranche`; all deprecations keep their fields for back-compat).

- **Fix 1, drop Single Asset toggle**: Tab 4 Inputs always operates on Combined Project basis. The Combined / Single Asset toggle is removed; `viewMode` field stays on schema. Migration flips legacy `viewMode='single_asset'` to `'combined'` and clears `selectedAssetId`.

- **Fix 2, capex hook audit**: `getCapexExclLandInKind` (and siblings) verified to read per-asset cost lines correctly post Pass 7. Added new hooks `getCapexSchedule(assetId?)` (per-asset capex series) and `getLandCashValue()` (parcels' total cash share). MAAD-shape fixture (130,874 BUA x SAR 4,500/BUA) sums to SAR 588,933,000 as expected.

- **Fix 3, facility ratio inherits**: per-facility Debt % + Principal inputs dropped from `TrancheCard`. Facility principal auto-derives from chosen funding method. New optional `FinancingTranche.facilitySharePct` (0..100, sums to 100% across facilities in the same scope) surfaces when `facilityCount > 1`; single facility defaults to 100. Migration defaults missing multi-facility shares to even split.

- **Fix 4, re-add asset scope**: `FinancingTranche.scope: 'project' | 'phase' | 'asset'` re-exposed on schema + UI dropdown. Asset-specific opens an asset picker; phase-specific opens a phase picker. Pass 2 hid the asset option; Pass 3 restores it.

- **Fix 5, drop drawdown method dropdown**: per-facility drawdown method picker + its conditional inputs removed. Drawdown timing auto-derives from chosen funding method. `drawdownMethod` + related fields stay on schema for back-compat.

- **Fix 6, simplify repayment**: Equal Total / Equal Principal sub-method dropdown removed. Equal Repayment defaults to equal_principal (declining balance). Cash Sweep drops the sweep ratio input; defaults to 100% of excess cash above project minimum cash reserve.

- **Fix 7, drop Equity Tranches section**: entire Equity Tranches table removed from Inputs. Equity auto-computes: `Total Equity Need = Total Funding x equity%`, `Cash Equity = Total Equity - Land In-Kind value`. Land In-Kind auto-detects from Tab 3 Land In-Kind cost lines via existing `computeEquity` helper. `equityContributions[]` stays on schema; migration clears stale data.

- **Fix 8, Inputs Summary Tables**: 3 stacked tables at bottom of Inputs sub-tab. Each renders per-asset rows (project-wide, all phases) x project periods, Total in 2nd position.
  - Total Funding Required = per-asset capex per period (excl Land In-Kind, sums to project Total Funding).
  - Total Debt Required = Funding x debt% from method.
  - Total Equity Required = Funding x equity%, with Cash + In-Kind sub-rows under the Total row.

- **Fix 9, Schedules math + All Phases aggregation**: closing balance formula verified: `Closing = Opening + Drawdown + IDC Capitalized - Principal Repaid`. `phaseFilter='__all__'` now walks ALL facilities project-wide; each facility computes against its OWN phase's capex via `computePhaseCost`.

- **Fix 10, Auto-IDC integration**: `applyIdcToCapex` continues to emit `AutoIdcCostLineSeed` entries keyed by `targetAssetId` for every funded asset under a Capitalize-treatment facility. Tab 3 per-asset cost line table renders the locked `auto-idc__*` rows.

- **Migration**: `migrateM20mPass3Financing` is idempotent. `M20M_PASS3_NOTICE` banner surfaces once on first hydrate.

- **Verifier**: `scripts/verify-m20M-pass3.ts` 42 pass / 0 fail / 0 skip across 12 sections.

Commits (10): `9778a55` - `dd9eee8` - `72777d6` - `0db5f27` - `4148464` - `ad0f296` - `037c45e` - `dfa31a9` - `2af13ab` - final commit. Type-check clean on every commit.

## Module 1 status (2026-05-12, **M2.0M Pass 7 Costs Architecture Simplification**)

**M2.0M Pass 7 (ships):** Drops the Pass 4 master + replica inheritance surface entirely. Tab 3 Inputs is now per-asset only: phase filter + asset pill bar + single editable table for the selected asset. CostOverride[] deprecated (schema retained for legacy snapshot compat; migration flattens the data, UI no longer reads or writes). Schema stays v8 additive.

- **Fix 5 (architecture rewrite)**: every `CostLine` carries required `targetAssetId`; composed id pattern `${baseId}__${phaseId}__${assetId}` for global uniqueness. `migrateM20costsPass7PerAsset` walks legacy snapshots, replicates each master line per visible phase asset (folds matching CostOverride values onto each replica per the same field-by-field resolution as Pass 4), drops orphan per-asset lines whose `targetAssetId` no longer exists, drops master lines in phases with zero visible assets, rewrites `selectedLineIds` cross-references to point at same-asset replicas, clears `costOverrides[]`. Idempotent on every hydrate. `M20COSTS_PASS7_NOTICE` banner surfaces once per migrated snapshot.

- **Fix 5b/6 (Inputs UI)**: phase filter dropdown (`costs-inputs-phase-filter`) + asset pill bar (`costs-inputs-asset-pills`) + per-asset stats summary (`costs-inputs-asset-stats-{id}`) + single `AssetCostSection` for the active asset. Add Custom Cost button emits a line with `id: custom-${Date.now()}__${phaseId}__${assetId}`, `targetAssetId` set, `costCategory: 'direct'`.

- **Fix 1 (Tab 2 NDA)**: per-parcel `NDA?` + `Roads %` + `Parks %` + `NDA (sqm)` + `{currency}/NDA sqm` columns removed from the parcels table. New project-level NDA summary card lives below the Total Land row: Apply NDA Deduction toggle + Roads % + Parks % inputs + explicit derivation.

- **Fix 2 (sub-unit verification)**: `AssetAreaReconciliationBlock` rewritten to a single inline line: `Verification: BUA X | NSA X | Eff X% | Land X | Land Cost X`. expand/collapse + localStorage state dropped. Mismatch state (sub-units exist with Support/Parking but NSA = 0) surfaces ⚠ + caveat suffix.

- **Fix 3 (sub-units table)**: explicit colgroup with `table-layout: fixed`. All columns always render. Area cell: Area mode keeps the editable input; Units mode renders a read-only derived caption. Unit Size + Count cells render muted dashes in Area mode and editable inputs in Units mode. New Total Revenue (No Indexation) column = `metricValue x unitPrice` (Area: area x rate; Units: count x rate); read-only via `formatScaled`.

- **Fix 4 (Costs Input table)**: `table-layout: fixed` + explicit colgroup per brief: Cost Line 220 · Method 200 · Category 100 · Driver 100 · Value 120 · Start 60 · End 60 · Phasing 100 · Total 140 · Toggle 60 · Delete 40. Category + Driver dropdowns split from the Method cell into their own columns; Driver cell renders a muted dash when `costCategory='direct'`. Toggle column = On/Off checkbox + optional reset; Delete column = ✕ button with confirm dialog. CostRow sub-rows span `colSpan={11}`. AssetCostSection tfoot Asset Subtotal label spans cols 1-8.

- **Fix 7 (Results)**: no changes per brief.

- **Verifier**: `scripts/verify-m20costsCleanup-pass7.ts` (52 pass / 0 fail / 2 skip without dev server).

- **Deferred per brief**: dedicated Project Common Costs section above asset pills. Results sub-tab tweaks.

Commits (7): `b93ffbd` (design note) · `64583b3` · `384b9e4` · `00e7a72` · `80b8f1b` · `528703f` · `16eb88b`. Type-check clean on every commit.

## Module 1 status (2026-05-11, **M2.0M Pass 2 Tab 4 Financing cleanup**)

**M2.0M Pass 2 (ships):** 13 Tab 4 cleanup fixes simplifying the financing surface. Schema stays v8 additive (`minimumCashReserve` + `phaseFilter` lift to project.financing top level; new repayment sub-mode + cash-sweep config on FinancingTranche).

- **Fix 1, uniform funding pipeline.** New `computeFunding(method, ctx)` returns `{ totalNeed, periodArray, debtEquitySplit }` for every method. Step 1 (totalNeed + periodArray) is method-specific: Methods 1+2 = sum/distribute capex; Method 3 = net of pre-sales + OCF + existingCash + minCash; Method 4 = period-by-period walk filling to minCash floor. Steps 2-3 (ratio split, debt+equity per period) are uniform.

- **Fix 2, LTV -> Debt %.** TrancheCard input label + placeholder switched to "Debt %". Schema field stays `tranche.ltvPct`. LTV Covenant input + Capital Stack output ratio (real banker terms) preserved.

- **Fix 3, facility type dropdown hidden.** UI removes the `senior_construction / mezzanine / bridge / ...` dropdown. Schema field retained; new facilities default `senior_construction`.

- **Fix 4, MAAD refs dropped.** Drawdown label `'Cash-Available Basis (MAAD)' -> 'Cash-Available Basis'`.

- **Fix 5, repayment methods reduced to 3.** New `RepaymentMethod` user-facing values: `equal_repayment` (sub-mode: `equal_total` annuity or `equal_principal` declining), `year_on_year_pct` (per-period %), `cash_sweep`. Legacy 9-value type kept on schema; `migrateM20mPass2Financing` maps legacy values:
  - `straight_line -> equal_repayment + equal_principal`
  - `equal_periodic_amortization -> equal_repayment + equal_total`
  - `cashsweep_* -> cash_sweep`
  - `bullet -> equal_repayment` (tenor=1) `+ equal_total`
  - `balloon -> year_on_year_pct`
  - `manual -> year_on_year_pct`
  - `custom_schedule -> year_on_year_pct`

- **Fix 6, minimumCashReserve at project level.** `Project.financing.minimumCashReserve` is now the canonical cash floor across all 4 methods and the cash-sweep repayment.

- **Fix 7, IDC treatment 2 options.** Dropdown reduced to Capitalize / Expense. Mixed retained on schema for back-compat; migration folds `idcTreatment='mixed' -> 'capitalize'`.

- **Fix 8, asset scope dropdown removed.** Per-facility per-asset narrowing dropdown gone. Migration converts any `scope='asset'` to `scope='phase'` using the parent phase of `scopeId`/`assetId`.

- **Fix 9, Financing cells use `formatScaledForExport`.** Both the TrancheCard schedule cells and the root component's schedule cells drop the K/M suffix per cell.

- **Fix 10, Phase Filter "All Phases".** New `project.financing.phaseFilter` (sentinel `'__all__'` default). Schedules aggregate across phases when filter is `'__all__'`.

- **Fix 11, equity surfaced.** New `computeEquity(financing, fundingResult, landInKindValue)` returns `{ totalEquityNeed, inKindContribution, cashContribution, cashPerPeriod, inKindPerPeriod, openingPerPeriod, closingPerPeriod }`. Cash equity timing mirrors debt drawdown timing; in-kind lumps at period 0.

- **Fix 12, Total column 2nd position.** `ScheduleTable` accepts `total?: number | string` per row. Header now has a Total <th> in 2nd position; flow rows pass `total: <sum-fmt-string>`; balance rows pass `total: '-'`.

- **Fix 13, auto IDC cost line preserved.** `applyIdcToCapex` at `src/core/calculations/index.ts:1764-1767` skips on `treatment === 'expense'` only.

- **Verifier**: `scripts/verify-m20M-pass2.ts` 50 pass / 0 fail.

## Module 1 status (2026-05-11, **M2.0M Pass 6 Costs cleanup**)

**M2.0M Pass 6 (ships):** 9 targeted Costs fixes layered on M2.0M. Schema stays v8 additive (`Project.projectParksPct?` + `Project.projectNdaEnabled?` are the only new fields).

- **Fix 1, dynamic count caption (Tab 2 sub-units).** New `countUnitLabel(category, strategy, assetType)` helper renders a small caption beneath each Count cell adapting to context: Sellable -> "units", Operable + Operate -> "keys", Operable + healthcare-tagged type -> "beds", Leasable -> "tenants", Support -> "items".

- **Fix 2, default Display Scale + Decimals.** `makeDefaultProject()` seeds `displayScale='thousands'` + `displayDecimals=0`. New `migrateM20mPass6DisplayDefaults` ONLY flips snapshots that carry the exact pre-Pass-6 default combo (`full` + 2) -> (`thousands` + 0). Any explicit user customisation preserved verbatim.

- **Fix 3, project-level Roads/Parks NDA.** New `Project.projectNdaEnabled` + `projectParksPct`. Calc engine `resolveAssetAreaMetrics` reads project-level first: when `projectNdaEnabled=true`, applies `(projectRoadsPct + projectParksPct)` uniformly to phase land area; per-parcel `hasNdaDeduction` is ignored. `migrateM20mPass6NdaToProject` rolls up legacy per-parcel toggles into the project-level fields via area-weighted average.

- **Fix 4, Method column width.** Master cost table uses `tableLayout='fixed'` with `<colgroup>` widths; Method column capped at 200px.

- **Fix 5, Land cost derivation captions.** `costLineCaption` rewrites for `percent_of_cash_land` / `percent_of_inkind_land` / `percent_of_total_land`. Healthy path: `"{landSqm} sqm x {cashLandValue/landSqm}/sqm (cash) = {total}"`. Pointed warnings on zero-land, zero-rate, zero cashPct edge case.

- **Fix 6, `PercentOfSelectedPicker` dropdown.** Replaces the inline checkbox grid with a compact dropdown button `"Select lines (X selected)"`.

- **Fix 7, Locked-line override block.** Per-asset replica rows for any line with `isLocked=true` (Land Cash / Land In-Kind / Auto-IDC) render a non-interactive "Locked" chip instead of the Override button.

- **Fix 8, Period column reducer.** Replaces the legacy `constructionStart - 1 + cp` reducer with a phaseStartYear-aware reducer: `Math.max(offset + cp)` where `offset = phaseStartYear - projectStartYear`.

- **Fix 9, Plain numbers in Results cells.** `SummaryTables fmt` switches from `formatScaled` to `formatScaledForExport`, dropping the K / M suffix per cell.

- **Verifier**: `scripts/verify-m20costsCleanup.ts` 36 pass / 0 fail across 9 sections.

## Module 1 status (2026-05-11, **M2.0M Financing definitive rewrite**)

**M2.0M (ships):** Tab 4 Financing becomes the "funding layer." Routes upstream data through parameter-named hooks instead of hard-wiring against module names, so when Revenue / OpEx / Cash Flow engines ship later, hook implementations flip from zero-stubs to real values and consumer code does NOT change. Schema stays v8 additive.

- **Hook layer** at `src/hubs/modeling/platforms/refm/lib/financing-hooks.ts` exposes `FinancingDataHooks`: `getCapexExclLandInKind` / `getCapexInclLandInKind` / `getCapexExclTotalLand` / `getLandInKindValue` aggregate `AssetCostBreakdown` via `costLineProjectPeriodIndex` (memoised); `getPreSalesCollections` / `getOperatingCashFlow` / `getDepreciationSchedule` / `getRevenueSchedule` / `getOperatingExpenses` return zero-stubs until upstream engines land; `getClosingCashBalance(prevPeriod)` walks a local cash simulation. `createNoopHooks(totalPeriods)` helper for component tests. Hook names are STABLE; future engines populate them, never rename them. Full contract in `docs/financing-hooks.md`.

- **Schema additions** (all optional, v8 additive): `Project.financing?: ProjectFinancingConfig` carries `fundingMethod: 1|2|3|4`, per-method config, `parcelFunding: ParcelFundingConfig[]`, `viewMode: 'combined'|'single_asset'`, optional `selectedAssetId`. New enums: `FundingMethodId`, `ParcelFundingType` (5 values: `100pct_equity` / `100pct_debt` / `custom_split` / `in_kind` / `deferred_payment`), `FundingViewMode`. `CostOverride` gains `debtPctOverride` + `equityPctOverride` for Method 2 per-asset ratio overrides.

- **Funding methods**:
  - **Method 1, Fixed Ratio**: single global `debtPct/equityPct` applied to `getCapexExclLandInKind()`. Drawdown follows capex schedule × debt%.
  - **Method 2, Line-Item Based**: each cost line carries its own debt% / equity% in a master template; per-asset override via Pass 4 inheritance.
  - **Method 3, Net Funding Requirement**: `capex - pre-sales - operating CF - existing cash`, then split by ratio.
  - **Method 4, Cash Deficit Funding**: period-by-period. When `getClosingCashBalance(t-1) < minimumCashReserve`, draw debt + equity per ratio to fill the gap.

- **Land special treatment** (per parcel, separate from the 4 methods): default `100pct_equity`. `100pct_debt` rare; landowner in-kind auto-detected from Tab 3 `land-inkind` cost line; deferred payment carries its own start/end + phasing.

- **Migration**: `migrateM20MFinancing` (idempotent) stamps a Method-1 / 70-30 / combined-view wrapper on any snapshot whose `project.financing` is undefined. Banner `M20M_FINANCING_NOTICE`. `makeDefaultProject` seeds the wrapper on fresh projects.

- **UI** at top of Tab 4 Inputs sub-tab adds 3 cards above Capital Structure: (1) View toggle, (2) Funding Method radio with 4 options + per-method input panel (`renderMethodInputs`); (3) Land Funding per parcel with type dropdown.

- **Deferred per brief** (acceptable): Methods 2-4 full calc-engine wiring; Real `getClosingCashBalance` from M3 Cash Flow engine; Cash sweep based on real OCF; Playwright spec; DSCR / LTV covenant breach alerts (M5 dependency).

- **Verifier**: `scripts/verify-m20M.ts` 67 pass / 0 fail / 0 skip across 7 sections.

## Module 1 status (2026-05-11, **M2.0L + 4-fix follow-up**)

**M2.0L follow-up (ships):** Four targeted fixes layered on top of M2.0L. Schema stays v8 additive (`Project.costInputMode?` is the only new field).

- **Fix 1, graceful legacy-project migration**: `module1-migrate.ts` adds `isLooseSnapshot()` and `migrateLegacyToV8()` that backfills every missing optional field per M2.0g/h/i/j/L additions, renames legacy `'Hybrid'` strategy to `'Sell + Manage'`, remaps v6 cost-line ids (`site-prep` / `structural` / `mep` / etc.) to closest v7 standards, then pipes through the full v7→v8 chain. Replaces the previous hard-error path. Banner uses new `LEGACY_MIGRATION_NOTICE` constant: `"Project updated to latest schema, please verify your inputs."`

- **Fix 2, Cost Input Mode (Same / Individual)**: New `Project.costInputMode?: 'same' | 'individual'` field. `CostInputModeModal` opens on first Tab 3 visit when undefined. Toggle button stays at top of Tab 3 for later switches. Same mode renders one `SameModeCostTable` per phase. Individual→Same switch with active overrides surfaces a confirm dialog. **NOTE: Pass 7 later deprecated `costInputMode`** — stripped on hydrate; inheritance surface always renders both views (see Pass 7 status above).

- **Fix 3, sub-unit metric UX cleanup**: Tab 2 sub-unit table now hides cells per metric. Area mode renders Unit Size + Count as muted dashes. Units mode renders Area as a read-only caption.

- **Fix 4, cost multiplier asset-area fallback**: `resolveAssetAreaMetrics` in `src/core/calculations/index.ts` now falls back to `asset.buaSqm` / `asset.sellableBuaSqm` when sub-units are empty. `gfa` cascades through `asset.gfaSqm → hierarchy.gfa → bua`. `costLineCaption` emits `"<rate> x - (no <X> defined yet) = 0"` warning when the relevant metric is 0.

Commits (4): `60128b1` · `db7e578` · `62b843a` · `47d6f08`. Type-check clean on every commit.

## Module 1 status (2026-05-11, **M2.0L Costs diagnose-and-fix + full Financing build**)

**M2.0L (ships):** Closes the cost-line duplication bug after M2.0j, then expands Tab 4 Financing from a single-tab tranche editor into a full multi-facility platform with capital-stack overview, schedules sub-tab, and cross-tab IDC sync. Schema stays v8 (every new field is additive optional).

- **Cost duplication root cause** was `makeDefaultCostLines(phaseId)` emitting hardcoded ids ('land-cash', etc.) per phase, producing duplicate ids across phases that propagated via the store's `c.id === id` matchers and made the Results filter walk all 20 lines per asset. Fix composes `${baseId}__${phaseId}` at create time. `composeLineId` / `deriveLineBaseId` / `isStandardCostLineBaseId` helpers in `module1-types.ts`. `deriveCostStage` strips the suffix before stage lookup; legacy bare ids still resolve. `migrateM20lDedupeCostLineIds` runs in stripWrapper/stripV8Wrapper to retrofit legacy duplicate-id snapshots + rewrite `selectedLineIds` + `costOverrides.lineId`. Refresh: `scripts/baselines/module1-v5.json` (47.8 KB → 48.4 KB).

- **Sub-unit metric round-trip** when `unitArea=0` previously zeroed out area on switch to Units. New `canSwitchMetric` guard refuses the switch when it would destroy non-zero area, with inline warning.

- **Costs UX additions**: live currency-chip strip below Manual % inputs; always-visible per-row period chip strip below every active cost line; `PercentOfSelectedPicker` sub-row with scrollable sibling-line checkboxes when method = `percent_of_selected`; Results-sub-tab filter pill bar (Combined + per-asset) with clean remount on change.

- **Financing schema additions** (all optional, v8 stays): drawdown methods widen 5 → 9 (`+ front_loaded` `+ equal_periodic` `+ custom_schedule` `+ cash_available`); repayment methods widen 5 → 9 (`+ equal_periodic_amortization` annuity / `+ bullet` / `+ balloon` / `+ custom_schedule`). New enums: `FacilityType`, `InterestRateType`, `BaseRate` (SAIBOR 1/3/6M / SOFR / EIBOR), `IDCTreatment`, `FeeTreatment`, `EquityTrancheType`. `FinancingTranche` gains: `facilityType`, `lender`, `principal` (absolute, overrides ltvPct), `interestRateType`+`baseRate`+`spreadBps`, `tenorPeriods`+`availabilityPeriods`+`gracePeriods`, fee fields, `dscrCovenant`+`ltvCovenant`, `idcTreatment`, `idcMixedSplitPeriod`, `balloonPct`, `sweepRatio`, `prepayments[]`, `pikEnabled`, `autoGenerateIdcCostLine`, `drawdownCustomSchedule`, `repaymentCustomSchedule`. `EquityContribution` gains: `type`, `source`, `scope`+`scopeId`, `assetId`, `irrHurdle`, `preferredReturn`, `autoDetectedFromCostLine`+`sourceCostLineId`.

- **Financing calc engine**: `computeEqualPeriodicPayment` (annuity PMT with 0-rate edge case), `computeCapitalStack`, `computeIdcSummary`, `applyIdcToCapex` (generates `AutoIdcCostLineSeed[]` for cross-tab integration), `computeCombinedDebtService`.

- **Financing UI**: two sub-tabs (Inputs + Schedules). Inputs has Capital Structure Overview cards + Debt Facilities section with TrancheCard + Equity Tranches table. Schedules has granularity toggle (annual / quarterly / monthly), filter pill bar, and 6 tables (Capital Stack Summary / Drawdown per facility / Repayment per facility / Combined Debt Service / IDC Summary / Capital Stack Movement).

- **Cross-tab integration**: `useEffect` in Module1Financing watches phase + tranches + resultsMap, calls `applyIdcToCapex`, then materialises each seed as a read-only cost line in Tab 3 (id = `auto-idc__${facilityId}__${assetId}`, `isLocked: true`, `name: "Auto: IDC from ${facility.name}"`). Second effect syncs `equity-auto-inkind-${phaseId}` to total Land In-Kind value across phase assets.

- **Deferred per brief**: DSCR breach alerts (Module 5 dependency), equity waterfall + IRR hurdle math (Module 4), cash-sweep with full operating cashflow, Sharia Murabaha/Ijara notes, multi-currency facilities, refinancing flows.

- **Verifier + Playwright**: `scripts/verify-m20L.ts` (74 pass / 0 fail / 2 skip without dev server). `tests/e2e/m20L-costs-financing.spec.ts` (10 specs + dark-mode).

---

## Module 1 Conventions (v8 + M2.0L contract, applies to all downstream modules)

> Single source of truth for Module 1 patterns and downstream-module obligations. Replaces the per-phase "pattern decisions" sections that ran M2.0 → M2.0L. Archived per-phase narrative lives in CLAUDE-FEATURES.md under "Module 1 (REFM) M2.0 Phase History".

**Schema + migrations**
- **Hard-cut on every schema bump.** Pre-vN snapshots flag with explicit error rather than silent coercion. v3/v4 → v5, v5 → v6, v6 → v7, v7 → v8 all follow this policy. Non-version-bumping additive fields (M2.0f, M2.0h, M2.0i, M2.0j, M2.0L) default off/undefined for legacy snapshots.
- **Phase-scoped cost line ids (M2.0L).** Standard catalog ids compose as `${baseId}__${phaseId}` to keep them globally unique across multi-phase projects. Use `composeLineId` / `deriveLineBaseId` / `isStandardCostLineBaseId` from `module1-types.ts`. Calc engine helpers that key by line id (e.g., `deriveCostStage`, `selectedLineIds` resolution) strip the suffix before lookup. Custom user lines (`custom-${timestamp}`) are already unique. `migrateM20lDedupeCostLineIds` retrofits legacy duplicate-id snapshots on hydrate.
- **Migration banner pattern.** `CheckedHydration.migrationNotice` → `AttachResult.migrationNotice` → dismissable banner once per project open. Migration helper kicks an immediate save so banner doesn't reappear.
- **Snapshot baseline: ONE file per major schema version** at `scripts/baselines/module1-v5.json` (now v8 content, name retained).

**Timing**
- **Phase.startDate is authoritative.** Tab 1 + Tab 2 read `computePhaseTimeline(phase, project)`. M5 Statements + M3 Cashflow consume same helper for column dates.
- **`constructionPeriods === 0` is canonical for operational phases.** computePhaseTimeline returns `operationsStart === phase.startDate` when cp=0. Asset.status='operational' on cp=0 phases gets historical baseline treatment.
- **End-of-period dates everywhere.** Use `periodEndDate`; never display "Jan 1 of next year" as period end.
- **`ProjectTimeline.endYear` is inclusive.** No +1 offset in display layers.
- **Period dates align to PHASE start.** Cost / revenue / opex / financing schedules all measure from `phase.startDate`. Project-wide rollup tables offset by `(phaseStartYear - projectStartYear)` to place phase Y1 in project Y2 / Y3 correctly.

**Status + lifecycle**
- **Phase + Asset status drives lifecycle treatment.** `'planning' / 'construction' / 'operational'`. Operational reveals `historicalBaseline` (sunk capex / equity / debt / accumulated dep / trailing revenue + opex). M5 reads `computePhaseHistorical(phase)` for opening balances + `computeOperationalRunRate(baseline, period)` for rollforward.
- **Status pill colors:** planned = grey, construction = warm amber, operational = green-success. M5 + M3 reuse same scale.
- **Asset.type is optional.** Treat `''` as unspecified. Useful Life falls back to category default (`DEFAULT_USEFUL_LIFE_YEARS`: residential 30 / hospitality 20 / retail 25 / default 25).

**Inputs + outputs**
- **Inputs are annual; outputs flex.** No user-visible "model granularity" toggle. Every Module 1 input is annual. Display uses `distributeAnnualToPeriods(annualValues, granularity, phasing)` with sum-integrity guarantee. M2.1 / M3 / M5 adopt same convention.
- **`project.outputGranularity` is the project-wide view setting.** Tab 3 / Tab 4 / future M5 all read it.
- **Phasing is Even + Manual % only.** Read-side accepts legacy `frontloaded` / `backloaded` / `sCurve` / `phase_aligned` via `migrateM20jPhasing`. Manual % UX: per-period inputs + sum indicator + auto-normalize button.

**Display + formatting**
- **Project-scoped formatting.** `project.displayScale` (full/thousands/millions) + `project.displayDecimals` (0..3). Use `formatScaled(num, scale, decimals)` or `makeProjectFormatter(project)`. Cells render pure numbers (no currency suffix).
- **Currency lives in the per-tab header line** via `currencyHeaderLine(currency, scale)` → "All figures in SAR" / "...SAR '000" / "...SAR M".
- **Percentages always 2 decimals** via `formatPercent` default. **Areas (sqm) use `formatArea`** (no scale conversion). **Integer counts bypass scale via `formatInteger`**.
- **`AccountingNumberInput` is the canonical money-input primitive.** Raw `<input type="number">` on focus + accounting-formatted text on blur. Use for all numeric money inputs.

**Area hierarchy**
- **Three-tier hierarchy: NSA ⊂ BUA ⊂ GFA.** NSA = revenue sub-units (Sellable + Operable + Leasable); BUA = NSA + Support (sub-unit + asset-level); GFA = BUA + Parking (asset-level). Consume `computeAssetAreaHierarchy(asset, subUnits)`; never re-derive from `Asset.buaSqm` directly.
- **Sub-unit BUA is source of truth.** `computeAssetBua` / `computeAssetSellableBua` fall back to `asset.buaSqm` only when sub-units are empty.
- **SubUnitMetric is `'units' | 'area'`.** Legacy `'count'` accepted on read. Use `switchMetric()` to preserve area sqm on toggle.
- **Parking is sqm-only at the cost-engine level.** No parkingBays input. Parking-bay-driven revenue (fee/bay/year) models as a Leasable sub-unit.

**Land**
- **Multi-parcel landAllocation.** Asset gains `landAllocation: { parcelId?, sqm?, pct?, multiParcelSplits?, customRate? }`. Sentinels: `PARCEL_WEIGHTED_AVG`, `PARCEL_CUSTOM_RATE`. M2.1 reads `Asset.landAllocation` for per-parcel disposition.
- **Parcel NDA is parcel-level.** Each parcel carries `hasNdaDeduction` + `roadsPct` + `parksPct`. Land allocation references NDA (not gross area); full parcel cost flows to assets at inflated effective NDA rate.
- **Reconciliation is compact-by-default.** Collapsed summary line with status icon (✓/✗/⚠) + expand affordance + auto-expand on mismatch + localStorage persistence. Pattern applies to land reconciliation, asset area reconciliation, and future revenue/debt/capex reconciliations.

**Cost engine**
- **Direct vs Allocated category (M2.0L Pass 5).** Every `CostLine` carries `costCategory?: 'direct' | 'allocated'` (default `direct`). Direct = asset-specific (current Pass 3+ math: `rate × asset.metric`, `allocFactor = 1` except for method='fixed'). Allocated = project-wide pool, split per asset via `costDriver` (`bua_share` / `land_share` / `value_share`). Calc engine computes Allocated lines against `aggregatePhaseMetrics(phaseAssets, metricsByAsset)` to get the pool, then `resolveDriverFactor(driver, asset, ...)` distributes per asset. `value_share` currently falls back to `bua_share` (deferred until M2.1 Revenue ships projected per-asset value). Auto-derived `CostType` (`hard` / `soft` / `land_cash` / `land_in_kind` / `operating`) via `deriveCostType(line)` is internal-only, not user-visible.
- **Parent/child inheritance is the canonical Costs UX (M2.0L Pass 4).** One editable master cost line table per phase (`CostLine[]` with `targetAssetId === undefined`) + per-asset resolved replicas below. Each replica row carries a Source pill (Inherited/Override) + an Override toggle button. **NOTE Pass 7 (2026-05-12) deprecated this surface**: Tab 3 Inputs is now per-asset only; CostOverride[] flattened on hydrate.
- **CostOverride resolution:** `override.overridden === false` reverts to master entirely. `override.overridden !== false` (true OR legacy undefined treated as true) uses override fields with master fallback per field. Same rule for the migration banner: legacy CostOverride entries stamp `overridden=true` on hydrate via `migrateM20Pass4Inheritance`.
- **`Project.costInputMode` is deprecated.** Stripped on hydrate. The Same vs Individual mode UX is gone; the inheritance surface always renders both views.
- **Capex Excl Land In-Kind is the cash-impact schedule** that feeds the Financing module's drawdown curve for debt sizing + equity funding requirement. Results Table 3 in Tab 3. Land In-Kind is non-cash equity (Tab 4 In-Kind Equity tile, never on Cash Flow Statement); Total Capex Incl Land Value (Results Table 2) is the basis for Fixed Assets / Inventory book value in M5.
- **Capex capitalisation rule.** Every cost line capitalises into asset basis. `classifyAssetCapex(asset, capexBasis, landTotal)` routes to `{ COGS, FixedAssets, Depreciation }` per strategy. Land never depreciates.
- **Land in-kind treatment.** `computeCashFlowImpact(capexBasis, landInKindPortion)` returns `{ cashOutflow, equityInKind }`. M3 Cashflow consumes directly.
- **`CostLine` is open-ended `id: string`.** Custom + seed lines coexist; `isLocked` protects seed rows. `STANDARD_COST_LINE_IDS` exports the 9-line standard catalog. `deriveCostStage(line)` returns stage by stable id; custom lines fall back to `line.stage`.
- **Per-sub-unit custom rates** is the pattern for granular cost differentiation. `CostMethod = 'per_sub_unit_custom_rates'` + `CostLine.perSubUnitRates` keyed on sub-unit id with reserved keys `'__support__'` / `'__parking__'`. M2.1 can mirror with `RevenueLine.perSubUnitRates`.
- **Cost line caption pattern.** Inline caption under value cell showing `rate × metric = total`. M2.1 follows with `revenueLineCaption`.

**Strategy + revenue obligations (for M2.1)**
- **Sell / Operate / Lease / Sell + Manage.** Short labels with `STRATEGY_TOOLTIPS` map for longform hover.
- **Sub-unit category + metric drive Rate Unit** (Sellable+units = per unit, Operable+units = per room/night, Leasable+area = per sqm/year, etc.). M2.1 wires each combination to its revenue stream.
- **Sell + Manage** drives recurring management fee revenue via `Asset.managementAgreement` (managementFeePct × operating revenue over agreementDurationPeriods, starting at agreementStartPeriod or handover).
- **Asset.status gates revenue:** planned = no revenue, construction = pre-sale only (Sell + Sell+Manage), operational = full revenue per strategy.

**Layout + UX**
- **Sticky sidebar.** Outer wrapper `height: 100vh; overflow: hidden`; scrollable `<main>`. Standard for any module shell.
- **Sub-tab Inputs / Results pattern** is canonical for editable + read-only views. M2.1 + M3 follow.
- **Per-asset selector + 3 summary cards** is canonical Inputs layout. Asset selector bar + per-asset section + 3 summary cards.
- **Hide zero rows in Results.** Filter `total=0` rows from display; keep in Inputs.
- **Granularity toggle remounts via key.** `key={`summary-${granularity}`}` to avoid stale state.
- **Summary table column convention:** [Description] [Total] [Period/Stage/Type cols...] so totals visible without scrolling right.

**Catalogs**
- **Project type catalog is additive.** 14 project types with `ASSET_TYPES_BY_PROJECT_TYPE` filter for Tab 2 Type dropdown. `SUGGESTED_CATEGORIES_BY_PROJECT_TYPE` provides empty-state nudges; never auto-creates assets.

---

## Module 1 archived phase history (M2.0 → M2.0j)

Full closure narrative for each phase below lives in **CLAUDE-FEATURES.md** under "Module 1 (REFM) M2.0 Phase History (M2.0 → M2.0j, archived 2026-05-11)". One-line index here for quick recall:

- **M2.0j** (2026-05-07), 16 audit + display + structural fixes (cp=0, Asset.type optional, Land Parcel rate header, Display Scale export comment, Display Scale + Decimals on Land Parcel, sub-unit area/units bidirectional sync, accounting format on blur, cost line caption per method, phasing simplified to Even+Manual, period dates align to phase start, Capex by Period audit + granularity remount, hide zero rows, drop stage labels, drop 3 summary tables, asset selector + 3 summary cards). `verify-m20j.ts` + `m20j-costs-audit.spec.ts`. Superseded by M2.0L which fixed the cost line duplication bug it introduced.
- **M2.0i** (2026-05-07), final polish (10 fixes): Display Settings panel, drop Model Granularity input + Parking Bays, sub-unit Units/Area, Strategy short labels, compact reconciliation, Operational phase Historical Baseline. `verify-m20i.ts` + `m20i-final-polish.spec.ts`.
- **M2.0h** (2026-05-07), area hierarchy + cost granularity (6 fixes + v7→v8 migration banner): NSA/BUA/GFA tiers, parcel NDA toggle, per-sub-unit custom rates, runtime granularity toggle, currency header line. `verify-m20h.ts` + `m20h-area-hierarchy-cost-granularity.spec.ts`.
- **M2.0g** (2026-05-06), display + reconciliation + Costs restructure (v7→v8 schema bump): annual-only inputs, displayScale, end-of-period dates, asset Support/Parking, land reconciliation, sub-tabs Inputs/Results, 4 summary tables, Manual % phasing restore. `verify-m20g.ts` + `m20g-display-recon-costs.spec.ts`.
- **M2.0f** (2026-05-06), structural fixes (6 fixes): 14 project types, Phase Start Date column, multi-parcel landAllocation, sub-unit BUA source of truth, Parking sub-unit. `verify-m20f.ts` + `m20f-structural-fixes.spec.ts`.
- **M2.0e** (2026-05-06), wizard simplification + Tab 2 canonical entry: per-phase asset sections, Sell+Manage / UsefulLife sub-forms, Status pill, computePhaseTimeline. `verify-m20e.ts` + `m20e-wizard-tab2.spec.ts`.
- **M2.0d** (2026-05-06), Costs polish + v7 schema: Sell+Manage rename, per-asset cost segregation, classifyAssetCapex, computeCashFlowImpact, 3 summary tables, Tab 4 In-Kind Equity tile. `verify-m20d.ts` + `m20d-costs-polish.spec.ts`.
- **M2.0c** (2026-05-06), Dev Costs + Financing restore on v6: 13 cost methods, 5×5 financing matrix, IDC capitalization, per-tranche schedules. `verify-m20c.ts` + `m20c-costs-financing.spec.ts` (skipped, frozen).
- **M2.0b** (2026-05-06), brand-styled shell on v5: Topbar + Sidebar + Dashboard + Modals restored, dark-mode toggle, playwright.config.ts baseURL. `verify-m20b.ts` + `m20b-shell.spec.ts`.
- **M2.0** (2026-05-06), v5 hard-cut rebuild: flat Project → Phase → Asset → SubUnit hierarchy, 4 tabs, 9 fixed cost lines, 5×3 financing matrix, 30.8 KB v5 baseline. `verify-m20.ts` + `m20-full-flow.spec.ts`.

---

## Module 1 phase history (M1.R through M1.13d, pre-M2.0)

M2.0 (2026-05-06) hard-cut Module 1 to the v5 schema, replacing the v3 / v4 hierarchy (Master Holding / Sub-Project / Plot / Zone / FAR / Cascade / Parking Allocator). The pre-M2.0 narrative (M1.R → M1.5 → M1.5b → M1.6 → M1.7 → M1.8 → M1.9 → M1.9b → M1.10 → M1.10b → M1.11 → M1.12 → M1.13 → M1.13b → M1.13c → M1.13d) plus M1.8 wizard hotfix series and the legacy 3-baseline snapshot diff pattern lives in **CLAUDE-FEATURES.md** under "Module 1 (REFM) Phase History (frozen pre-M2.0)". Read it only if you are excavating an old commit or a deferred-from-M1 issue resurfaces; current work happens against M2.0 Pass 9 on v8.
