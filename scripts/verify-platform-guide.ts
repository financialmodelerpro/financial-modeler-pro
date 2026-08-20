/**
 * verify-platform-guide.ts (REWRITTEN 2026-08-20)
 *
 * THE GUIDE IS MEASURED AGAINST THE PLATFORM, NOT AGAINST A COPY OF IT.
 *
 * The previous version of this file kept its own frozen copy of the tab map
 * (four Module 1 tabs, modules 1 to 5 only) because the live MODULE_TABS lived
 * inside RealEstatePlatform.tsx, which imports a CSS module and cannot be
 * loaded under tsx. The copy is why this verifier reported 34/34 while the
 * live guide was missing Modules 6 and 7 entirely and had nothing for the
 * Parties and Fund Terms tabs: the guide was checked against the platform as
 * it stood when the copy was made. That is the mirrored-lists trap, and the
 * fix was structural: the registry moved to the pure lib/moduleTabs.ts, and
 * this file imports THE SAME MODULE the shell renders from.
 *
 * Also pinned: content currency. The platform changed a great deal and the
 * guide silently did not, so specific stale phrases are asserted ABSENT and
 * their replacements PRESENT. A currency check is a tripwire, not a proof,
 * but it is exactly the tripwire that was missing.
 *
 * Run: npx tsx scripts/verify-platform-guide.ts
 * No em dashes in this file.
 */
import fs from 'node:fs';
import path from 'node:path';
import { MODULES } from '../src/hubs/modeling/platforms/refm/lib/modules-config';
import { MODULE_TABS, GUIDE_MODULE_ORDER } from '../src/hubs/modeling/platforms/refm/lib/moduleTabs';
import { MODULE_INTRO, TAB_CONTENT, MODULE6_SURFACES } from '../src/hubs/modeling/platforms/refm/lib/guide/guideContent';
import { buildPlatformGuide, guideToMarkdown, type GuideSection } from '../src/hubs/modeling/platforms/refm/lib/guide/platformGuide';

let passed = 0;
const failures: string[] = [];
const check = (label: string, ok: boolean, detail = ''): void => {
  if (ok) { passed++; return; }
  failures.push(`${label}${detail ? `  [${detail}]` : ''}`);
};
const section = (t: string): void => console.log(`\n-- ${t} ${'-'.repeat(Math.max(0, 58 - t.length))}`);
const read = (rel: string): string => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
const stripComments = (src: string): string => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

function allSections(s: GuideSection[]): GuideSection[] {
  return s.flatMap((x) => [x, ...allSections(x.children ?? [])]);
}

const doc = buildPlatformGuide({ modules: MODULES, moduleTabs: MODULE_TABS });
const flat = allSections(doc.sections);
const byId = new Map(flat.map((s) => [s.id, s]));
const md = guideToMarkdown(doc, 'test');
const allText = flat.map((s) => [s.title, ...s.paragraphs, ...(s.steps ?? []), ...(s.bullets ?? [])].join(' ')).join(' ');

// ---------------------------------------------------------------------------
section('A. One tab registry, and the shell renders from it');

{
  // The registry must be the pure module, and RealEstatePlatform must
  // re-export it rather than keeping its own definitions. Restating the list
  // here would recreate the trap this rewrite removes, so the check is on the
  // RELATIONSHIP: no `export const mNTabs = [` remains in the shell.
  const shell = stripComments(read('src/hubs/modeling/platforms/refm/components/RealEstatePlatform.tsx'));
  check('A: the shell defines no tab array of its own', !/export const m\dTabs(:| =)/.test(shell));
  check('A: the shell imports the shared registry', shell.includes("from '../lib/moduleTabs'"));
  const sidebar = stripComments(read('src/hubs/modeling/platforms/refm/components/Sidebar.tsx'));
  check('A: Sidebar still reads MODULE_TABS', sidebar.includes('MODULE_TABS'));
  // Module 6 is a deliberate empty list, not an absent key.
  check('A: module6 is present in the registry as an empty list',
    Array.isArray(MODULE_TABS.module6) && MODULE_TABS.module6.length === 0);
  check('A: the canonical order is modules 1 to 7',
    GUIDE_MODULE_ORDER.join(',') === 'module1,module2,module3,module4,module5,module6,module7');
  // This verifier itself must not carry a copy.
  const self = stripComments(read('scripts/verify-platform-guide.ts'));
  check('A: this verifier keeps no frozen tab map of its own',
    !self.includes(['key: ', "'project-phases'", ', label:'].join('')));
}

// ---------------------------------------------------------------------------
section('B. Every live module and every tab has real content');

{
  for (const mk of GUIDE_MODULE_ORDER) {
    check(`B: ${mk} has a module intro`, (MODULE_INTRO[mk] ?? '').length > 80, String((MODULE_INTRO[mk] ?? '').length));
    const sec = byId.get(mk);
    check(`B: ${mk} renders as a section`, !!sec);
    // A module section whose entire content is its own name is the failure
    // mode this rebuild fixes ("Scenario Analysis." was the WHOLE Module 6).
    check(`B: ${mk} is more than its name`,
      !!sec && sec.paragraphs.join(' ').length > 100, String(sec?.paragraphs.join(' ').length ?? 0));
  }
  for (const [mk, tabs] of Object.entries(MODULE_TABS)) {
    for (const t of tabs) {
      const c = TAB_CONTENT[`${mk}/${t.key}`];
      check(`B: ${mk}/${t.key} has content`, !!c && c.intro.length > 40);
      const sec = byId.get(`${mk}/${t.key}`);
      check(`B: ${mk}/${t.key} renders with its content`, !!sec && sec.paragraphs.length > 0);
    }
  }
  // Module 6's surfaces stand in for its tabs.
  check('B: module6 declares its four surfaces', MODULE6_SURFACES.length === 4);
  for (const sf of MODULE6_SURFACES) {
    check(`B: ${sf.id} renders`, !!byId.get(sf.id));
    check(`B: ${sf.id} carries a real anchor`, sf.anchor.startsWith('m6-'));
  }
  // No orphans: content for a tab that no longer exists is stale by
  // definition and must be removed, not shipped.
  const liveKeys = new Set(Object.entries(MODULE_TABS).flatMap(([mk, tabs]) => tabs.map((t) => `${mk}/${t.key}`)));
  const orphans = Object.keys(TAB_CONTENT).filter((k) => !liveKeys.has(k));
  check('B: no content entry points at a tab that does not exist', orphans.length === 0, orphans.join(', '));
  // Getting started walks all seven.
  const gs = byId.get('getting-started');
  check('B: getting started covers all seven modules', (gs?.steps ?? []).length === 7);
}

// ---------------------------------------------------------------------------
section('C. The content is current, not a description of the old platform');

{
  // STALE, asserted absent. Each of these was live in the previous guide.
  check('C: the retired payment profile is gone', !/payment profile/i.test(allText));
  check('C: the four-stage list is gone', !allText.includes('land, hard, soft, operating'));
  check('C: no terminal method list stops at perpetuity', !/exit multiple or perpetuity\)/i.test(allText));

  // CURRENT, asserted present, each tied to a shipped change.
  const m2rev = JSON.stringify(TAB_CONTENT['module2/m2-revenue']);
  check('C: M2 describes the sale cohort terms', /downpayment/i.test(m2rev) && /instalment/i.test(m2rev));
  check('C: including the hard handover cut-off toggle', /cut-off/i.test(m2rev));
  check('C: and the cohort grid', /cohort grid/i.test(m2rev));
  check('C: and the project downpayment default with per-asset override', /default/i.test(m2rev) && /override/i.test(m2rev));
  check('C: recognition is stated at handover', /recognised at handover/i.test(m2rev));

  const m1costs = JSON.stringify(TAB_CONTENT['module1/costs']);
  check('C: the five cost stages include marketing', /marketing/.test(m1costs) && /land, hard, soft, marketing, or operating/.test(m1costs));
  check('C: the positional percent-of-selected rule is stated', /ABOVE it/.test(m1costs));
  check('C: the two derived phasing sources are stated', /land cash/.test(m1costs) && /collections/.test(m1costs));

  const m5 = JSON.stringify(TAB_CONTENT['module5/m5-returns']);
  check('C: the terminal methods include Exit Cap Rate', /Exit Cap Rate/.test(m5));
  check('C: FCFF is stated as unlevered full cost', /unlevered/i.test(m5) && /full cost/i.test(m5));

  const m3 = JSON.stringify(TAB_CONTENT['module3/m3-inputs']);
  check('C: M3 states the zero-seed contract', /zero/.test(m3) && /yours/.test(m3));

  const m1fin = JSON.stringify(TAB_CONTENT['module1/financing']);
  check('C: facility shares are stated as used as typed', /exactly as you type/i.test(m1fin));

  const m1pp = JSON.stringify(TAB_CONTENT['module1/project-phases']);
  check('C: the country select is described', /country/i.test(m1pp) && /terminology/i.test(m1pp));

  check('C: Parties and Fund Terms are no longer label-only',
    (TAB_CONTENT['module1/parties']?.intro ?? '').length > 60
    && (TAB_CONTENT['module1/fund-terms']?.steps ?? []).length >= 3);

  check('C: the M7 binding contract is stated', /binding/i.test(MODULE_INTRO.module7));

  // Writing rules hold in the rendered document.
  check('C: no em dash anywhere in the guide', !allText.includes(String.fromCharCode(8212)) && !md.includes(String.fromCharCode(8212)));
}

// ---------------------------------------------------------------------------
section('D. One content source: the guide file holds no prose of its own');

{
  const pg = stripComments(read('src/hubs/modeling/platforms/refm/lib/guide/platformGuide.ts'));
  check('D: platformGuide imports the shared content', pg.includes("from './guideContent'"));
  check('D: the old inline maps are gone',
    !pg.includes('const MODULE_BLURB') && !pg.includes('const TAB_CONTENT'));
  const modal = stripComments(read('src/hubs/modeling/platforms/refm/components/modals/PlatformGuideModal.tsx'));
  check('D: the overlay renders the doc and writes no tab prose',
    !modal.includes('cohort') && !modal.includes('capex') && modal.includes('doc.sections'));
}

// ---------------------------------------------------------------------------
section('E. The overlay is full screen, navigable, and searchable');

{
  const modal = stripComments(read('src/hubs/modeling/platforms/refm/components/modals/PlatformGuideModal.tsx'));
  check('E: full screen', modal.includes("position: 'fixed', inset: 0"));
  check('E: no width-capped dialog remains', !modal.includes(String.fromCharCode(39)+'90vh'+String.fromCharCode(39)));
  check('E: a stray backdrop click does not close it', !/inset: 0[^]{0,500}onClick={onClose}/.test(modal));
  check('E: Escape closes it', modal.includes("e.key === 'Escape'"));
  check('E: section navigation exists', modal.includes('guide-nav') && modal.includes('guide-jump-'));
  check('E: jumping scrolls to the section', modal.includes('scrollIntoView'));
  check('E: search exists and filters sections', modal.includes('guide-search') && modal.includes('function matches('));
  check('E: an empty search result says so', modal.includes('guide-search-empty'));
  check('E: the downloads and close keep their testids',
    modal.includes('guide-download-md') && modal.includes('guide-download-pdf') && modal.includes('platform-guide-close'));

  // LOCKED PALETTE: every colour in the overlay is a design token. A literal
  // hex or rgb() is drift by definition.
  const colourish = modal.match(/#[0-9a-fA-F]{3,8}\b|rgb\(/g) ?? [];
  check('E: no literal colour, tokens only', colourish.length === 0, colourish.slice(0, 4).join(', '));
  check('E: and the tokens are used', (modal.match(/var\(--color-/g) ?? []).length > 15);

  // The one consistent entry point survives.
  const topbar = stripComments(read('src/hubs/modeling/platforms/refm/components/Topbar.tsx'));
  check('E: the Topbar Guide button is the entry point', topbar.includes('topbar-open-guide'));
}

// ---------------------------------------------------------------------------
section('F. The serialisers still carry the whole document');

{
  const enabled = MODULES.filter((m) => !m.disabled);
  check('F: markdown lists every module long label', enabled.every((m) => md.includes(m.longLabel)));
  for (const [mk, tabs] of Object.entries(MODULE_TABS)) {
    for (const t of tabs) check(`F: markdown carries ${mk}/${t.key}`, md.includes(t.label));
  }
  for (const sf of MODULE6_SURFACES) check(`F: markdown carries ${sf.title}`, md.includes(sf.title));
  check('F: markdown is substantial', md.length > 12_000, String(md.length));
}

// ---------------------------------------------------------------------------
(async () => {
  section('G. The PDF renders the same doc');
  const { generateGuidePdf } = await import('../src/hubs/modeling/platforms/refm/lib/guide/guidePdf');
  const bytes = await generateGuidePdf(doc, 'test');
  check('G: pdf generates', bytes.length > 20_000, String(bytes.length));
  const { PDFDocument } = await import('pdf-lib');
  const pdf = await PDFDocument.load(bytes);
  check('G: pdf has enough pages for seven modules', pdf.getPageCount() >= 6, String(pdf.getPageCount()));

  console.log(`\n${'='.repeat(64)}`);
  if (failures.length === 0) {
    console.log(`verify-platform-guide: ${passed} passed, 0 failed`);
  } else {
    console.log(`verify-platform-guide: ${passed} passed, ${failures.length} FAILED`);
    for (const f of failures) console.log(`  FAIL  ${f}`);
    process.exit(1);
  }
})().catch((e) => { console.error(e); process.exit(1); });
