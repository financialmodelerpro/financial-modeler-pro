# Excel export simplification plan (agreed 8 Nov 2026)

**DONE 2026-11-17 (step 7, the full proof).** Both workbooks, every tab, in the founder's model's style. The final rules are in "Final rules" below; the record of each step is in [CHANGELOG.md](../CHANGELOG.md) and in [FORMULA_EXCEL_GUIDELINE.md](FORMULA_EXCEL_GUIDELINE.md) section 10.

Goal: a short, clean, traceable export that reads like a hand-built model (reference: Ahmad's FMP_Marina_Gate_Model.xlsx). Applies to BOTH the live (formula) workbook and the values (hardcoded) workbook, same tabs and rows so they match row for row.

## Decisions
- Features switched off and zero cost lines are not built (escrow 0%, HQ off, payables 0 days, no existing position, zero statutory reserve, zero opex lines). Inputs shows one line: "Not used in this project: ... Turn on in the platform and re-export."
- Values workbook gets the same shortened layout.
- Returns: option (a), sensitivity and exit-year tables move to Scenarios as platform values.
- Units follow the download choice (full, thousands, millions) via number format only.

## Rules for every tab
- No repeated inputs: capex method table once for all assets (11 rows, not 80), one spend curve row per asset, lease assets in one table with a column per asset, inflation set once.
- No echo blocks: calc tabs link straight to Inputs.
- One-line groups show once.
- Every row has a user; rows feeding only a check or nothing are removed or moved to Summary.
- Analysis lives on Summary and Scenarios.
- Formatting per Ahmad's model: title block with Back to Cover, navy header band (153D64) with phase row, numbered section bars (1B4F8A), line items indented, inputs blue on yellow (FFF2CC), cross-sheet links green (2E8B3A), calcs black, key totals CAPS navy on light blue (DDE7F3) with top/bottom border, subtotals grey (D9D9D9), IRR/MOIC under each cash flow, one number format per type, Cover with tab links, landscape fit-to-width print.

## Row targets (now -> target)
Inputs 506->250, Land & Area 90->45, Revenue 191->140, Capex 222->120, Opex 178->85, Schedules 121->100, Financing 114->85, P&L 98->65, Cash Flow 158->60, Balance Sheet 51->45, Returns 307->130, Summary 84->70, Scenarios 182->70, Guide 74->20. Total about 2,438 -> 1,370.

## Tab notes
- Capex: "Collections" curve rows move to Revenue; spend shares 30 -> ~10 (plot curves plus a blend only for multi-plot assets, exact); Tables 2/4/5 merged; cost per sqm (7a/7b) to Summary.
- P&L: phase P&Ls cut to EBITDA lines (dividend cap needs phase EBITDA).
- Cash Flow: phase cash flows and indirect method removed (only one check used them; check moves to Checks).
- Financing: "Settings in force" block removed.
- Returns: assumptions, exit value, FCFF, FCFE, distributions and performance fee, partners, fund fees, Sources and Uses with %, key metrics. Disposal working, operating KPIs, stabilisation, funding mix, weak metrics and partner stream rows removed.
- Scenarios: cases, changed assumptions only, comparison, sensitivity, exit-year; year-on-year impact and reconciliation removed.
- Guide: colours and tab list only.

## Status
- Step 1 DONE 2026-11-12: house style (lib/excel/houseStyle.ts) and builder rules (lib/excel/exportScope.ts) on both workbooks; verify-export-house-style. The values workbook still has its own (longer) row layout: matching it row for row to the live one is the open structural decision for step 2.

- Step 2 DONE 2026-11-12 / 2026-11-15 (921fb32c): values workbook = the one layout in values mode (lib/excel/valuesWorkbook.ts, verify-values-mode); the six bring-backs; Table 7 to Summary; then the Inputs, Land & Area and Capex restructure (capex method table once, one spend curve per asset or plot group, the lease table, inflation once, collections rows to Revenue, Tables 2/4/5 merged) and the tab frame (lib/excel/tabFrame.ts: title block, years in row 4, phase in row 5, the Input column only where a row has its own input).
- Step 3 DONE 2026-11-15 (7ec694a8): Revenue and Opex.
- Step 4 DONE 2026-11-15 (7f1aed6b): Schedules and Financing (the settings block gone; Financing links Inputs directly).
- Step 5 DONE 2026-11-15 (49d39e13): P&L, Cash Flow and Balance Sheet; no formula over 150 characters; zakat worked out on the P&L.
- Step 6 DONE 2026-11-16 (dae5e4f3): Returns, Summary, Scenarios, Checks, Guide and Cover.
- Step 7 DONE 2026-11-17: the small fixes (Scenarios comparison as numbers with a Change column per case and a plain header row; assumption rates with no decimals and percentages with one; Summary cost per sqm of GFA, the sale price kept against cost per sqm of NSA; Returns labels) and the full proof: every verifier re-aimed to the new layout, the suite, the values-mode verifier, the real-Excel proof and the census of the six open projects. The proof found five real defects, all fixed: the values workbook's Returns had lost every cash flow row since step 6 (the visible streams were registered under the `rs|` prefix the values file drops as workings; it showed IRR lines with nothing above them), Revenue's pre-sale cohort rows were pinned to calendar columns (a phase moved earlier lost a year of collections in Excel), the cell registry the build returns did not follow the tab frame, Revenue's sale value column was too narrow for a full-unit figure (it showed ####), and in the classic layout (no route ships it) a link to a cleared Inputs sub-section landed on a blank row.

## Final rules
- **Off and zero items are not built.** A feature switched off (escrow at 0%, HQ off, payables at 0 days, receivables at 0 days, no tax payment lag, no existing position, no statutory reserve) and a cost or opex line that charges nothing have no row and no input cell anywhere; Inputs says so in one line ("Not used in this project: ..."). A verifier that tests such a feature does it on a copy with the feature on.
- **Rows are shared only when the rule is the same.** One Inputs row may carry several lines (the cash and in-kind land of a phase, the lease lines' common inflation) only where the platform applies one rule to all of them; typing into it moves every line on it.
- **No formula over 150 characters**, on any tab of the live workbook (helper rows carry the rest; the values workbook drops the helper rows through `WORKING_ROWS`).
- **A Total only for a flow.** The Total column is left blank for a flag, a factor, a rate, a percentage, an area, a price and a balance (opening, closing, outstanding); money, room nights and sqm sold keep it, and a Total a formula reads is kept (`blankNonFlowTotals`). The Balance Sheet's column is Closing.
- **Every tab reads earlier tabs, with three named exceptions**: capitalised interest (the financing loop), each phase's EBITDA (the dividend cap reads the phase P&L) and zakat (worked out on the P&L, read back by Financing's "Zakat (the P&L)" row). The shape check refuses any other read of a later tab.
- **It reads like a hand-built model** (the final fix list, 2026-11-17, `lib/excel/readability.ts`): labels of 50 characters or fewer with no explanation in brackets and none starting with "="; a price, rate or size per unit with no decimals, a percentage with one, a multiple with two, zero as "-", no "m" written after a figure; no MAX(0, ...) that only guards an Inputs cell (the cell carries a "0 or more" rule instead); SUMIF, not SUMPRODUCT, for a plain conditional sum; a title block of the model line, the tab and its description, with "<- Back to Cover" at the right; a Cover with the project, the key figures and a link to every tab. A pass that rewrites a formula keeps a cached value (TRAPS 3.45), and a pass that moves cells moves conditional formats too (TRAPS 3.44).
- **Scenarios is values by design**: the cases' assumptions and comparison as numbers in the units of the download, each scenario with its own Change column, a plain header row with no year band.

## Build order (one prompt each, quick checks, full verifier at the end)
1. Global rules and formatting in the shared builder.
2. Inputs, Land & Area, Capex.
3. Revenue, Opex.
4. Schedules, Financing.
5. P&L, Cash Flow, Balance Sheet.
6. Returns, Summary, Scenarios, Checks, Guide, Cover.
7. Full verifier, export both files for independent check.
