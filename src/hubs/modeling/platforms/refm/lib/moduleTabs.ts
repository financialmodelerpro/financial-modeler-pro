/**
 * moduleTabs.ts (2026-08-20)
 *
 * THE ONE TAB REGISTRY, as a pure module.
 *
 * These arrays lived inside RealEstatePlatform.tsx, which imports a CSS module
 * and therefore cannot be loaded under tsx. The guide verifier worked around
 * that by keeping its own FROZEN COPY of this map, and the copy is why the
 * verifier reported 34/34 while the live guide was missing two whole modules
 * and two Module 1 tabs: the guide was being checked against a snapshot of the
 * platform as it stood when the copy was made, not against the platform.
 *
 * Moving the registry here kills the copy. The shell, the guide, the tour and
 * the verifier now all import THIS module, so a tab added to the platform is a
 * tab the guide is measured against, the same day.
 *
 * RealEstatePlatform re-exports everything here, so its existing importers
 * (Sidebar) are untouched.
 *
 * No em dashes in this file.
 */

export type SidebarSubTab = { key: string; icon: string; label: string; step: number };

// Module 1 tabs. Fund Terms (fund layer Step 2, 2026-08-03) sits at 3,
// directly after Parties, because its fee share is split by PARTY ROLE and
// reads better once the roles are in front of the user.
export const m1Tabs: ReadonlyArray<SidebarSubTab> = [
  { key: 'project-phases', icon: '📅', label: '1. Project & Phases', step: 1 },
  { key: 'parties', icon: '🤝', label: '2. Parties', step: 2 },
  { key: 'fund-terms', icon: '🏛️', label: '3. Fund Terms', step: 3 },
  { key: 'assets', icon: '🏗️', label: '4. Assets & Sub-units', step: 4 },
  { key: 'costs', icon: '💸', label: '5. Capex', step: 5 },
  { key: 'financing', icon: '🏦', label: '6. Financing', step: 6 },
];

// Module 2 tabs (M2 Pass 9h): Inputs is the editable surface; the other four
// are read-only outputs driven by the revenue engine.
export const m2Tabs: ReadonlyArray<SidebarSubTab> = [
  { key: 'm2-inputs', icon: '📝', label: '1. Inputs', step: 1 },
  { key: 'm2-revenue', icon: '💰', label: '2. Revenue', step: 2 },
  { key: 'm2-cost-of-sales', icon: '🧾', label: '3. Cost of Sales', step: 3 },
  { key: 'm2-schedules', icon: '📑', label: '4. Schedules', step: 4 },
  { key: 'm2-escrow', icon: '🔒', label: '5. Escrow', step: 5 },
];

// Module 3 tabs: the per-asset line editor + HQ overheads, then the read-only
// engine output.
export const m3Tabs: ReadonlyArray<SidebarSubTab> = [
  { key: 'm3-inputs', icon: '📝', label: '1. Inputs', step: 1 },
  { key: 'm3-output', icon: '📊', label: '2. Opex Output', step: 2 },
];

// Module 4 tabs (Financial Statements).
export const m4Tabs: ReadonlyArray<SidebarSubTab> = [
  { key: 'm4-schedules', icon: '📑', label: '1. Schedules', step: 1 },
  { key: 'm4-pl', icon: '📈', label: '2. P&L', step: 2 },
  { key: 'm4-cashflow', icon: '💵', label: '3. Cash Flow', step: 3 },
  { key: 'm4-balancesheet', icon: '⚖️', label: '4. Balance Sheet', step: 4 },
];

// Module 5 tabs (Returns and Valuation).
export const m5Tabs: ReadonlyArray<SidebarSubTab> = [
  { key: 'm5-returns', icon: '📈', label: '1. Returns', step: 1 },
  { key: 'm5-metrics', icon: '🏷️', label: '2. RE Metrics', step: 2 },
  { key: 'm5-cases', icon: '🔀', label: '3. Case Comparison', step: 3 },
];

// Module 7 is a single full-screen surface (the IC Presentation Builder), so
// it has one nominal tab. The tab row is not rendered; the builder has its
// own shell.
export const m7Tabs: ReadonlyArray<SidebarSubTab> = [
  { key: 'm7-ic', icon: '📊', label: 'Presentation', step: 1 },
];

/**
 * Universal module -> sub-tabs map. Sidebar.tsx reads this instead of
 * hard-coding per-module branches.
 *
 * MODULE 6 IS DELIBERATELY AN EMPTY ARRAY, not an absent key. Scenario
 * Analysis is one page of stacked sections (case list, assumptions grid,
 * comparison matrix, year-on-year impact) with no sidebar sub-tabs, and the
 * empty array SAYS that, where an absent key is indistinguishable from a
 * module somebody forgot. The guide and the tour treat an empty list as "one
 * surface, described at module level".
 */
export const MODULE_TABS: Record<string, ReadonlyArray<SidebarSubTab>> = {
  module1: m1Tabs,
  module2: m2Tabs,
  module3: m3Tabs,
  module4: m4Tabs,
  module5: m5Tabs,
  module6: [],
  module7: m7Tabs,
};

/** The modules the guide and the tour walk, in canonical order. */
export const GUIDE_MODULE_ORDER = ['module1', 'module2', 'module3', 'module4', 'module5', 'module6', 'module7'] as const;
