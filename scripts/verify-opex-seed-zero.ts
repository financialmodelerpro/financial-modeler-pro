/**
 * verify-opex-seed-zero.ts (2026-08-20)
 *
 * THE LINE ITEMS ARE THE STRUCTURE. THE NUMBERS ARE THE USER'S.
 *
 * A new project used to open with real figures already in its OpEx lines: HQ
 * payroll 5,000,000, an F&B cost at 65% of revenue, 24 others. They flowed
 * through EBITDA, PAT, tax, the cash statement and both IRRs, and on screen
 * they were indistinguishable from a number the user had entered. Measured on
 * a live project's shape, a brand new project silently carried 109.065m of HQ
 * opex alone.
 *
 * Two halves, and this file pins both:
 *
 *   1. Every builder seeds ZERO, and every line item stays. Removing the lines
 *      was never the fix; a user needs the structure to type into.
 *
 *   2. A value already SAVED on a DISABLED line is cleared on load. Zeroing
 *      the builders cannot reach a stored value, and every live project had
 *      dealt with unwanted lines by disabling them, which leaves the number
 *      sitting there ready to come back the moment the line is switched on.
 *
 * Run: npx tsx scripts/verify-opex-seed-zero.ts
 * No em dashes in this file.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import {
  defaultHQOpexLines,
  defaultHospitalityOpexLines,
  defaultLeaseOpexLines,
  LEGACY_OPEX_SEED_VALUES,
  isLegacySeedValue,
} from '@/src/core/calculations/opex/defaults';
import { clearSeededDisabledOpexValues } from '@/src/hubs/modeling/platforms/refm/lib/state/module1-migrate';
import { computeFinancialsSnapshot } from '@/src/hubs/modeling/platforms/refm/lib/financials-resolvers';

for (const f of ['.env.local', '.env']) {
  try {
    for (const l of fs.readFileSync(f, 'utf8').split('\n')) {
      const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(l.trim());
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* optional */ }
}

let passed = 0;
const failures: string[] = [];
const check = (label: string, ok: boolean, detail = ''): void => {
  if (ok) { passed++; return; }
  failures.push(`${label}${detail ? `  [${detail}]` : ''}`);
};
const section = (t: string): void => console.log(`\n-- ${t} ${'-'.repeat(Math.max(0, 58 - t.length))}`);
const read = (rel: string): string => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
/** Comments are not behaviour. Strip them before asserting on source text, or
 *  a sentence in a docstring passes a check about the code. */
const stripComments = (src: string): string => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const ALL = [
  ['HQ', defaultHQOpexLines()],
  ['Hospitality', defaultHospitalityOpexLines()],
  ['Lease', defaultLeaseOpexLines()],
] as const;

// ---------------------------------------------------------------------------
section('A. No builder seeds a number');

{
  for (const [name, lines] of ALL) {
    const nonZero = lines.filter((l) => Number(l.value ?? 0) !== 0);
    check(`A: ${name} seeds every line at zero`, nonZero.length === 0,
      nonZero.map((l) => `${l.name}=${l.value}`).join(', '));
  }
  // THE CLASS, not the three instances. A builder added later, or a line added
  // to an existing one, is covered without this file being edited.
  const src = stripComments(read('src/core/calculations/opex/defaults.ts'));
  const seeds = [...src.matchAll(/value:\s*([0-9_.]+)/g)]
    .map((m) => Number(m[1].replace(/_/g, '')))
    .filter((v) => v !== 0);
  // The frozen legacy table also contains `value:` entries, so count only the
  // ones outside it.
  const tableStart = src.indexOf('LEGACY_OPEX_SEED_VALUES');
  const beforeTable = tableStart >= 0 ? src.slice(0, tableStart) : src;
  const seedsInBuilders = [...beforeTable.matchAll(/value:\s*([0-9_.]+)/g)]
    .map((m) => Number(m[1].replace(/_/g, '')))
    .filter((v) => v !== 0);
  check('A: no non-zero value literal survives in any builder',
    seedsInBuilders.length === 0, seedsInBuilders.join(', '));
  check('A: the file does contain value literals, so the scan is not vacuous',
    seeds.length + seedsInBuilders.length > 0 || src.includes('value: 0'));
}

// ---------------------------------------------------------------------------
section('B. Every line item is still there');

{
  // The instruction was explicit: the structure stays, only the numbers go.
  // These counts are the shape a real development needs, and a builder that
  // quietly loses a line is the opposite failure to the one being fixed.
  const EXPECTED: Record<string, number> = { HQ: 4, Hospitality: 15, Lease: 7 };
  for (const [name, lines] of ALL) {
    check(`B: ${name} still has all ${EXPECTED[name]} line items`,
      lines.length === EXPECTED[name], String(lines.length));
    check(`B: ${name} lines all keep a name and a category`,
      lines.every((l) => String(l.name ?? '').trim() !== '' && String(l.category ?? '').trim() !== ''));
    check(`B: ${name} lines all keep their mode`,
      lines.every((l) => String((l as { mode?: string }).mode ?? '').trim() !== ''));
    // Ids must stay distinct or the UI cannot key rows.
    check(`B: ${name} line ids are unique`,
      new Set(lines.map((l) => l.id)).size === lines.length);
  }
  // A few names spot-checked by hand, so a wholesale replacement of the
  // catalog fails here rather than passing a count.
  const hqNames = defaultHQOpexLines().map((l) => l.name);
  check('B: the HQ lines are the same four', hqNames.includes('HQ payroll')
    && hqNames.some((n) => n.startsWith('HQ office'))
    && hqNames.some((n) => n.startsWith('Professional fees'))
    && hqNames.some((n) => n.startsWith('Other corporate')));
}

// ---------------------------------------------------------------------------
section('C. The legacy table is a record, not a source');

{
  check('C: the frozen table carries the 26 values that were seeded',
    LEGACY_OPEX_SEED_VALUES.length === 26, String(LEGACY_OPEX_SEED_VALUES.length));
  check('C: every frozen entry is non-zero', LEGACY_OPEX_SEED_VALUES.every((v) => v.value !== 0));
  check('C: the four HQ figures are in it',
    [5_000_000, 1_500_000, 800_000, 0.005].every((v) => LEGACY_OPEX_SEED_VALUES.some((s) => s.value === v)));

  // NOTHING MAY READ IT TO SEED. The predicate is the only consumer.
  const migrate = stripComments(read('src/hubs/modeling/platforms/refm/lib/state/module1-migrate.ts'));
  const defaults = stripComments(read('src/core/calculations/opex/defaults.ts'));
  check('C: the builders never read the frozen table',
    !/return \[[\s\S]{0,400}LEGACY_OPEX_SEED_VALUES/.test(defaults));
  check('C: the repair consumes the predicate, not the table',
    migrate.includes('isLegacySeedValue(') && !migrate.includes('LEGACY_OPEX_SEED_VALUES'));

  // The predicate itself.
  check('C: a seeded HQ payroll figure is recognised',
    isLegacySeedValue('hq_payroll', 'fixed_baseline', 5_000_000));
  check('C: the same figure under a different mode is NOT',
    !isLegacySeedValue('hq_payroll', 'pct_of_total_rev', 5_000_000));
  check('C: a different figure in the same category is NOT',
    !isLegacySeedValue('hq_payroll', 'fixed_baseline', 5_000_001));
  check('C: zero is never a seed value',
    !isLegacySeedValue('hq_payroll', 'fixed_baseline', 0));
  check('C: a non-number is never a seed value',
    !isLegacySeedValue('hq_payroll', 'fixed_baseline', '5000000'));
}

// ---------------------------------------------------------------------------
section('D. The repair clears exactly the right lines');

{
  const mk = (over: Record<string, unknown>) => ({
    phases: [], costLines: [],
    project: { hqOpex: { lines: [
      { id: 'a', name: 'HQ payroll', category: 'hq_payroll', mode: 'fixed_baseline', value: 5_000_000, disabled: true, keepMe: 'x' },
      { id: 'b', name: 'HQ office', category: 'hq_office', mode: 'fixed_baseline', value: 20_000_000, disabled: true },
      { id: 'c', name: 'Prof fees', category: 'hq_professional', mode: 'fixed_baseline', value: 800_000, disabled: false },
    ] } },
    assets: [{ id: 'as1', opex: { lines: [
      { id: 'd', name: 'F&B', category: 'direct_fb', mode: 'pct_of_fb_rev', value: 0.65, disabled: true },
    ] } }],
    ...over,
  });

  const out = clearSeededDisabledOpexValues(mk({}) as never) as unknown as {
    project: { hqOpex: { lines: Array<Record<string, unknown>> } };
    assets: Array<{ opex: { lines: Array<Record<string, unknown>> } }>;
  };
  const hq = out.project.hqOpex.lines;

  check('D: a DISABLED line at a seeded value is cleared', hq[0].value === 0);
  check('D: and keeps every other field on the row', hq[0].keepMe === 'x' && hq[0].disabled === true && hq[0].name === 'HQ payroll');
  check('D: a DISABLED line at the user own value is untouched', hq[1].value === 20_000_000);
  check('D: an ENABLED line at a seeded value is untouched', hq[2].value === 800_000);
  check('D: asset opex is repaired too, not just HQ', out.assets[0].opex.lines[0].value === 0);

  // Idempotent: a second pass must be a no-op.
  const twice = clearSeededDisabledOpexValues(
    clearSeededDisabledOpexValues(mk({}) as never),
  ) as unknown as typeof out;
  check('D: running it twice equals running it once',
    JSON.stringify(twice) === JSON.stringify(out));

  // Shapes it must survive rather than throw on.
  for (const [label, snap] of [
    ['no project at all', { phases: [], costLines: [] }],
    ['hqOpex absent', { phases: [], costLines: [], project: {} }],
    ['lines not an array', { phases: [], costLines: [], project: { hqOpex: { lines: 'nope' } } }],
    ['an asset with no opex', { phases: [], costLines: [], assets: [{ id: 'x' }] }],
    ['a null line in the array', { phases: [], costLines: [], project: { hqOpex: { lines: [null] } } }],
  ] as Array<[string, unknown]>) {
    let ok = true;
    try { clearSeededDisabledOpexValues(snap as never); } catch { ok = false; }
    check(`D: survives ${label}`, ok);
  }

  // Nothing to do means the SAME object back, so a hydrate that changes
  // nothing does not look like a change to the autosave subscriber.
  const clean = { phases: [], costLines: [], project: { hqOpex: { lines: [
    { id: 'z', category: 'hq_payroll', mode: 'fixed_baseline', value: 0, disabled: true },
  ] } } };
  check('D: an already-clean snapshot is returned unchanged, by identity',
    clearSeededDisabledOpexValues(clean as never) === (clean as never));

  // It is IN THE CHAIN. A repair nothing calls is not a repair.
  const migrate = stripComments(read('src/hubs/modeling/platforms/refm/lib/state/module1-migrate.ts'));
  check('D: the repair runs inside repairRawSnapshot',
    /function repairRawSnapshot[\s\S]{0,900}clearSeededDisabledOpexValues\(/.test(migrate));
}

// ---------------------------------------------------------------------------
section('E. No number moves on any saved project');

(async () => {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.log('   (skipped: no database credentials; run with .env.local present)');
  } else {
    const sb = createClient(url, key, { auth: { persistSession: false } });
    const { data: projects } = await sb.from('refm_projects').select('id,name').order('name');
    let measured = 0;
    for (const p of (projects ?? []) as Array<{ id: string; name: string }>) {
      const { data: v } = await sb.from('refm_project_versions').select('snapshot')
        .eq('project_id', p.id).order('version_number', { ascending: false }).limit(1);
      if (!v?.length) continue;
      const raw = v[0].snapshot as Record<string, unknown>;
      const sum = (a: readonly number[] | undefined) => (a ?? []).reduce((s, n) => s + (n ?? 0), 0);
      const shape = (s: unknown) => {
        const f = computeFinancialsSnapshot(s as never);
        const pl = f.pl as unknown as Record<string, number[]>;
        return [sum(pl.hqOpexPerPeriod), sum(pl.ebitdaPerPeriod), sum(f.pl.patPerPeriod)];
      };
      const before = shape(raw);
      const after = shape(clearSeededDisabledOpexValues(raw as never));
      // Every line the repair touches is DISABLED, so it contributes nothing
      // to any total. This is the proof of that, not an assumption.
      check(`E: ${p.name} is byte-identical through the repair`,
        before.every((b, i) => Math.abs(b - after[i]) < 0.005),
        `${before.map((n) => n.toFixed(2)).join(' / ')} vs ${after.map((n) => n.toFixed(2)).join(' / ')}`);
      measured += 1;
    }
    check('E: at least two real projects were measured', measured >= 2, String(measured));
  }

  console.log(`\n${'='.repeat(64)}`);
  if (failures.length === 0) {
    console.log(`verify-opex-seed-zero: ${passed} passed, 0 failed`);
  } else {
    console.log(`verify-opex-seed-zero: ${passed} passed, ${failures.length} FAILED`);
    for (const f of failures) console.log(`  FAIL  ${f}`);
    process.exit(1);
  }
})().catch((e) => { console.error(e); process.exit(1); });
