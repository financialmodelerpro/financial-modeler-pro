# M7 IC Report: Per-Section Layout Spec

Target: rebuild the IC renderer (PPT + on-screen preview) so each section is composed like an IC deck, not mechanically stacked. This spec defines what sits where per section. Applies to both the pptxgenjs export and the Recharts/HTML preview, from the same model.

## Global rules (apply to every slide)

1. **No standalone number-divider slides.** Remove the "01", "02", "03" filler slides entirely. The section number is a small chip on the section's own content slide header (e.g. a navy "07" block left of the title), not a slide of its own. This alone cuts the deck roughly in half.
2. **16:9, brand palette:** navy #1B4F8A, dark navy #0D2E5A, pale #DDE7F3, mid #7FA8D9, green #2E7D52 (positive/pass), red #B23A3A (negative/downside), slate #5A6675 (secondary text), ink #2A3440 (body). Calibri body, Cambria headings. No gold.
3. **Header band** on every content slide: navy bar, section-number chip + section title (Cambria), right-aligned "FMP RE HUB · Investment Committee Report". **Footer:** "Strictly Private & Confidential" left, page number right.
4. **Finding-as-subtitle.** Under each title, one italic slate line stating the finding, not a units note. "Returns are resilient; even the Downside holds a 5.7% equity IRR" NOT "Figures in All figures in SAR '000". Units go in a small right-aligned note or table header, never as the subtitle.
5. **Every chart pairs with analysis.** No chart sits alone. Chart on one side, a captioned finding block (heading + 2-4 line reading) on the other, or a caption directly beneath. This is the single biggest gap in the current export.
6. **KPI tiles for headline numbers.** Rounded pale tiles: small uppercase slate label, large navy/green value, small slate sub-label. Never render headline metrics as plain table rows or vertical text lists.
7. **Two-column layouts** for paired tables (Sources & Uses side by side, not a 27-row vertical dump). Callout boxes for emphasis.
8. **Fix number formatting.** Values are in SAR '000 in the model; present consistently (e.g. "SAR 14,055.0m" or "13,411,808" with a clear unit header), and fix the chart axes showing raw "3,000,000,000". Charts should show SAR m, not raw currency.
9. **Auto-omit unchanged.** A section renders only if its model data exists; empty FORM blocks don't render blank.

## Per-section layout

### Cover / Transaction Summary
Full navy slide. Title FMP RE HUB (Cambria, large), subtitle line (location, mixed-use), one line of programme facts. KPI wall: 5 return tiles (Project IRR, Equity IRR, Distributed IRR, Equity Multiple, Dividend MOIC) row 1; 4 economics tiles (GDV, TDC, Peak Debt, Dev Margin) row 2. Recommendation strip at the bottom (green accent). Prepared-for line from Parties.

### 1. Executive Summary
Left 60%: numbered thesis points (from FORM execPoints; fall back to executiveSummary text split). Right 40%: a pale KPI mini-grid (6 headline metrics) above a navy economics block (GDV, TDC, profit after fin, margin).

### 2. Investment Recommendation
Top: 3 cards (Equity Commitment, Senior Debt, Target Returns) with value + sub-detail. Below: full-width green recommendation block, bold lead line ("Proceed to approval.") then the ask paragraph from FORM.

### 3. Project Overview
Top: 6 fact tiles in a 3×2 grid (location, land area, BUA, strategy mix, horizon, funding). Below: full-width navy "Development Concept" block (FORM developmentConcept; omit block if empty).

### 4. Master Plan & Phasing
3 phase cards side by side. Each: navy header (phase name + window), bulleted asset list, pale footer tile with phase TDC. Auto-omit phases with no data.

### 5. Asset Mix
Left 55%: asset table (asset, strategy, phase, BUA, units, total row). Right 45%: BUA-by-strategy doughnut + a "reading the mix" caption block beneath it.

### 6. Market Context (FORM; omit whole section if empty)
Left: numbered demand-driver points. Right: 3 stat tiles. Sources note at the bottom (italic).

### 7. Development Programme
Full-width swimlane Gantt (phase windows across years, debt-repaid marker, exit marker). Key-gates row beneath from FORM (omit if empty). Caption line reading the timeline.

### 8. Development Costs
Left 50%: cost-stack bar (land / construction; financing separate), axis in SAR m. Right 50%: cost breakdown table + a navy "cost efficiency" callout (profit on cost).

### 9. Value & Development Economics
Top: 4-5 KPI tiles (GDV, profit before fin, profit after fin, dev margin, profit on cost). Left: value bridge table (GDV → less TDC → profit before fin → less financing → profit after, with red negatives, bold subtotals). Right: revenue-recognition stacked columns (sales/hospitality/retail), axis SAR m, + caption.

### 10. Sources & Uses
Two tables side by side (Sources left, Uses right), both totaling to the same figure. Small sources-mix doughnut top-right optional. Full-width "how the funding works" caption block beneath explaining cash-deficit funding.

### 11. Financing Structure
Left 50%: senior-debt-balance columns (axis SAR m). Right 50%: facility summary grid (funding method, existing/new/peak debt, tenor, paydown, reserve) + a navy "de-levering profile" callout.

### 12. Returns Analysis
Top: 6 return KPI tiles. Middle: 4 RE-metric tiles (yield on cost, cap rate at exit, profit on cost, cash-on-cash). Bottom: full-width "reading the returns" caption block (FORM returnsCommentary; fall back to a generated line).

### 13. Exit-Year Optionality
Left 55%: exit-year table (year, equity value, project IRR, equity IRR, MOIC), selected year highlighted green. Right 45%: MOIC-by-exit-year line chart. Full-width "timing is optionality" caption beneath (FORM exitCommentary fallback).

### 14. Scenario Analysis: Cases
Left: "what drives each case" assumption table (derived) + headline returns table (Management shaded). Right: project/equity IRR-by-case grouped bar.

### 15. Scenario Analysis: Economics
Left: economics-by-case table (NPV, GDV, profit after fin, margin, IRRs). Right: NPV-by-case bar (green positive, red negative). Takeaway caption block (FORM scenarioTakeaway fallback).

### 16. Sensitivity
Left: two-way Equity-IRR grid (Exit Cap Rate × Sales Price), base shaded, values colour-graded (heatmap). Right: driver-swing reading caption. Full-width takeaway beneath.

### 17. Risk Assessment (FORM; omit if empty)
6 risk cards in a 2×3 grid, each: numbered navy badge, risk title (Cambria), "Mitigant:" line (green label + body).

### 18. Regulatory & Tax (FORM; omit if empty)
Repeater rows (label + body), optional KSA preset. 2-column card layout.

### 19. Recommendation & Approvals
Left 60% navy block: "The Committee is asked to approve" + ticked ask list. Right 40% pale block: conditions precedent (numbered) + next steps. All from FORM (fall back to recommendation text).

### Disclaimers
Full-width, small text, FORM disclaimers.

## Composition principles Code must follow

- Compose each slide from a small set of reusable primitives: `kpiTile`, `sectionHeader(numberChip, title, findingLine)`, `captionBlock(heading, body)`, `calloutBox(navy/pale)`, `twoColTables`, `chartWithCaption(chart, captionBlock)`, `phaseCard`, `riskCard`, `numberedList`, `factTile`. Build these once, reuse across sections. This is what makes it composed, not mechanical.
- A section is never "chart alone" or "table alone": always chart+caption, or table+callout, or tiles+table.
- Preview (Recharts/HTML) and PPT (pptxgenjs) render from the same model and the same layout intent, so they match.
