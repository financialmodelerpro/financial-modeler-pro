/**
 * platformGuide.ts
 *
 * Auto-updating user walkthrough guide for the REFM platform. The DOCUMENT
 * STRUCTURE is derived from the live registries (the MODULES list +
 * MODULE_TABS map), so adding / renaming / reordering a module or tab flows
 * into the guide automatically: the guide lists exactly the modules + tabs the
 * platform ships. Per-module / per-tab prose lives in CONTENT below; a tab with
 * no prose yet still appears (with its label), so a newly-added tab is never
 * silently missing. The verifier (verify-platform-guide.ts) enforces that every
 * module + tab is covered.
 *
 * Two serialisers ship: `guideToMarkdown` (download / read) and, in
 * guidePdf.ts, a PDF renderer. Both render the same GuideDoc, so the
 * downloadable document and the in-platform view never diverge.
 *
 * Pure: no React, no DOM. Takes the registries as input (dependency injection)
 * so it stays runnable in Node (verifier) without importing the client shell.
 */
import { FUNDING_METHOD_LABELS } from '../state/module1-types';

export interface GuideSection {
  id: string;
  title: string;
  paragraphs: string[];
  bullets?: string[];
  children?: GuideSection[];
}
export interface GuideDoc {
  title: string;
  subtitle: string;
  /** One-line note explaining the guide is generated + auto-updates. */
  generatedNote: string;
  sections: GuideSection[];
}

export interface GuideModule { num: number; key: string; longLabel: string; shortLabel: string; status: string; disabled?: boolean }
export interface GuideTab { key: string; label: string }
export interface BuildGuideInput {
  modules: ReadonlyArray<GuideModule>;
  moduleTabs: Record<string, ReadonlyArray<GuideTab>>;
  /** Optional human date label (the caller stamps it; pure builder takes no clock). */
  dateLabel?: string;
}

// ── Curated prose, keyed by module key and "moduleKey/tabKey" ────────────────
// Adding a module/tab without an entry here still renders (label only). Keep
// entries short + user-facing (what the user does on that surface).
const MODULE_BLURB: Record<string, string> = {
  module1: 'Define the project, its phases and assets, the development cost (capex), and how it is funded (equity + debt). Everything downstream builds on what you set here.',
  module2: 'Project revenue for each asset by strategy: residential sales (pre/post handover), hospitality (ADR x occupancy), and leasing. Revenue feeds recognition, cash collection, cost of sales, and escrow.',
  module3: 'Build operating expenses per asset (and head-office overheads): fixed costs, per-unit/per-sqm costs, and percentage-of-revenue lines, with inflation/indexation.',
  module4: 'The full financial statements, composed automatically from Modules 1-3: Profit & Loss, Cash Flow (Direct + Indirect), and the Balance Sheet, plus the supporting schedules. The Balance Sheet balances by construction.',
  module5: 'Investment returns and valuation: IRR / MOIC / NPV on the project (unlevered), the equity (levered) and distributions, terminal value, real-estate KPIs, and scenario comparison.',
};
const TAB_BLURB: Record<string, string> = {
  'module1/project-phases': 'Name the project, set the currency / location / start date, and lay out the phases (construction + operations years). Existing operations are entered here as a historical baseline.',
  'module1/assets': 'Add the assets in each phase and their sub-units (apartments, hotel keys, leasable area), with areas, unit counts, and pricing.',
  'module1/costs': 'Enter the development cost as cost lines, per asset. A line is either a fixed lump sum or a rate x a quantity (e.g. per BUA sqm, per unit). The Results sub-tab shows the capex schedule by year.',
  'module1/financing': 'Choose the funding method, the debt / equity split, the minimum cash reserve, and the debt facilities. Sub-tabs cover the funding schedules, the funding gap, and the cash sweep (debt prepayment + dividends).',
  'module2/m2-inputs': 'Per-asset revenue assumptions, grouped by strategy. Set sales velocity + payment/recognition profiles for residential, ADR + occupancy for hospitality, and base rent + occupancy for leasing.',
  'module2/m2-revenue': 'The revenue output: per-asset and project revenue by year, plus the cash-collection and recognition vintage matrices.',
  'module2/m2-cost-of-sales': 'Cost of sales for residential sales, matched to revenue recognition, with the vintage matrix and the inventory (work-in-progress) roll-forward.',
  'module2/m2-schedules': 'The balance-sheet + cash-flow feeders from revenue: receivables, unearned revenue, inventory, and cash collected, per asset.',
  'module2/m2-escrow': 'Pre-sales escrow: the portion of customer advances held in escrow until handover, the balance roll-forward, and the cash-flow impact.',
  'module3/m3-inputs': 'The per-asset opex line editor (plus head-office overheads): mode, value, category, and indexation per line.',
  'module3/m3-output': 'The opex output: a revenue breakdown and per-category cost tables per operating asset, then the project total including head-office.',
  'module4/m4-schedules': 'The supporting schedules: fixed assets + depreciation, the IDC (capitalised interest) pool, and working capital.',
  'module4/m4-pl': 'The Profit & Loss. The consolidated view runs to profit after tax; selecting a single phase shows that phase to EBITDA.',
  'module4/m4-cashflow': 'The Cash Flow statement, Direct and Indirect. The consolidated view runs Operations + Investing + Financing; a single phase shows its Operating + Investing activities.',
  'module4/m4-balancesheet': 'The consolidated Balance Sheet with a balance check and a per-line reconciliation bridge that localises any imbalance.',
  'module5/m5-returns': 'Headline returns (project / equity / distributions), the development economics, exit analysis, sources & uses, and the cash-flow streams.',
  'module5/m5-metrics': 'Real-estate KPIs: yield on cost, cap rate, DSCR / interest cover, LTV at exit, equity multiple, and cash-on-cash.',
  'module5/m5-cases': 'Compare scenario cases (Management / Downside / Upside / custom) side by side, with the key returns and their delta vs Management.',
};

function statusWord(status: string): string {
  switch (status) {
    case 'done': return 'Available';
    case 'wip': return 'Available';
    case 'soon': return 'Coming soon';
    case 'pro': return 'Professional plan';
    case 'enterprise': return 'Enterprise plan';
    default: return status;
  }
}

export function buildPlatformGuide(input: BuildGuideInput): GuideDoc {
  const { modules, moduleTabs } = input;
  const sections: GuideSection[] = [];

  sections.push({
    id: 'overview',
    title: 'Overview',
    paragraphs: [
      'This platform builds an institutional-grade real estate financial model from the ground up: you describe the project and its costs, project revenue and operating expenses, and the platform composes the full financial statements, investment returns and valuation automatically.',
      'Work flows module by module. Each module feeds the next, so once the inputs are in place the outputs (statements, returns, reports) stay in sync as you edit.',
    ],
    bullets: [
      'Inputs you control: project + phases, assets + sub-units, development cost, financing, revenue, and operating expenses.',
      'Outputs computed for you: cost of sales, escrow, fixed assets + depreciation, P&L, cash flow, balance sheet, and returns.',
    ],
  });

  sections.push({
    id: 'getting-started',
    title: 'Getting started',
    paragraphs: [
      'Create a project from the dashboard. A short wizard captures the essentials (name, location, currency, first phase); you can refine everything afterwards in Module 1.',
      'Use the left sidebar to move between modules, and the tabs at the top of each module to move between its surfaces. Inputs are highlighted; computed outputs are read-only.',
    ],
    bullets: [
      'Yellow / navy-tinted cells are inputs you edit; grey cells are calculated for you.',
      'Every results table leads with a prior-year column and a Total, then one column per project year.',
    ],
  });

  sections.push({
    id: 'modules',
    title: 'The modules',
    paragraphs: ['The platform is organised into the following modules. Each lists the tabs it contains and what you do on each.'],
    children: modules.filter((m) => !m.disabled).map((m): GuideSection => {
      const tabs = moduleTabs[m.key] ?? [];
      return {
        id: m.key,
        title: `Module ${m.num}: ${m.longLabel}`,
        paragraphs: [
          `${statusWord(m.status)}.`,
          MODULE_BLURB[m.key] ?? `${m.longLabel}.`,
        ],
        bullets: tabs.map((t) => {
          const blurb = TAB_BLURB[`${m.key}/${t.key}`];
          return blurb ? `${t.label} — ${blurb}` : t.label;
        }),
      };
    }),
  });

  sections.push({
    id: 'financing-cases',
    title: 'Financing methods & scenario cases',
    paragraphs: [
      'Financing supports several funding methods; pick the one that matches how the project is funded:',
      'Scenario cases let you keep alternative assumptions alongside the base. The Management case is the base model; Downside / Upside (and any custom case) hold only the fields you change. Switch cases from the top bar; viewing a case never changes your base, and a "different from Management" badge with a Reset appears on any input you override.',
    ],
    bullets: [
      `${FUNDING_METHOD_LABELS[1]} — fund the full development cost at the chosen debt/equity split.`,
      `${FUNDING_METHOD_LABELS[2]} — fund the net requirement after pre-sales advances.`,
      `${FUNDING_METHOD_LABELS[3]} — fund the period cash deficit to maintain the minimum cash reserve.`,
      `${FUNDING_METHOD_LABELS[4]} — fund a specified amount.`,
    ],
  });

  sections.push({
    id: 'reports',
    title: 'Reports, versions & export',
    paragraphs: [
      'Save named versions as you work; each version records what changed, and you can reload any earlier version. Editing starts a session automatically, and simply viewing a scenario case does not.',
      'Export a full PDF report from the Export button. The report mirrors every module tab (inputs, outputs, schedules) and is generated from your live model, so it always reflects the current numbers. Choose which modules and parts to include, the number scale, and which saved version to export — the file is named after that version.',
    ],
    bullets: [
      'The PDF includes the executive summary, every module\'s tabs, and the per-phase financial statements.',
      'Pick "current working draft" or any saved version to export.',
    ],
  });

  return {
    title: 'Real Estate Financial Modeling',
    subtitle: 'Platform Walkthrough Guide',
    generatedNote: 'This guide is generated from the live platform configuration and updates automatically as modules, tabs and features change.',
    sections,
  };
}

// ── Markdown serialiser ──────────────────────────────────────────────────────
function sectionToMarkdown(s: GuideSection, depth: number): string[] {
  const hashes = '#'.repeat(Math.min(6, depth));
  const out: string[] = [`${hashes} ${s.title}`, ''];
  for (const p of s.paragraphs) { out.push(p, ''); }
  if (s.bullets?.length) { for (const b of s.bullets) out.push(`- ${b}`); out.push(''); }
  for (const c of s.children ?? []) out.push(...sectionToMarkdown(c, depth + 1));
  return out;
}

export function guideToMarkdown(doc: GuideDoc, dateLabel?: string): string {
  const out: string[] = [`# ${doc.title}`, `## ${doc.subtitle}`, ''];
  if (dateLabel) out.push(`_Updated ${dateLabel}._`, '');
  out.push(`_${doc.generatedNote}_`, '');
  for (const s of doc.sections) out.push(...sectionToMarkdown(s, 2));
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}
