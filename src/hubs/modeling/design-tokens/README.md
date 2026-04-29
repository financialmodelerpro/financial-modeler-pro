# Modeling Hub — Design Tokens

Single source of truth for every colour, typography, and spacing value used across the Modeling Hub web UI, Excel exporter, and PDF exporter.

Phase 1 deliverable. **No consumers retrofitted yet** — Module 1, the Excel exporter, and the PDF exporter still use their own colour literals as of this writing. Phases 2-4 will retrofit them onto these tokens.

## Folder layout

```
src/hubs/modeling/design-tokens/
├── colors.ts       — chromeColors + fastColors palettes (light + dark)
├── typography.ts   — font family, sizes, weights, line heights
├── spacing.ts      — 8px grid + semantic spacing
├── index.ts        — barrel re-export
├── tokens.css      — optional Tailwind v4 + CSS-vars bridge
└── README.md       — this file

src/hubs/modeling/components/cells/
├── InputCell.tsx       — FAST input  (blue text, white bg, editable)
├── FormulaCell.tsx     — FAST formula (black text, light grey bg, read-only)
├── LinkedCell.tsx      — FAST linked  (green text, read-only, cross-module)
├── AssumptionCell.tsx  — FAST assumption (yellow bg, blue text, editable)
├── SectionHeader.tsx   — navy band, white uppercase text
├── TableHeader.tsx     — `<th>` with chrome navy background
├── KpiCard.tsx         — corporate chrome card with FAST-coloured value
└── index.ts            — barrel re-export
```

## Two palettes

### `chromeColors` — corporate skeleton

Top bar, sidebar, table chrome, section headers, borders, surfaces, body text. Anchored on the brand navy from `src/core/branding/index.ts:13` (`DEFAULT_BRANDING.primaryColor = '#1E3A8A'`).

```ts
import { chromeColors } from '@modeling/design-tokens';

chromeColors.light.tableHeader      // '#1E3A8A'
chromeColors.light.tableHeaderText  // '#FFFFFF'
chromeColors.dark.tableHeader       // '#1E5594' (lighter navy for dark bg)
```

Or via the helper:

```ts
import { getChrome } from '@modeling/design-tokens';
const c = getChrome('light');
```

### `fastColors` — FAST cell convention

Standard practice across institutional financial modeling (Macabacus, Marquee, the F.A.S.T. Standard). The same hex values are used in Excel and PDF exports so a model that opens with blue inputs and black formulas in the browser opens that way in Excel too.

| Token       | Light          | Dark            | Meaning                                      |
|-------------|----------------|-----------------|----------------------------------------------|
| Input       | `#0070C0` blue | `#4FC3F7` cyan  | Hardcoded user input. Editable.              |
| Formula     | `#000000` black on `#F3F4F6` grey | white on `#1F2937` | Calculated value. Read-only.                |
| Linked      | `#00B050` green | `#66BB6A` light green | Pulled from another module. Read-only.      |
| External    | `#FF0000` red  | `#EF5350` salmon | Hardcoded value referenced from outside the model. |
| Assumption  | `#0070C0` blue on `#FFFF99` yellow | `#4FC3F7` blue on `#5C4D00` muted amber | Key driver input. Editable. Yellow flags it as primary. |
| Header      | white on `#1E3A8A` navy | white on `#1E5594` navy | Section header band. |

## FAST cell rules — when to use which

| Situation | Component |
|-----------|-----------|
| User types a number into the cell | `<InputCell>` |
| User types a number that drives the whole model | `<AssumptionCell>` (e.g. interest rate, equity %, IRR target, exit cap rate) |
| Cell shows a value computed from this same module | `<FormulaCell>` |
| Cell shows a value that came from a different module | `<LinkedCell>` |
| Hardcoded reference to a value pulled from a research source / external workbook / pasted index | inline external styling (no primitive needed today; add when the use case appears) |
| Section title strip across a table | `<SectionHeader>` |
| Column header inside a `<table>` | `<TableHeader>` |
| At-a-glance KPI tile | `<KpiCard>` (with `tone` set to match the underlying value's FAST class) |

The rule of thumb: **the colour signals where the number came from**, not how big or important it is. A reader scanning a model should see at a glance whether each cell is an input, a formula, or a link — and trace back accordingly.

### Land Cash, RETT, Royal Commission Premium

Module 1's seeded cost rows where `canDelete === false`, plus tax/permit lines, are conventionally rendered as `<AssumptionCell>` (yellow). They are not formulas — the user types in the value — but they are primary drivers worth flagging visually.

## How consumers use the tokens

Two consumption paths, both supported.

### Path A — TypeScript imports + inline styles (works today)

```tsx
import { chromeColors, fastColors, fontSize } from '@modeling/design-tokens';

<th style={{
  background: chromeColors.light.tableHeader,
  color:      chromeColors.light.tableHeaderText,
  fontSize:   fontSize.label,
}}>
  Period
</th>
```

This is what the cell primitives in `components/cells/` do internally. Use this path inside the modeling hub for all per-component styling. No CSS imports required.

### Path B — Tailwind v4 utility classes (optional, Phase 4)

Import `tokens.css` from a Modeling Hub layout to register the `@theme` declarations:

```tsx
// app/refm/layout.tsx (NOT WIRED IN PHASE 1 — example for Phase 4)
import '@modeling/design-tokens/tokens.css';
```

Then write JSX like:

```tsx
<th className="bg-mh-chrome-table-header text-mh-chrome-table-header-text uppercase">
  Period
</th>
```

Dark mode is class-strategy: add `class="dark"` to any ancestor (typically `<html>`) and `dark:bg-mh-chrome-surface` style overrides take effect. The `tokens.css` file declares `@custom-variant dark (&:where(.dark, .dark *))` so the variant is registered with Tailwind v4 automatically when the file is imported.

## Brand override channel

The CMS admin can change the primary brand colour at runtime via `/admin/header-settings`. The change writes to `branding_config.primary_color` in Supabase and is applied to the live web UI by `BrandingThemeApplier` (in `src/core/branding/`), which sets `--color-primary` on `:root`.

This Modeling Hub token system stays decoupled from that channel by design — it bakes in the *current* CMS default (`#1E3A8A` from `DEFAULT_BRANDING.primaryColor`) as a TypeScript hex literal.

If the canonical CMS default ever changes, update both:
1. `src/core/branding/index.ts:13` — `DEFAULT_BRANDING.primaryColor`
2. `src/hubs/modeling/design-tokens/colors.ts` — `BRAND_NAVY`

### Per-platform decision

Whether a Modeling Hub web component follows the CMS `--color-primary` override or stays locked on the baked-in `BRAND_NAVY` is a per-platform call. Decisions to date:

| Surface | Source | Rationale |
|---------|--------|-----------|
| **REFM web UI** (Phase 4 retrofit target) | Follows CMS `--color-primary` | Consistent with how Training Hub already behaves; admin can rebrand the live workspace without a deploy. |
| **Excel exporter** (Phase 2, shipped) | Locked on baked-in `BRAND_NAVY` | Server-rendered xlsx cannot read browser CSS vars; the canonical FAST + chrome palette must stay stable across deploys so a model exported in 2026 opens on the same colours in 2028. |
| **PDF exporter** (Phase 3 retrofit target) | Locked on baked-in `BRAND_NAVY` | Same reasoning as Excel. Printed/saved deliverables must stay deterministic. |
| Future platforms (BVM, FP&A, ERM, PFM, LBO, CFM, EUM, SVM, BCM) | Decide at retrofit | Default to *follow CMS* unless the platform has a concrete reason to lock (e.g. white-label re-introduction). |

The mechanic for *follow CMS*: in JSX, replace direct `chromeColors.light.X` references with `var(--color-primary)` (or a derived chain) wherever the brand navy appears. The cell primitives accept inline-style overrides via the standard `style` prop, so a consumer can override `BRAND_NAVY`-derived defaults without forking the primitive.

## Helpers for the exporters

`colors.ts` exports two utilities used by Phase 2 + 3 retrofit:

```ts
import { toArgb, toRgbTriple, fastColors } from '@modeling/design-tokens';

// ExcelJS: cell.fill.fgColor.argb wants 'FFRRGGBB' (8 chars, FF alpha prefix)
ws.getCell('B5').fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: toArgb(fastColors.light.assumptionBg) },
};

// @react-pdf/renderer: accepts CSS hex directly, but if you need normalized
// RGB triples for blending or PDF-native colour ops:
const { r, g, b } = toRgbTriple(fastColors.light.formulaText);
```

## Constraints (Phase 1)

- The token tree is the source of truth. **No hardcoded `#0070C0` or `bg-yellow-100` style literals belong anywhere outside `colors.ts` after Phase 4 retrofit.** Phase 1 simply ships the tokens; existing hardcodes in Module 1, Excel exporter, and PDF exporter remain in place until the dedicated retrofit phases.
- Adding a new colour use case? Add a semantic token to `chromeColors` or `fastColors` first; do not extend an unrelated token because it happens to be the same hex value today.
- Adding a new spacing value? Add a semantic name to `semanticSpacing` rather than reaching for a raw `spacing[3]` in component code.
- Light + dark must stay shape-identical. Adding a key to `light` requires adding it to `dark` in the same commit.

## What's pending (Phase 3-4)

- **Phase 2 — shipped.** Excel exporter (`app/api/export/excel/route.ts`) consumes tokens via `toArgb(fastColors.light.X)` / `toArgb(chromeColors.light.X)`. Zero hardcoded hex literals remain in the route. `buildWorkbook(payload)` extracted as a pure function so a fixture script (`scripts/excel-export-fixture.ts`) can produce a deterministic xlsx without spinning up the dev server. Run `npx tsx scripts/excel-export-fixture.ts` to generate the diff baseline. Eight new chrome tokens added to support the retrofit: `assetAccent`, `assetAccentText`, `timelineConstrBg`, `timelineConstrBgAlt`, `timelineConstrText`, `timelineOpsBg`, `timelineOpsBgAlt`, `timelineOpsText` (with parallel dark variants).
- **Phase 3**: PDF exporter (`app/api/export/pdf/route.ts`) retrofit. Replace inline hex literals with `fastColors.light.X` / `chromeColors.light.X` references. Use the same fixture-runner pattern as Phase 2 if useful.
- **Phase 4**: Module 1 component retrofit. Swap inline colour styles for tokens; replace hand-rolled cells with `<InputCell>` / `<FormulaCell>` / `<AssumptionCell>` / `<LinkedCell>` / `<SectionHeader>` / `<TableHeader>` / `<KpiCard>`. Phase 4 is also where REFM web UI gets wired to follow CMS `--color-primary` (see § Per-platform decision). After Phase 4, a grep for `bg-blue-`, `text-yellow-`, `#1E3A8A`, etc., across `src/hubs/modeling/` should return zero hits outside this folder.
