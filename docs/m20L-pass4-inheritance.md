# M2.0L Pass 4, Parent / Child Inheritance Architecture

**Date:** 2026-05-11
**Trigger:** Pass 1-3 shipped a "Same vs Individual" toggle on Tab 3 Costs. Switching modes is destructive (Individual->Same clears per-asset overrides; Same->Individual leaves per-asset rows empty until the user re-enters everything). Pass 4 replaces the two-mode toggle with a single inheritance model where master defaults always exist and per-asset overrides are opt-in per cost line.

---

## Architecture

### Single data model with inheritance

```
master CostLine[]              (one per phase, project-wide)
   |
   |  resolve via CostOverride lookup at compute time
   v
per-asset effective values     (inherited from master, replaced by override.overridden=true)
```

Existing `CostLine` + `CostOverride` storage already supports inheritance physically: master lines are project-wide (`targetAssetId === undefined`), per-asset overrides live in `costOverrides[]` keyed by `(assetId, lineId)`. The Pass 1-3 mode toggle artificially split this single model into two surface views. Pass 4 collapses back to ONE surface that always renders both.

### Schema additions (v8 stays additive)

```ts
interface CostOverride {
  assetId: string;
  lineId: string;

  // Existing fields preserved, become "if-overridden" payload
  method: CostMethod;
  value: number;
  phasing: CostPhasing;
  distribution?: number[];
  disabled?: boolean;
  perSubUnitRates?: Record<string, number>;

  // Pass 4 additions
  overridden?: boolean;     // explicit toggle, default true on legacy entries
  startPeriod?: number;     // optional per-asset timing override
  endPeriod?: number;
}
```

Resolution per asset per cost line:
```
override = costOverrides.find(assetId, lineId)
if override?.overridden === false: ignore override entirely, use master
if override exists and overridden !== false: every set field on override
  takes precedence; undefined fields fall back to master
otherwise: use master
```

### costInputMode removed

`Project.costInputMode` field is deprecated. Migration strips it on read. The Tab 3 toggle button + first-open chooser modal are deleted. New screenshot: master template on top, per-asset resolved replicas below.

### Migration

`migrateM20Pass4Inheritance(snapshot)` runs in the existing migration chain:
1. Strip `Project.costInputMode` if present.
2. For every entry in `costOverrides`, stamp `overridden = true` if undefined (legacy overrides were ALL intentional).
3. Banner: `"Cost engine upgraded to inheritance model. Review master template and per-asset overrides in Tab 3."`

Custom-targeted lines (those with `targetAssetId`) are left untouched. They remain asset-specific custom lines, displayed under the asset section that owns them. They do NOT participate in master inheritance.

---

## UI rewrite

### Inputs sub-tab layout

```
+----------------------------------------------------------+
| Master Template                                          |
| [editable cost line table - one row per master line]    |
| [+ Add Custom Cost line]                                 |
+----------------------------------------------------------+

  Per-asset resolved (read-only by default; row goes editable when
  Override toggle is ON for that asset+line combo)

+----------------------------------------------------------+
| Asset A                                          Subtotal |
| Cost Line | Method | Rate | Source | Multiplier | Total | Override |
| Construction (BUA) | Rate × BUA | 4,500 | Inherited | 130,874 sqm | 588,933,000 | [ Override ] |
| Construction (BUA) | Rate × BUA | 5,500 | OVERRIDE  | 130,874 sqm | 719,807,000 | [✓ Inherited]|
| ...                                                      |
+----------------------------------------------------------+

+----------------------------------------------------------+
| Asset B                                          Subtotal |
| ... (same table shape) ...                                |
+----------------------------------------------------------+
```

Each replica row carries:
- **Source badge:** "Inherited" (gray) or "Override" (warning amber).
- **Override toggle button:**
  - When inherited -> button reads "Override" and clicking creates an override entry with the current resolved rate as starting value, flips overridden=true.
  - When overridden -> button reads "✓ Inherited" with strikethrough (visual: "click to revert"); clicking sets overridden=false (or removes the override entirely).
- **Rate input:** disabled when inherited (reads master); editable when overridden.
- **Method dropdown:** disabled when inherited; editable when overridden (advanced).
- **Start / End period inputs:** hidden by default. Surfaced via a small "advanced" disclosure on the row when overridden=true.

### Master edit propagation

Synchronous. Master edits hit Zustand `updateCostLine`; every non-overridden replica re-renders with the new value on the same tick because they all read `master.value` directly. Overridden rows stay put.

### Delete semantics

- Delete a master cost line -> confirm dialog: `"Remove '${line.name}' from every asset?"`. On confirm, both the master row AND every per-asset override pointing at that lineId are dropped.
- Toggle Override OFF on an asset row -> drops the override entry, asset reverts to master values. No confirmation (the action is fully reversible by toggling back on).
- Custom-tagged lines (`targetAssetId` set) keep the original "X delete" button per Fix 8.

---

## Results sub-tab, 4 stacked tables (per brief)

Table 1: **Construction Cost Schedule by Period (per cost line, per asset)**
- Existing "Capex by Period" with the per-line nested rows.
- Only construction-phase costs (stops at endPeriod). Costs beyond endPeriod are zero. Zero rows hidden.

Table 2: **Total Capex Including Land Value** (per asset row, periods as columns)
- `assetPeriodTotal[i] = bd.perPeriod[i]` (everything).

Table 3: **Capex Excluding Land In-Kind** (per asset row, periods as columns)
- `assetPeriodTotal[i] - bd.perPeriodLandInKind[i]`. The cash-impact schedule that drives debt sizing in M2.0L Financing.

Table 4: **Capex Excluding Total Land** (per asset row, periods as columns)
- `assetPeriodTotal[i] - bd.perPeriodLandTotal[i]`. Pure development cost / cost-per-sqm benchmarking.

Naming was relabeled from Pass 3 (which had "Excl All Land" / "Excl Land In-Kind" / "Incl All Land") to match the brief's accounting framing:
- Table 2 = "Total Capex Including Land Value" (was "Incl All Land")
- Table 3 = "Capex Excluding Land In-Kind" (was "Excl Land In-Kind")
- Table 4 = "Capex Excluding Total Land" (was "Excl All Land")

All 4 share: filter pill bar, granularity toggle, displayScale/decimals, phase-scoped period dates, hide-zero rows, Total column in second position.

### Accounting hook for M5

For the future Module 5 (P&L + Cash Flow) integration:
- **Table 2 (Total Capex)** -> Fixed Assets / Inventory book value, depreciation base (less land).
- **Table 3 (Excl Land In-Kind)** -> Cash Outflow schedule. Drives debt sizing + equity funding requirement. **This is the schedule the Financing module's drawdown curve consumes.**
- **Land In-Kind** -> non-cash equity contribution, surfaces in Tab 4 In-Kind Equity tile, never in cash flow.

Reaffirmed in CLAUDE.md "Module 1 Conventions" under "Cost engine".

---

## Commit plan

1. **This file** (design note, first commit).
2. **Schema** additions (`overridden`, `startPeriod?`, `endPeriod?` on CostOverride; deprecate `Project.costInputMode`). Migration `migrateM20Pass4Inheritance` stamps `overridden=true` on legacy entries + strips `costInputMode`. Banner constant `PASS4_MIGRATION_NOTICE`.
3. **UI rewrite**: drop CostInputModeModal + cost-input-mode-toggle. Render single Inputs surface: master template + per-asset resolved replicas. Each replica row gets Source badge + Override toggle. Master edit propagates synchronously through Zustand subscriptions.
4. **Results rebuild**: rename Pass 3's three Summary tables to match the brief's accounting framing. Verify the per-line per-period Construction Cost Schedule (Table 1) hides costs beyond endPeriod.
5. **Verifier** (`scripts/verify-m20L-pass4.ts`) + Playwright spec (`tests/e2e/m20L-pass4-inheritance.spec.ts`) covering inheritance edit flow, override toggle, master propagation, Start/End validation, 4 Results tables, migration.
6. **Docs**: CLAUDE.md status line + Module 1 Conventions inheritance note + CLAUDE-TODO.md Pass 4 entry. Final Vercel verify.

Pass 4 is purely UX-architectural; no calc-engine math changes beyond what Pass 3 already shipped (Fix 3 widening, Fix 7 clamp).
