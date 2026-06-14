/**
 * modules-config.ts
 *
 * Single source of truth for the 11 REFM modules. Both the Sidebar nav
 * (in RealEstatePlatform.tsx) and the Dashboard "Module Roadmap" panel
 * (in Dashboard.tsx) read from here so that adding/renaming/reordering a
 * module never requires editing two parallel hardcoded lists.
 *
 * `shortLabel` is what the Sidebar shows ("Module 1 - Setup") because the
 * sidebar rail is narrow. `longLabel` is what the Dashboard roadmap shows
 * ("Project Setup & Financial Structure") because that surface has the
 * horizontal room and benefits from the descriptive name.
 *
 * `status` summarises both the implementation state AND the plan gating in
 * a single field so consumers can render the right pill (DONE / SOON /
 * PRO / ENTERPRISE) without re-deriving.
 */

export type ModuleStatus = 'done' | 'wip' | 'soon' | 'pro' | 'enterprise';

export type ModulePlan = 'free' | 'professional' | 'enterprise';

export interface ModuleConfig {
  num: number;                  // 1..11
  key: string;                  // 'module1'..'module11'
  icon: string;
  shortLabel: string;           // Sidebar, narrow rail
  longLabel: string;            // Dashboard roadmap, wide row
  featureKey: string;           // 'module_1'..'module_11', for feature gating
  requiredPlan: ModulePlan;
  status: ModuleStatus;
  disabled: boolean;
  disabledReason?: string;
  /** Planned-content bullets for modules not yet built. Rendered on the PDF
   *  placeholder page so the exported report covers the whole platform roadmap,
   *  filling in real content automatically as each module ships. */
  plannedContent?: string[];
}

export const MODULES: readonly ModuleConfig[] = [
  {
    num: 1,
    key: 'module1',
    icon: '🧱',
    shortLabel: 'Setup',
    longLabel: 'Project Setup & Financial Structure',
    featureKey: 'module_1',
    requiredPlan: 'free',
    status: 'done',
    disabled: false,
  },
  {
    num: 2,
    key: 'module2',
    icon: '💰',
    shortLabel: 'Revenue',
    longLabel: 'Revenue & Sales Projections',
    featureKey: 'module_2',
    requiredPlan: 'free',
    status: 'wip',
    disabled: false,
  },
  {
    num: 3,
    key: 'module3',
    icon: '📉',
    shortLabel: 'OpEx',
    longLabel: 'Operating Expenses',
    featureKey: 'module_3',
    requiredPlan: 'free',
    status: 'wip',
    disabled: false,
  },
  {
    num: 4,
    key: 'module4',
    icon: '📑',
    shortLabel: 'Financials',
    longLabel: 'Financial Statements',
    featureKey: 'module_4',
    requiredPlan: 'free',
    status: 'wip',
    disabled: false,
  },
  {
    num: 5,
    key: 'module5',
    icon: '📈',
    shortLabel: 'Returns',
    longLabel: 'Returns & Valuation Analysis',
    featureKey: 'module_5',
    requiredPlan: 'free',
    status: 'wip',
    disabled: false,
  },
  {
    num: 6,
    key: 'module6',
    icon: '🔀',
    shortLabel: 'Scenarios',
    longLabel: 'Scenario Analysis',
    featureKey: 'module_6',
    requiredPlan: 'free',
    status: 'done',
    disabled: false,
  },
  {
    num: 7,
    key: 'module7',
    icon: '📊',
    shortLabel: 'Reports',
    longLabel: 'Reports & Visualizations',
    featureKey: 'module_7',
    requiredPlan: 'free',
    status: 'soon',
    disabled: true,
    disabledReason: 'Coming soon',
    plannedContent: [
      'Configurable dashboards across every module',
      'Charts: revenue, cash flow, capital structure, returns',
      'Sensitivity tornado + waterfall visuals',
      'Export-ready visual report packs',
    ],
  },
  {
    num: 8,
    key: 'module8',
    icon: '🏙️',
    shortLabel: 'Portfolio',
    longLabel: 'Portfolio',
    featureKey: 'module_8',
    requiredPlan: 'free',
    status: 'soon',
    disabled: true,
    disabledReason: 'Coming soon',
    plannedContent: [
      'Cross-project roll-up of multiple developments',
      'Aggregate returns, cash flows and capital needs',
      'Capital allocation + funding timeline view',
      'Portfolio-level KPIs and concentration analysis',
    ],
  },
  {
    num: 9,
    key: 'module9',
    icon: '📡',
    shortLabel: 'Market Data',
    longLabel: 'Market Data',
    featureKey: 'module_9',
    requiredPlan: 'free',
    status: 'soon',
    disabled: true,
    disabledReason: 'Coming soon',
    plannedContent: [
      'Comparable transactions feed',
      'Benchmark cap rates, rents and sale prices',
      'Construction cost indices',
      'Location and demand analytics',
    ],
  },
  {
    num: 10,
    key: 'module10',
    icon: '🤝',
    shortLabel: 'Collaborate',
    longLabel: 'Collaborate',
    featureKey: 'module_10',
    requiredPlan: 'professional',
    status: 'pro',
    disabled: true,
    disabledReason: 'Requires Professional plan',
    plannedContent: [
      'Shared project access for teams',
      'Comments and review workflow',
      'Role-based permissions',
      'Change notifications and activity log',
    ],
  },
  {
    num: 11,
    key: 'module11',
    icon: '🔌',
    shortLabel: 'API Access',
    longLabel: 'API Access',
    featureKey: 'module_11',
    requiredPlan: 'enterprise',
    status: 'enterprise',
    disabled: true,
    disabledReason: 'Requires Enterprise plan',
    plannedContent: [
      'Programmatic access to models and outputs',
      'REST endpoints for inputs and results',
      'Automated, scheduled exports',
      'Webhooks for downstream integrations',
    ],
  },
];
