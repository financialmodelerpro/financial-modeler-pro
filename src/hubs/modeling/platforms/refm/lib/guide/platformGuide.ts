/**
 * platformGuide.ts
 *
 * Auto-updating user walkthrough guide for the REFM platform. The DOCUMENT
 * STRUCTURE is derived from the live registries (the MODULES list + the
 * MODULE_TABS map in lib/moduleTabs.ts), so adding / renaming / reordering a
 * module or tab flows into the guide automatically.
 *
 * ALL CONTENT lives in guideContent.ts, the one source the guide AND the
 * guided tour render from. This file only assembles it into a GuideDoc. The
 * content used to live inline here, which is how it silently lost Modules 6
 * and 7 and two Module 1 tabs while the verifier checked a frozen copy of the
 * tab map; see the headers of guideContent.ts and moduleTabs.ts.
 *
 * Three serialisers ship: the in-platform overlay, guideToMarkdown, and the
 * PDF in guidePdf.ts. All render the same GuideDoc, so the on-screen guide and
 * the downloadable documents never diverge.
 *
 * Pure: no React, no DOM. Takes the registries as input (dependency
 * injection) so it stays runnable in Node without importing the client shell.
 *
 * Writing rule: NO em-dashes anywhere (project rule).
 */
import { FUNDING_METHOD_LABELS } from '../state/module1-types';
import { MODULE_INTRO, TAB_CONTENT, MODULE6_SURFACES } from './guideContent';

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
      'This platform builds an institutional-grade real estate financial model from the ground up. You describe the project and its costs, project revenue and operating expenses, and the platform composes the full financial statements, investment returns, scenarios, and the IC presentation automatically.',
      'Work flows module by module. Each module feeds the next, so once the inputs are in place the outputs (statements, returns, reports) stay in sync as you edit.',
    ],
    bullets: [
      'Inputs you control: project and phases, parties, fund terms, assets and sub-units, development cost, financing, revenue and sale cohort terms, and operating expenses.',
      'Outputs computed for you: cost of sales, escrow, fixed assets and depreciation, P&L, cash flow, balance sheet, returns, and the presentation bindings.',
    ],
  });

  sections.push({
    id: 'getting-started',
    title: 'Getting started',
    paragraphs: ['Create a project from the dashboard. A short wizard captures the essentials (name, location, currency, first phase); you can refine everything afterwards in Module 1. Then work through the modules in order.'],
    steps: [
      'Module 1: set up the project, phases, parties, fund terms (optional), assets, cost lines, and financing.',
      'Module 2: enter revenue assumptions and the sale cohort terms, then review the revenue, cost-of-sales, and escrow outputs.',
      'Module 3: enter operating expenses (the seeded lines start at zero; the numbers are yours) and review the opex output.',
      'Module 4: review the financial statements (P&L, cash flow, balance sheet) that compose automatically.',
      'Module 5: set the return assumptions and review the returns, metrics, and case comparison.',
      'Module 6: build scenario cases over the base model and compare their outcomes.',
      'Module 7: assemble the IC presentation from live bindings and export it as PowerPoint or PDF.',
    ],
    bullets: [
      'Yellow or navy-tinted cells are inputs you edit; grey cells are calculated for you.',
      'Every results table leads with a prior-year column and a Total, then one column per project year.',
      'Use the left sidebar to move between modules, and the tabs at the top of each module to move between its surfaces.',
      'A project opens read-only until you click Edit; locked inputs are visibly dashed, and the Guide button in the top bar opens this guide from anywhere.',
    ],
  });

  sections.push({
    id: 'modules',
    title: 'The modules, step by step',
    paragraphs: ['The platform is organised into the following modules. Each section below lists the tabs it contains, the steps to set up its inputs, and what to review in its outputs.'],
    children: modules.filter((m) => !m.disabled).map((m): GuideSection => {
      const tabs = moduleTabs[m.key] ?? [];
      // A module with no sidebar sub-tabs (Module 6) takes its children from
      // its declared surfaces, so a one-page module still gets a full section
      // per thing on that page.
      const children: GuideSection[] = tabs.length > 0
        ? tabs.map((t): GuideSection => {
          const c = TAB_CONTENT[`${m.key}/${t.key}`];
          const paragraphs = c ? [c.intro, ...(c.review ? [`What to review: ${c.review}`] : [])] : [];
          return { id: `${m.key}/${t.key}`, title: t.label, paragraphs, steps: c?.steps };
        })
        : m.key === 'module6'
          ? MODULE6_SURFACES.map((sf): GuideSection => ({ id: sf.id, title: sf.title, paragraphs: [sf.body] }))
          : [];
      return {
        id: m.key,
        title: `Module ${m.num}: ${m.longLabel}`,
        paragraphs: [`${statusWord(m.status)}.`, MODULE_INTRO[m.key] ?? `${m.longLabel}.`],
        children,
      };
    }),
  });

  sections.push({
    id: 'financing-cases',
    title: 'Financing methods and scenario cases',
    paragraphs: [
      'Financing supports several funding methods. Pick the one that matches how the project is funded:',
      'Scenario cases let you keep alternative assumptions alongside the base. The Management case is the base model; Downside and Upside (and any custom case) hold only the fields you change. Switch cases from the top bar or in Module 6. Viewing a case never changes your base, and a "different from Management" badge with a Reset appears on any input you override.',
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
      'Export from the Export button: a full PDF report mirroring every module tab, a concise summary PDF, or the Excel model workbook (a formatted snapshot of every module; edited cells do not recalculate, re-export after changing inputs). The IC deck exports separately from Module 7 as PowerPoint or PDF. Available formats follow your plan.',
    ],
    steps: [
      'Open Export and choose the report: full PDF, summary PDF, or the Excel workbook.',
      'Choose which modules and which parts (Inputs, Outputs, Schedules) to include, and the number scale (thousands or millions).',
      'Choose which saved version to export, or the current working draft; the file is named after the chosen version.',
    ],
    bullets: [
      'The PDF includes the executive summary, every module\'s tabs, and the per-phase financial statements.',
      'This guide can also be downloaded (PDF or Markdown) from the Guide button, and the guided tour can be restarted from inside the guide.',
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
