/* eslint-disable @typescript-eslint/no-explicit-any, no-console */
/**
 * verify-report-readability.ts
 *
 * Pass 2 of the PDF export review: the report has to be READABLE at every
 * display scale it offers, not only at the one it was tuned for.
 *
 *   D1  no numeric cell is ellipsised, at ANY scale. The period column was a
 *       52pt constant; a full-unit export needed 71.5pt, so 3,867 cells in a
 *       real 14-year report were truncated ("323,870,..."). Columns are now
 *       sized to the widest cell the document actually draws.
 *   D2  per-unit rates (unit price, ADR, rate per sqm) do not follow the export
 *       scale, deliberately: an ADR of 268 would render "0.0" in a millions
 *       export, which destroys the figure rather than scaling it. So they must
 *       carry their unit instead of sitting unlabelled under a header band that
 *       says "All figures in SAR millions".
 *   E   no LABEL is ellipsised either. Labels auto-shrink to 6.5pt before they
 *       truncate, because a cut label loses the thing it was added to say (the
 *       fund fee labels were cut exactly at the base amount).
 *   G4  nothing prints a signed zero. A residue that rounds to zero at the
 *       displayed precision now renders the same en-dash an exact zero does.
 *
 * Run: npx tsx scripts/verify-report-readability.ts
 *
 * No em dashes in this file.
 */
import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';
import { pdfText } from './pdfTextExtract';
import { generateProjectPdf, generateSummaryPdf } from '../src/hubs/modeling/platforms/refm/lib/pdf/generateProjectPdf';
import { buildExcelSampleState } from './excelSampleState';

for (const f of ['.env.local', '.env']) {
  try {
    for (const l of readFileSync(f, 'utf8').split('\n')) {
      const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(l.trim());
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* optional */ }
}

let pass = 0, fail = 0;
const failures: string[] = [];
const check = (name: string, cond: boolean, detail = ''): void => {
  if (cond) { pass++; console.log(`  [PASS] ${name}`); }
  else { fail++; failures.push(name); console.log(`  [FAIL] ${name}${detail ? ' :: ' + detail : ''}`); }
};

const PUA: Record<string, string> = {
  '\uE081': '(', '\uE082': ')', '\uE083': '[', '\uE084': ']', '\uE088': '-', '\uE092': ':',
};
const decode = (b: Uint8Array): string => pdfText(b).replace(/[\uE000-\uF8FF]/g, (c) => PUA[c] ?? '?');

const rateUnitFor = (cur: string, per = 'unit'): string => `(${cur}/${per})`;

const PID = '1daa9217-d2b8-4b22-acbf-18fed79adeff';
const MODULE_KEYS = ['module1', 'module2', 'module3', 'module4', 'module5', 'module6'];
const SCALES = ['millions', 'thousands', 'full'] as const;
const FUND_TERMS = {
  enabled: true, fundSize: 0, fundSizeOverride: false, facilityLimit: 0, facilityLimitOverride: false,
  fundStructureFeePct: 0.005, fundManagementFeePct: 0.005, custodyAdminFeePct: 0.0025,
  debtArrangingFeePct: 0.005, otherExpensesPerAnnum: 3_000_000,
  performanceFeePct: 0.2, hurdleRatePct: 0.08,
  fundManagerName: 'Fund Manager', feeDistribution: [] as any[],
};

/** Lines ending in the ellipsis pdf-lib's fitText appends when it gives up. */
const truncated = (txt: string): string[] => txt.split('\n').filter((l) => l.trimEnd().endsWith('…'));
const numericTruncated = (txt: string): string[] =>
  truncated(txt).filter((l) => /^\(?[0-9][0-9,.]*…$/.test(l.trim()));
/** A signed zero at the display precision, e.g. "(0.0)". */
const signedZeros = (txt: string): string[] =>
  txt.split('\n').filter((l) => /^\(0(\.0+)?\)$/.test(l.trim()));

async function runFor(tag: string, state: any): Promise<void> {
  console.log(`\n=== ${tag} ===`);
  for (const scale of SCALES) {
    const common = { state, projectName: 'Readability Check', dateLabel: '12 August 2026', displayScale: scale } as any;
    const full = decode(await generateProjectPdf({ ...common, selectedModuleKeys: MODULE_KEYS }));
    const summary = decode(await generateSummaryPdf({ ...common, selectedModuleKeys: [] }));

    // D1: no numeric truncation, at any scale.
    const fn = numericTruncated(full), sn = numericTruncated(summary);
    check(`D1 ${scale}: no truncated NUMBER in the full report`, fn.length === 0,
      `${fn.length} cells, e.g. ${fn.slice(0, 4).join(' | ')}`);
    check(`D1 ${scale}: no truncated NUMBER in the summary`, sn.length === 0,
      `${sn.length} cells, e.g. ${sn.slice(0, 4).join(' | ')}`);

    // E: no truncated LABEL either.
    const ft = truncated(full), st = truncated(summary);
    check(`E ${scale}: nothing at all is ellipsised in the full report`, ft.length === 0,
      `${ft.length} lines, e.g. ${ft.slice(0, 4).join(' | ')}`);
    check(`E ${scale}: nothing at all is ellipsised in the summary`, st.length === 0,
      `${st.length} lines, e.g. ${st.slice(0, 4).join(' | ')}`);

    // G4: no signed zero.
    const fz = signedZeros(full), sz = signedZeros(summary);
    check(`G4 ${scale}: no parenthesised zero in the full report`, fz.length === 0, `${fz.length} cells`);
    check(`G4 ${scale}: no parenthesised zero in the summary`, sz.length === 0, `${sz.length} cells`);

    if (scale === 'millions') {
      const feeLabels = full.split('\n').filter((l) => /^\s*(Fund structure fee|Fund management fee|Custody and admin fee|Debt arranging fee) \(/.test(l));
      check('E1: every fund fee label survives whole, base amount included',
        feeLabels.length > 0 && feeLabels.every((l) => l.trimEnd().endsWith(')')),
        feeLabels.join(' | '));
      check('E2: the Inputs legend renders in full',
        full.includes('Shaded cells are model inputs / assumptions'),
        full.split('\n').filter((l) => l.includes('Shaded cells')).join(' | '));
      for (const l of ['(memo) Minimum Cash Requirement (reserved, not spent)',
        '(memo) Headroom above the minimum reserve',
        '= Closing Cash (ties to CF + BS)']) {
        check(`E3: label survives whole: ${l}`, full.includes(l));
      }
      const cur = state.project.currency ?? 'SAR';
      check('D2: the unit price / ADR column names its unit',
        full.includes(`Unit price / ADR ${rateUnitFor(cur)}`));
      check('D2: the cost-line rate column names its unit',
        full.includes(`Rate / Value ${rateUnitFor(cur)}`));
      check('D2: no per-unit rate column is left bare',
        !full.split('\n').some((l) => l.trim() === 'Unit price / ADR' || l.trim() === 'Rate / Value'));
    }
  }
}

async function main(): Promise<void> {
  console.log('=== Report readability at every display scale ===');

  const fx = buildExcelSampleState();
  fx.project.fundTerms = { ...FUND_TERMS };
  for (const ph of fx.phases) ph.dividendPolicy = { enabled: true, priority: 'before_sweep', startingYear: 2029, payoutRatio: 0.9, mode: 'cash_above_min' };
  await runFor('FIXTURE (fund enabled)', fx);

  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key) {
    try {
      const sb = createClient(url, key, { auth: { persistSession: false } });
      const { data, error } = await sb.from('refm_project_versions').select('snapshot,version_label')
        .eq('project_id', PID).order('created_at', { ascending: false }).limit(1);
      if (error) console.log(`\n(real project skipped: ${error.message})`);
      else if (data?.length) await runFor(`FMP RE HUB (saved version ${(data[0] as any).version_label})`, (data[0] as any).snapshot);
    } catch (e) { console.log(`\n(real project skipped: ${(e as Error).message})`); }
  } else {
    console.log('\n(real project skipped: no database credentials)');
  }

  console.log('\n=== Fund toggle OFF is byte-identical, at every scale ===');
  for (const scale of SCALES) {
    const mk = async (mut: (s: any) => void): Promise<string> => {
      const s = buildExcelSampleState(); mut(s);
      const c = { state: s, projectName: 'Toggle', dateLabel: '12 August 2026', displayScale: scale } as any;
      return decode(await generateProjectPdf({ ...c, selectedModuleKeys: MODULE_KEYS })) + '\n#####\n'
        + decode(await generateSummaryPdf({ ...c, selectedModuleKeys: [] }));
    };
    const absent = await mk(() => { /* no fund terms */ });
    const disabled = await mk((s) => { s.project.fundTerms = { ...FUND_TERMS, enabled: false }; });
    check(`${scale}: absent vs populated-but-disabled are identical`, absent === disabled,
      `${absent.length} vs ${disabled.length} chars`);
  }

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  if (fail) { console.log('FAILURES:'); for (const f of failures) console.log(`  - ${f}`); process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); });
