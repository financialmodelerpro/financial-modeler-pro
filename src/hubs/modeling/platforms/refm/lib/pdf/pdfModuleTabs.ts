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
    'Tab 1: Project Setup',
    'Tab 2: Assets & Sub-units',
    'Tab 3: Capex',
    'Tab 4: Financing / Inputs',
    'Tab 4: Financing / Funding Gap',
    'Tab 4: Financing / Schedules',
    'Tab 4: Financing / Cash Sweep',
  ],
  module2: [
    'Tab 1: Revenue Inputs',
    'Tab 2: Revenue Output',
    'Tab 3: Cost of Sales',
    'Tab 4: Schedules',
    'Tab 5: Escrow',
  ],
  module3: [
    'Tab 1: Opex Inputs',
    'Tab 2: Opex Output',
    'Tab 3: Schedules',
  ],
  module4: [
    'Tab 1: Schedules',
    'Tab 2: Fixed Assets',
    'Tab 3: P&L',
    'Tab 4: Cash Flow',
    'Tab 5: Balance Sheet',
  ],
  module5: [
    'Tab 1: Returns',
    'Tab 2: RE Metrics',
    'Tab 3: Case Comparison',
    'Tab 4: Cash Flow Streams',
  ],
};
