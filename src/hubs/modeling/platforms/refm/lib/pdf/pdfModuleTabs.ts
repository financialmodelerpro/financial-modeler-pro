/**
 * pdfModuleTabs.ts
 *
 * Static manifest of the tab labels each built module's PDF builder can emit, in
 * render order. This is the SUPERSET (some tabs are conditional on project data,
 * e.g. Escrow only when there are pre-sales, Case Comparison only with >1 case).
 *
 * Kept in a standalone, dependency-free file so the Export modal can render the
 * per-tab selection checkboxes without eagerly importing the heavy pdf-lib
 * generator. The verifier (verify-pdf-export) asserts that every tab the builders
 * actually emit appears here, so this manifest cannot silently drift from
 * generateProjectPdf.ts.
 */
export const PDF_MODULE_TABS: Record<string, string[]> = {
  module1: [
    // The platform's seven tabs, Financing carrying its four sub-tabs in the
    // screen's own order: Inputs, Schedules, Funding Gap, Cash Sweep
    // (2026-09-21). Parties and Asset Types & Standards were missing entirely
    // and the report printed Funding Gap second.
    'Tab 1: Project & Phases',
    'Tab 2: Parties',
    'Tab 3: Fund Terms',
    'Tab 4: Asset Types & Standards',
    'Tab 5: Assets & Sub-units',
    'Tab 6: Capex',
    'Tab 7: Financing / Inputs',
    'Tab 7: Financing / Schedules',
    'Tab 7: Financing / Funding Gap',
    'Tab 7: Financing / Cash Sweep',
  ],
  module2: [
    'Tab 1: Inputs',
    'Tab 2: Revenue',
    'Tab 3: Cost of Sales',
    'Tab 4: Schedules',
    'Tab 5: Escrow',
  ],
  module3: [
    'Tab 1: Inputs',
    'Tab 2: Opex Output',
  ],
  module4: [
    // The platform's four tabs, Schedules carrying its two sub-tabs (2026-09-17).
    'Tab 1: Schedules / Fixed Assets & D&A',
    'Tab 1: Schedules / BS Schedules',
    'Tab 2: P&L',
    'Tab 3: Cash Flow',
    'Tab 4: Balance Sheet',
  ],
  module5: [
    'Tab 1: Returns',
    'Tab 2: RE Metrics',
    'Tab 3: Case Comparison',
    'Tab 4: Cash Flow Streams',
    // Fund Layer renders only on a fund project. It was MISSING here, so the
    // per-tab picker never listed it and, because the picker seeds the
    // selection from this manifest, touching the picker dropped the entire
    // fund section from the exported PDF.
    'Tab 5: Fund Layer',
  ],
  module6: [
    'Tab 1: Cases & Assumptions',
    'Tab 2: Scenario Comparison',
    'Tab 3: Year-on-Year Impact',
  ],
};
