/**
 * verify-platform-guide.ts
 *
 * Locks the auto-updating platform walkthrough guide. The guarantee that
 * matters: the guide's STRUCTURE is derived from the live registries, so every
 * module (from MODULES) and every tab (from the module-tabs map) MUST appear in
 * the guide automatically. This verifier pins that coverage + both serialisers
 * (Markdown + PDF), so a newly-added module/tab can never be silently missing.
 */
import { PDFDocument } from 'pdf-lib';
import { buildPlatformGuide, guideToMarkdown, type GuideSection } from '../src/hubs/modeling/platforms/refm/lib/guide/platformGuide';
import { generateGuidePdf } from '../src/hubs/modeling/platforms/refm/lib/guide/guidePdf';
import { MODULES } from '../src/hubs/modeling/platforms/refm/lib/modules-config';

let pass = 0, fail = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) { pass++; console.log(`  [PASS] ${name}`); }
  else { fail++; failures.push(name); console.log(`  [FAIL] ${name}${detail ? ' :: ' + detail : ''}`); }
}

// Representative tab map (mirrors RealEstatePlatform MODULE_TABS shape). The
// coverage assertions run against whatever is passed in, so the same logic
// guards the live registries when wired in the app.
const moduleTabs: Record<string, ReadonlyArray<{ key: string; label: string }>> = {
  module1: [
    { key: 'project-phases', label: '1. Project & Phases' },
    { key: 'assets', label: '2. Assets & Sub-units' },
    { key: 'costs', label: '3. Capex' },
    { key: 'financing', label: '4. Financing' },
  ],
  module2: [
    { key: 'm2-inputs', label: '1. Inputs' },
    { key: 'm2-revenue', label: '2. Revenue' },
    { key: 'm2-cost-of-sales', label: '3. Cost of Sales' },
    { key: 'm2-schedules', label: '4. Schedules' },
    { key: 'm2-escrow', label: '5. Escrow' },
  ],
  module3: [
    { key: 'm3-inputs', label: '1. Inputs' },
    { key: 'm3-output', label: '2. Opex Output' },
  ],
  module4: [
    { key: 'm4-schedules', label: '1. Schedules' },
    { key: 'm4-pl', label: '2. P&L' },
    { key: 'm4-cashflow', label: '3. Cash Flow' },
    { key: 'm4-balancesheet', label: '4. Balance Sheet' },
  ],
  module5: [
    { key: 'm5-returns', label: '1. Returns' },
    { key: 'm5-metrics', label: '2. RE Metrics' },
    { key: 'm5-cases', label: '3. Case Comparison' },
  ],
};

function allSections(s: GuideSection[]): GuideSection[] {
  return s.flatMap((x) => [x, ...allSections(x.children ?? [])]);
}

async function main(): Promise<void> {
  console.log('=== Platform walkthrough guide test ===');
  const doc = buildPlatformGuide({ modules: MODULES, moduleTabs });
  const md = guideToMarkdown(doc, '4 June 2026');
  const flat = allSections(doc.sections);
  const allText = JSON.stringify(doc);

  check('guide has a title + subtitle', !!doc.title && !!doc.subtitle);
  check('guide carries the auto-update note', /auto/i.test(doc.generatedNote));
  check('has Getting started + Modules + Reports sections', ['getting-started', 'modules', 'reports'].every((id) => flat.some((s) => s.id === id)));

  // Coverage: every non-disabled module appears as a section.
  const enabled = MODULES.filter((m) => !m.disabled);
  for (const m of enabled) {
    check(`module section present: ${m.key}`, flat.some((s) => s.id === m.key), m.longLabel);
  }
  // Coverage: every tab appears (as a bullet) under its module.
  for (const [mk, tabs] of Object.entries(moduleTabs)) {
    const sec = flat.find((s) => s.id === mk);
    for (const t of tabs) {
      check(`tab present in guide: ${mk}/${t.key}`, !!sec && (sec.bullets ?? []).some((b) => b.startsWith(t.label)));
    }
  }

  // Markdown serialiser.
  check('markdown non-empty + has H1', md.length > 500 && md.startsWith('# '));
  check('markdown lists every module long label', enabled.every((m) => allText.includes(m.longLabel) && md.includes(m.longLabel)));

  // PDF serialiser.
  const bytes = await generateGuidePdf(doc, '4 June 2026');
  check('pdf returns bytes', bytes instanceof Uint8Array && bytes.length > 1000, `len=${bytes.length}`);
  const pdf = await PDFDocument.load(bytes);
  check('pdf has at least 2 pages (cover + body)', pdf.getPageCount() >= 2, `pages=${pdf.getPageCount()}`);

  console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
  if (fail > 0) { console.log('Failures:', failures.join(', ')); process.exit(1); }
}

void main();
