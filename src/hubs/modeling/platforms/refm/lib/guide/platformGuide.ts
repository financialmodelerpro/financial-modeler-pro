/**
 * platformGuide.ts
 *
 * Auto-updating user walkthrough guide for the REFM platform. The DOCUMENT
 * STRUCTURE is derived from the live registries (the MODULES list +
 * MODULE_TABS map), so adding / renaming / reordering a module or tab flows
 * into the guide automatically: the guide lists exactly the modules + tabs the
 * platform ships. Per-tab step-by-step content lives in TAB_CONTENT below; a tab
 * with no content yet still appears (with its label), so a newly-added tab is
 * never silently missing. The verifier (verify-platform-guide.ts) enforces that
 * every module + tab is covered.
 *
 * Two serialisers ship: guideToMarkdown (download / read) and, in guidePdf.ts, a
 * PDF renderer. Both render the same GuideDoc, so the downloadable document and
 * the in-platform view never diverge.
 *
 * Pure: no React, no DOM. Takes the registries as input (dependency injection)
 * so it stays runnable in Node (verifier) without importing the client shell.
 *
 * Writing rule: NO em-dashes anywhere (project rule). Use commas, colons,
 * parentheses, or "and" / "or".
 */
import { FUNDING_METHOD_LABELS } from '../state/module1-types';

export interface GuideSection {
  id: string;
  title: string;
  paragraphs: string[];
  /** Ordered how-to steps, rendered as a numbered list. */
  steps?: string[];
  /** Unordered points, rendered as a bullet list. */
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

// ── Per-module intro, keyed by module key ────────────────────────────────────
const MODULE_BLURB: Record<string, string> = {
  module1: 'Define the project, its phases and assets, the development cost (capex), and how it is funded. Everything downstream is built on what you set here, so complete this module first.',
  module2: 'Project revenue for each asset by strategy: residential sales (pre and post handover), hospitality (ADR times occupancy), and leasing. Revenue feeds recognition, cash collection, cost of sales, and escrow.',
  module3: 'Build operating expenses per asset (and head-office overheads): fixed costs, per-unit or per-sqm costs, and percentage-of-revenue lines, with inflation and indexation.',
  module4: 'The full financial statements, composed automatically from Modules 1 to 3: Profit and Loss, Cash Flow (Direct and Indirect), and the Balance Sheet, plus the supporting schedules. The Balance Sheet balances by construction.',
  module5: 'Investment returns and valuation: IRR, MOIC and NPV on the project (unlevered), the equity (levered) and distributions, terminal value, real-estate KPIs, and scenario comparison.',
};

// ── Per-tab step-by-step content, keyed by "moduleKey/tabKey" ────────────────
// `intro` describes the surface, `steps` are the ordered how-to, `review` is
// what to look at (outputs). A tab with no entry still renders (label only), so
// a newly-added tab is never silently missing.
interface TabContent { intro: string; steps?: string[]; review?: string }
const TAB_CONTENT: Record<string, TabContent> = {
  'module1/project-phases': {
    intro: 'Start here. Define the project identity and lay out its phases, the timeline every other module is built on.',
    steps: [
      'Enter the project name, currency, location, and start date.',
      'Set the tax or zakat rate that the financial statements will apply.',
      'Add one phase per development stage. For each phase set the start date, the number of construction years, and the number of operations (income) years.',
      'If a phase is already running, set its status to Operational and record its existing baseline (opening cash, net book value, existing equity and debt) on the Financing tab, Existing Operations card.',
    ],
    review: 'the construction-end and operations-start and operations-end dates shown next to each phase; they drive when costs, revenue, and depreciation occur.',
  },
  'module1/assets': {
    intro: 'Describe what is being built in each phase.',
    steps: [
      'Add each asset to its phase and choose its strategy: Sell (residential for sale), Operate (hospitality), or Lease (income property).',
      'Set the asset areas (BUA, GFA) and, for land, the land area.',
      'Add sub-units under each asset: apartments or villas (units), hotel keys (units), or leasable space (area), each with a quantity and a unit price or ADR.',
    ],
    review: 'the area reconciliation, which shows how sub-units, support, and parking roll up to the asset BUA and GFA. Confirm it matches your intent before moving on.',
  },
  'module1/costs': {
    intro: 'Enter the development cost as cost lines, per asset.',
    steps: [
      'For each cost line choose a basis: a fixed lump sum, a rate times a quantity (for example per BUA sqm, per unit, or per parking bay), or a percentage of another total (construction, selected lines, land value, or revenue).',
      'Enter the rate or percentage. The platform multiplies it by the relevant quantity or base amount to compute the line total.',
      'Set the construction stage (land, hard, soft, operating) and the phasing, which spreads the cost across the construction years.',
    ],
    review: 'the Results sub-tab: the capex schedule by year, per cost line and per asset, with totals including land, excluding in-kind land, and excluding all land.',
  },
  'module1/financing': {
    intro: 'Decide how the project is funded.',
    steps: [
      'Choose a funding method and the debt and equity split, and set the minimum cash reserve to maintain.',
      'Add debt facilities (existing and new) with their interest rate, drawdown, and repayment terms.',
      'Record any existing-operations opening balances on the Existing Operations card.',
      'Set the dividend policy (payout ratio and start year) and, if used, the cash sweep that prepays debt from surplus cash.',
    ],
    review: 'the Schedules sub-tab (debt movement and finance cost per facility, plus equity), the Funding Gap sub-tab (the requirement under each method), and the Cash Sweep sub-tab (the full cash waterfall down to closing cash).',
  },
  'module2/m2-inputs': {
    intro: 'Set the revenue assumptions for each asset, grouped by strategy.',
    steps: [
      'For Sell assets, set the sales velocity (how many units or how much area sell each year, pre and post handover), the payment profile (when cash is collected), and the recognition profile (when revenue is recognised).',
      'For Operate (hospitality) assets, set the starting ADR, occupancy per year, and food-and-beverage and other revenue, with indexation.',
      'For Lease assets, set the base rent, occupancy, and rent indexation.',
    ],
    review: 'that each velocity sums to the asset total inventory; inputs group under their strategy with the phase shown as a tag.',
  },
  'module2/m2-revenue': {
    intro: 'The revenue output, computed from your inputs (read-only).',
    review: 'project and per-asset revenue by year, plus the cash-collection and recognition vintage matrices (cohort year by cash or recognition year, with a total line).',
  },
  'module2/m2-cost-of-sales': {
    intro: 'Cost of sales for residential sales, matched to revenue recognition (read-only).',
    review: 'the capex basis, the vintage matrix (with total), the construction-versus-operations split, and the inventory (work-in-progress) roll-forward, per asset.',
  },
  'module2/m2-schedules': {
    intro: 'The balance-sheet and cash-flow feeders that revenue produces (read-only).',
    review: 'receivables, unearned revenue, inventory, and cash collected, per asset.',
  },
  'module2/m2-escrow': {
    intro: 'Model the pre-sales escrow that holds a portion of customer advances until handover.',
    steps: [
      'Set the project held percentage and the default release year.',
      'Override the held percentage or release year per asset where the terms differ.',
    ],
    review: 'the pre-sales cash by asset, the escrow balance roll-forward, and the cash-flow impact.',
  },
  'module3/m3-inputs': {
    intro: 'Build operating expenses per operating asset and for head office.',
    steps: [
      'For each operating asset add opex lines and choose a mode: a fixed baseline, a per-unit or per-sqm cost, or a percentage of revenue.',
      'Set each line category (direct, indirect, management, or reserves) so costs group correctly in the statements.',
      'Set indexation per line, or inherit the asset default; use year-by-year rates where the escalation is not uniform.',
      'Enter head-office overheads once at the project level.',
    ],
    review: 'that every operating asset carries the cost lines you expect before checking the output.',
  },
  'module3/m3-output': {
    intro: 'The operating-expense output, computed from your inputs (read-only).',
    review: 'per operating asset, the revenue breakdown and the per-category cost tables, then the project total including head office.',
  },
  'module4/m4-schedules': {
    intro: 'The supporting schedules behind the statements (read-only).',
    review: 'fixed assets and depreciation, the capitalised-interest (IDC) pool, and working capital.',
  },
  'module4/m4-pl': {
    intro: 'The Profit and Loss statement, composed from Modules 1 to 3.',
    steps: [
      'Set the terminology (standard or Saudi) and the tax or zakat rate at the top.',
      'Use the phase buttons to view the consolidated project or a single phase.',
    ],
    review: 'the consolidated view runs to profit after tax; a single phase shows that phase down to EBITDA.',
  },
  'module4/m4-cashflow': {
    intro: 'The Cash Flow statement, in both Direct and Indirect form.',
    review: 'the consolidated view runs Operations, Investing, and Financing, and both methods end on the same net cash; a single phase shows its Operating and Investing activities.',
  },
  'module4/m4-balancesheet': {
    intro: 'The consolidated Balance Sheet, composed from every feeder schedule.',
    steps: [
      'Set the operating receivable days (DSO) and the statutory reserve inputs at the top.',
    ],
    review: 'the balance check should be near zero each year; the reconciliation bridge localises any imbalance by line.',
  },
  'module5/m5-returns': {
    intro: 'Headline investment returns and valuation.',
    steps: [
      'Set the discount rate, the exit year, and the terminal value method (exit multiple or perpetuity).',
    ],
    review: 'the headline returns (project, equity, and distributions), development economics, exit analysis, sources and uses, and the cash-flow streams.',
  },
  'module5/m5-metrics': {
    intro: 'Real-estate key performance indicators (read-only).',
    review: 'yield on cost, cap rate, DSCR and interest cover, LTV at exit, equity multiple, and cash-on-cash.',
  },
  'module5/m5-cases': {
    intro: 'Compare scenario cases side by side.',
    review: 'Management, Downside, Upside, and any custom case, with the key returns and their difference versus Management.',
  },
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
      'This platform builds an institutional-grade real estate financial model from the ground up. You describe the project and its costs, project revenue and operating expenses, and the platform composes the full financial statements, investment returns, and valuation automatically.',
      'Work flows module by module. Each module feeds the next, so once the inputs are in place the outputs (statements, returns, reports) stay in sync as you edit.',
    ],
    bullets: [
      'Inputs you control: project and phases, assets and sub-units, development cost, financing, revenue, and operating expenses.',
      'Outputs computed for you: cost of sales, escrow, fixed assets and depreciation, P&L, cash flow, balance sheet, and returns.',
    ],
  });

  sections.push({
    id: 'getting-started',
    title: 'Getting started',
    paragraphs: ['Create a project from the dashboard. A short wizard captures the essentials (name, location, currency, first phase); you can refine everything afterwards in Module 1. Then work through the modules in order.'],
    steps: [
      'Module 1: set up the project, phases, assets, cost lines, and financing.',
      'Module 2: enter revenue assumptions and review the revenue, cost-of-sales, and escrow outputs.',
      'Module 3: enter operating expenses and review the opex output.',
      'Module 4: review the financial statements (P&L, cash flow, balance sheet) that compose automatically.',
      'Module 5: set the return assumptions and review the returns, metrics, and case comparison.',
    ],
    bullets: [
      'Yellow or navy-tinted cells are inputs you edit; grey cells are calculated for you.',
      'Every results table leads with a prior-year column and a Total, then one column per project year.',
      'Use the left sidebar to move between modules, and the tabs at the top of each module to move between its surfaces.',
    ],
  });

  sections.push({
    id: 'modules',
    title: 'The modules, step by step',
    paragraphs: ['The platform is organised into the following modules. Each section below lists the tabs it contains, the steps to set up its inputs, and what to review in its outputs.'],
    children: modules.filter((m) => !m.disabled).map((m): GuideSection => {
      const tabs = moduleTabs[m.key] ?? [];
      return {
        id: m.key,
        title: `Module ${m.num}: ${m.longLabel}`,
        paragraphs: [`${statusWord(m.status)}.`, MODULE_BLURB[m.key] ?? `${m.longLabel}.`],
        children: tabs.map((t): GuideSection => {
          const c = TAB_CONTENT[`${m.key}/${t.key}`];
          const paragraphs = c ? [c.intro, ...(c.review ? [`What to review: ${c.review}`] : [])] : [];
          return { id: `${m.key}/${t.key}`, title: t.label, paragraphs, steps: c?.steps };
        }),
      };
    }),
  });

  sections.push({
    id: 'financing-cases',
    title: 'Financing methods and scenario cases',
    paragraphs: [
      'Financing supports several funding methods. Pick the one that matches how the project is funded:',
      'Scenario cases let you keep alternative assumptions alongside the base. The Management case is the base model; Downside and Upside (and any custom case) hold only the fields you change. Switch cases from the top bar. Viewing a case never changes your base, and a "different from Management" badge with a Reset appears on any input you override.',
    ],
    bullets: [
      `${FUNDING_METHOD_LABELS[1]}: fund the full development cost at the chosen debt and equity split.`,
      `${FUNDING_METHOD_LABELS[2]}: fund the net requirement after pre-sales advances.`,
      `${FUNDING_METHOD_LABELS[3]}: fund the period cash deficit to maintain the minimum cash reserve.`,
      `${FUNDING_METHOD_LABELS[4]}: fund a specified amount.`,
    ],
  });

  sections.push({
    id: 'reports',
    title: 'Reports, versions, and export',
    paragraphs: [
      'Save named versions as you work. Each version records what changed, and you can reload any earlier version. Editing starts a session automatically, and simply viewing a scenario case does not.',
      'Export a full PDF report from the Export button. The report mirrors every module tab (inputs, outputs, schedules) and is generated from your live model, so it always reflects the current numbers.',
    ],
    steps: [
      'Open Export and choose which modules and which parts (Inputs, Outputs, Schedules) to include.',
      'Choose the number scale (thousands or millions).',
      'Choose which saved version to export, or the current working draft; the file is named after the chosen version.',
    ],
    bullets: [
      'The PDF includes the executive summary, every module\'s tabs, and the per-phase financial statements.',
      'This guide can also be downloaded (PDF or Markdown) from the Guide button.',
    ],
  });

  return {
    title: 'Real Estate Financial Modeling',
    subtitle: 'Platform Walkthrough Guide',
    generatedNote: 'This guide is generated from the live platform configuration and updates automatically as modules, tabs, and features change.',
    sections,
  };
}

// ── Markdown serialiser ──────────────────────────────────────────────────────
function sectionToMarkdown(s: GuideSection, depth: number): string[] {
  const hashes = '#'.repeat(Math.min(6, depth));
  const out: string[] = [`${hashes} ${s.title}`, ''];
  for (const p of s.paragraphs) { out.push(p, ''); }
  if (s.steps?.length) { s.steps.forEach((st, i) => out.push(`${i + 1}. ${st}`)); out.push(''); }
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
