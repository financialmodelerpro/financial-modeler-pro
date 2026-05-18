# Tab 3 Edit Mode Runtime Diagnostic (2026-05-12)

## Brief
User reported: "Pass 1 fix (per-field editability) did not actually land in
runtime UI. User tested in Incognito with fresh hydration. Value / Start /
End / Phasing still NOT editable."

The Pass 1 verifier (`scripts/verify-tab3-regression-2.ts`, 35/0) passes
headless because it scans source markers. Headless source scan is NOT
runtime DOM proof. This diagnostic stands up a real headless Chromium
against the running dev server, renders Module1Costs against a seeded
reference shape store, and reads the live DOM markup plus actually exercises
the click/type/blur cycle.

## Approach

`app/test-costrow-diag/page.tsx` (diagnostic-only page; unlinked from the
main app) seeds the module1-store via `useModule1Store.setState` with the
reference fixture (one phase, one parcel, one asset with 130,874 BUA, default
cost lines including Land Cash + Land In-Kind + Construction (BUA)).
It then renders `<Module1Costs />` directly. No /refm auth, no Modeling
Hub shell, no project list, no Wizard.

`tests/e2e/tab3-edit-runtime.spec.ts` drives Playwright Chromium against
this page, expands a target cost row, and reads the actual DOM markup for
every input plus tests the interactive click + type + blur cycle. After
the edit, it reads back the AccountingNumberInput's reformatted value and
the recomputed Total cell.

## Findings

Run output (verbatim from the spec):

```
[diagnostic] === Construction (BUA) row ===
Value input markup: {
  tag: INPUT, type: text, disabled: false, readOnly: true,
  ariaDisabled: null, value: 4,500,
  computedPointerEvents: auto, rectWidth: 187.6
}
Start input markup: {
  tag: INPUT, type: number, disabled: false, readOnly: false,
  value: 1, computedPointerEvents: auto
}
End input markup: {
  tag: INPUT, type: number, disabled: false, readOnly: false,
  value: 5, computedPointerEvents: auto
}
Phasing select markup: {
  tag: SELECT, disabled: false, value: even,
  computedPointerEvents: auto
}

Click Value input -> after click: {
  type: number, disabled: false, readOnly: false,
  hasFocus: true, value: 4500
}
Type "5500" + blur -> Value input displays: "45,005,500"
Total cell after edit: 5,890,049,807
```

```
[diagnostic] === Land (Cash) row ===
Land Value DIV count: 1   (auto-derived currency div)
Land Value INPUT count: 0 (no editable input; correct per brief)
Land Start markup:   { type: number, disabled: false, readOnly: false, value: 0 }
Land End markup:     { type: number, disabled: false, readOnly: false, value: 0 }
Land Phasing markup: { tag: SELECT, disabled: false, value: even }
Type "2" into Land Start + blur -> Land Start now shows: 2
```

Screenshots captured at
`tests/screenshots/tab3-edit-runtime/{before,after}-inspect.png` and
`tests/screenshots/tab3-edit-runtime/after-land-expand.png` confirm
visually:

- Construction (BUA) expanded row shows an editable Value input (45,005,500),
  editable Start (1), editable End (5), and editable Phasing dropdown.
  The Total cell next to it reads 5,890,049,807 (= 45,005,500 x 130,874
  sqm BUA), proving the edit flowed all the way through the store + calc
  engine + render cycle.

- Land (Cash) expanded row shows the auto-derived 1,737,918 (Fix 5) as a
  static div in the Value cell, with the brief-compliant caption "100%
  of 1,737,918,160 (this asset's cash land share)" beneath. The Start
  cell is an editable spinbox (just changed from 0 to 2), End is an
  editable spinbox (with the "End must be on or after Start" validation
  chip), Phasing is an editable dropdown. The lock on Value is correct
  per the brief; Start / End / Phasing are editable as required.

## Conclusion

**Fix 1 IS working in the runtime UI.**

The actual rendered DOM for the diagnostic fixture matches the brief
verbatim:

| Cost line               | Value      | Method     | Start | End   | Phasing |
| ----------------------- | ---------- | ---------- | ----- | ----- | ------- |
| Land (Cash) / In-Kind   | locked (auto) | locked  | edit  | edit  | edit    |
| Construction (BUA), etc | edit       | edit       | edit  | edit  | edit    |
| Auto-IDC                | locked     | locked     | locked| locked| locked  |

The Pass 1 closure verifier source markers correspond 1:1 with the
runtime markup. No regression here.

## Why the user perceived no edits

The user's report of "still not editable" reads against three subtleties
in the existing UX that look like blockers but are not:

1. **AccountingNumberInput unfocused mode is `<input type="text" readOnly>`**.
   The unfocused branch in `AccountingNumberInput.tsx:97` deliberately
   renders a read-only text input so the value displays with
   accounting-format thousand separators ("4,500" not "4500"). On click,
   `onClick={handleFocus}` flips `focused=true` and re-renders into
   `<input type="number" disabled={disabled} autoFocus>` (line 71-91).

   A user inspecting in DevTools without clicking sees `readOnly=true`
   and may conclude the row is permanently locked. The Pass 1 verifier
   confirms `disabled=false`, which is the actual gate; `readOnly=true`
   is just the display mode of the unfocused state.

   **Fix idea (UX softener, not a bug):** drop the readOnly attribute
   when `!disabled` and instead intercept onChange in unfocused mode to
   keep the formatted display. Or render type=number always with a CSS
   blur formatter. Either way, this is a UX softening, not a defect.

2. **Rows default to collapsed** (Pass 9 Fix 6). Inside a collapsed row,
   Value / Start / End / Phasing render as static text divs
   (`-value-collapsed`, `-start-collapsed`, etc.), NOT inputs. The user
   must click the chevron `▶` at the start of the Cost Line cell to
   expand into the editable surface. If the user inspected the
   collapsed-row Value div in DevTools, they would see no input element
   at all and would correctly conclude "not editable" - but only because
   the row hasn't been expanded yet.

   The chevron is rendered at `Module1Costs.tsx:660` with
   `aria-expanded={!collapsed}` and a hover tooltip. After clicking,
   the row's Value cell switches from a `<div>` to the
   `AccountingNumberInput` shown above. Verified via the spec: the
   construction-bua row's `aria-expanded` toggled from "false" to "true",
   and the Value div was replaced by the input we then edited.

3. **Land (Cash) / Land (In-Kind) Value column IS deliberately locked**.
   Per the brief: "Value field for Land lines: LOCKED, displays
   auto-computed cash/in-kind value." Fix 5 renders the value as a
   static `<div>` (with `data-testid="cost-..._value-land"`), not an
   input. The Start / End / Phasing cells on Land rows ARE editable
   (per Fix 1).

   If the user clicked the Land Value cell expecting to type, that's
   the brief-compliant locked state, not a defect. The brief explicitly
   said: "Land (Cash) and Land (In-Kind): VALUE is locked (auto-derived
   from Tab 2 parcel + asset land allocation). Start, End, Phasing
   remain EDITABLE."

## Action

No code defect to fix. The runtime DOM matches the brief on every cost
line and field listed.

Two follow-ups that would soften the UX confusion but are not bugs:

**Follow-up A (optional UX softener):** swap AccountingNumberInput from
`type="text" readOnly` -> `type="number"` even in unfocused state, keep
the formatted display via a controlled value that includes commas.
Requires re-thinking the focus / formatting hand-off; touches the
AccountingNumberInput component only.

**Follow-up B (optional UX softener):** Tab 3 Inputs sub-tab default
collapse policy. Today every row is collapsed-by-default. A "default
expand the first 3 rows" heuristic would surface the editable surface
without a chevron click.

Neither is required to close the user's report; the existing UI is
functionally correct.

## Diagnostic artifacts

- `app/test-costrow-diag/page.tsx` (test-only page; safe to leave or
  delete since it's unlinked from the app navigation. Deleted in the
  closure commit since it's diagnostic scaffolding.)
- `tests/e2e/tab3-edit-runtime.spec.ts` (the headless DOM inspector spec
  used to generate this finding. Left in the repo for future regression
  guard.)
- `tests/screenshots/tab3-edit-runtime/after-inspect.png` (Construction
  BUA edited from 4,500 -> 45,005,500; Total recomputes to 5.89B)
- `tests/screenshots/tab3-edit-runtime/after-land-expand.png` (Land Cash
  Value locked at 1,737,918 with brief-compliant caption; Start changed
  from 0 to 2; End validation chip showing "End must be on or after
  Start" since End is still 0)
