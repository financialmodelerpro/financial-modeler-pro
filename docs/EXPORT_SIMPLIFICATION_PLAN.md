# Excel export simplification plan (agreed 8 Nov 2026)

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

## Build order (one prompt each, quick checks, full verifier at the end)
1. Global rules and formatting in the shared builder.
2. Inputs, Land & Area, Capex.
3. Revenue, Opex.
4. Schedules, Financing.
5. P&L, Cash Flow, Balance Sheet.
6. Returns, Summary, Scenarios, Checks, Guide, Cover.
7. Full verifier, export both files for independent check.
