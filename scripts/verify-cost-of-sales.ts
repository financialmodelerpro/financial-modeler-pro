/**
 * scripts/verify-cost-of-sales.ts
 *
 * THE cost-of-sales verifier. Replaces verify-cost-of-sales-v2.ts, which pinned
 * a second engine (`buildCostOfSalesV2`) that was deleted on 2026-08-30 after it
 * was measured disagreeing with the P&L by up to 407,131,731 in a single year on
 * a live project. The coverage is not dropped, it is re-aimed: the old file's
 * subjects (the spread, the wash identity, the vintage matrix, normalisation,
 * degenerate inputs) all appear below, against the ONE engine and the ONE
 * assembly layer.
 *
 * Sections:
 *   A. The engine (`buildCostOfSales`): proportional to recognition, exhausts
 *      the base, and is safe on degenerate input.
 *   B. The assembly layer (`buildAssetCostOfSales`) end to end on a fixture:
 *      base = asset capex + IDC, the Y0 lump SURVIVES at offset 0, the whole
 *      base is charged, and the ties hold (pre + post = total, vintage rows tie
 *      to capex, vintage columns tie to cost of sales, inventory closes at zero).
 *   C. The cost engine no longer truncates a line that runs past its window,
 *      which is what made `.total` disagree with the sum of `.perPeriod`.
 *   D. ONE implementation: the second engine is gone, nothing re-assembles a
 *      base, and every surface reads the same result.
 *   E. The year-by-year BUILD of the base (2026-08-31): both halves of the base
 *      are carried on the result rather than recomputed, the recognition share
 *      is the weight the engine actually spreads on, and the shared builder's
 *      first table shows the build and foots it to the charge with a check row.
 *
 * Runs OFFLINE (no env, no DB).
 * Run: npx tsx scripts/verify-cost-of-sales.ts
 *
 * No em dashes in this file.
 */
import * as fs from 'fs';
import * as path from 'path';
import { buildCostOfSales } from '@/src/core/calculations/revenue';
import { buildAssetCostOfSales, projectCapexOntoAxis } from '@/src/hubs/modeling/platforms/refm/lib/costOfSales';
import { buildCostOfSalesReport } from '@/src/hubs/modeling/platforms/refm/lib/reports/cosReports';

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.error(`  FAIL ${name}${detail ? `: ${detail}` : ''}`); }
}
const near = (a: number, b: number, tol = 0.01): boolean => Math.abs(a - b) <= tol;
const src = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');
/** Strip comments AND string literals before asserting a token is absent, so a
 *  check can never be satisfied or defeated by prose describing it. */
const strip = (s: string): string => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/[^\n]*/g, '')
  .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
  .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
  .replace(/`(?:[^`\\]|\\.)*`/g, '``');
const sum = (a: number[]): number => a.reduce((s, v) => s + (v ?? 0), 0);
const anyNonZeroArr = (a: number[]): boolean => a.some((v) => (v ?? 0) !== 0);

function main(): void {
  console.log('A. The engine: cost of sales is proportional to recognised revenue');
  {
    const r = buildCostOfSales([0, 100, 300, 100], 1000, 4);
    check('A1 each period takes its share of the base', near(r.perPeriod[1], 200) && near(r.perPeriod[2], 600) && near(r.perPeriod[3], 200));
    check('A2 the whole base is charged and no more', near(sum(r.perPeriod), 1000));
    check('A3 the cumulative series ends at the base', near(r.cumulativePerPeriod[3], 1000));
    // The property that made this engine the right one: constant gross margin.
    const rev = [0, 100, 300, 100];
    const margins = [1, 2, 3].map((t) => (rev[t] - r.perPeriod[t]) / rev[t]);
    check('A4 gross margin is CONSTANT across periods (the matching property)',
      margins.every((m) => near(m, margins[0], 1e-9)), margins.join(', '));
    check('A5 no recognition means no charge, not a divide by zero',
      sum(buildCostOfSales([0, 0, 0], 1000, 3).perPeriod) === 0);
    check('A6 a zero base charges nothing', sum(buildCostOfSales([1, 2, 3], 0, 3).perPeriod) === 0);
    check('A7 the weights are RELATIVE, so a percentage profile and a fractional one agree',
      near(sum(buildCostOfSales([10, 30, 60], 1000, 3).perPeriod), sum(buildCostOfSales([0.1, 0.3, 0.6], 1000, 3).perPeriod))
      && near(buildCostOfSales([10, 30, 60], 1000, 3).perPeriod[2], buildCostOfSales([0.1, 0.3, 0.6], 1000, 3).perPeriod[2]));
  }

  console.log('B. The assembly layer, end to end');
  {
    // A phase that starts WITH the project (offset 0), which is the case that
    // deleted the Y0 lump under the old hand-rolled rule.
    const phase = { id: 'ph', name: 'P1', startDate: '2026-01-01', constructionPeriods: 3 };
    const asset = { id: 'a1', name: 'A', phaseId: 'ph', strategy: 'Sell', visible: true };
    // The fixture carries a REAL cost line. It used to carry none, which made
    // the asset-capex half of the base identically zero: B2's "base = capex +
    // IDC" then held for the trivial reason that the capex was nothing, and any
    // check on the capex half would have passed on a zero series. Same lesson as
    // B10 below, one level up: a fixture with nothing in it proves nothing.
    const costLine = {
      id: 'cl1', phaseId: 'ph', name: 'Construction', method: 'fixed', value: 900,
      stage: 'hard', scope: 'direct', allocationBasis: 'per_asset',
      startPeriod: 0, endPeriod: 2, phasing: 'even',
    };
    const state = {
      project: { currency: 'SAR', startDate: '2026-01-01' },
      phases: [phase], assets: [asset], subUnits: [], parcels: [],
      costLines: [costLine], costOverrides: [], landAllocationMode: 'equal',
    } as unknown as Parameters<typeof buildAssetCostOfSales>[0]['state'];

    const N = 5;
    const sellResult = {
      assetId: 'a1', axisLength: N,
      recognitionPerPeriod: [0, 0, 400, 400, 200],
      presalesRecognitionPerPeriod: [0, 0, 400, 300, 0],
      postSalesRecognitionPerPeriod: [0, 0, 0, 100, 200],
    } as unknown as Parameters<typeof buildAssetCostOfSales>[0]['sellResult'];

    const built = buildAssetCostOfSales({
      state, sellResult,
      revenue: { bySellAsset: new Map() } as unknown as Parameters<typeof buildAssetCostOfSales>[0]['revenue'],
      idcPerPeriod: [0, 10, 20, 0, 0],
      axisLength: N, projectStartYear: 2026,
    });
    check('B1 the layer builds a result for a Sell asset', built !== null);
    if (built) {
      check('B2 IDC is INSIDE the base, not beside it',
        near(built.idc, 30) && near(built.capexBase, built.assetCost + built.idc),
        `idc=${built.idc} base=${built.capexBase} assetCost=${built.assetCost}`);
      check('B3 the per-period base sums to the base', near(sum(built.capexPerPeriod), built.capexBase));
      check('B4 the whole base is charged to cost of sales', near(sum(built.cos.perPeriod), built.capexBase));
      check('B5 pre-sales and post-handover halves sum to the total, every period',
        built.cos.perPeriod.every((v, t) => near((built.cosPresalesPerPeriod[t] ?? 0) + (built.cosPostSalesPerPeriod[t] ?? 0), v)));
      check('B6 vintage ROWS tie to the capex of their period',
        built.vintageMatrix.every((row, i) => near(sum(row), built.capexPerPeriod[i] ?? 0)));
      check('B7 vintage COLUMNS tie to the cost of sales of their period',
        built.cos.perPeriod.every((v, t) => near(built.vintageMatrix.reduce((s, row) => s + (row[t] ?? 0), 0), v)));
      check('B8 inventory closes at zero once everything is recognised',
        near(built.inventoryPerPeriod[N - 1] ?? 0, 0), String(built.inventoryPerPeriod[N - 1]));
      check('B9 the basis names the IDC inside the base',
        /capitalised IDC/.test(built.basis.label) && /Asset capex/.test(built.basis.label), built.basis.label);

      // ── E. The build of the base, year by year ──────────────────────────────
      // Run here rather than in its own fixture: these are properties OF this
      // result, and building a second fixture to assert them would be the same
      // mistake (a second assembly) this whole file exists to prevent.
      console.log('E. The year-by-year build of the base');
      check('E1 the two halves add to the base series in EVERY period, not just in total',
        built.capexPerPeriod.every((v, t) => near((built.assetCapexPerPeriod[t] ?? 0) + (built.idcCapitalisedPerPeriod[t] ?? 0), v)),
        built.capexPerPeriod.join(','));
      check('E2 the Module 1 capex half sums to the asset cost, and is not vacuously zero',
        near(sum(built.assetCapexPerPeriod), built.assetCost) && built.assetCost > 0,
        `${sum(built.assetCapexPerPeriod)} vs ${built.assetCost}`);
      check('E3 the IDC half is the series it was GIVEN, verbatim',
        built.idcCapitalisedPerPeriod.join(',') === [0, 10, 20, 0, 0].join(',')
        && near(sum(built.idcCapitalisedPerPeriod), built.idc),
        built.idcCapitalisedPerPeriod.join(','));
      check('E4 the recognition share sums to exactly 1 when anything is recognised',
        near(sum(built.recognitionSharePerPeriod), 1, 1e-12), String(sum(built.recognitionSharePerPeriod)));
      check('E5 base x share REPRODUCES the charge in every period (the check row is real)',
        built.cos.perPeriod.every((v, t) => near(built.capexBase * (built.recognitionSharePerPeriod[t] ?? 0), v, 1e-9)));
      check('E6 nothing recognised means a zero share, not a divide by zero',
        (() => {
          const none = buildAssetCostOfSales({
            state, sellResult: { ...sellResult, recognitionPerPeriod: [0, 0, 0, 0, 0] },
            revenue: { bySellAsset: new Map() } as unknown as Parameters<typeof buildAssetCostOfSales>[0]['revenue'],
            idcPerPeriod: [0, 10, 20, 0, 0], axisLength: N, projectStartYear: 2026,
          });
          return none !== null && none.recognitionSharePerPeriod.every((v) => v === 0);
        })());

      // The shared builder's first table IS the build, and it foots.
      const snapStub = {
        axisLength: N,
        yearLabels: [2026, 2027, 2028, 2029, 2030],
        byAssetCostOfSales: new Map([['a1', built]]),
      } as unknown as Parameters<typeof buildCostOfSalesReport>[0];
      const stateStub = { assets: [asset] } as unknown as Parameters<typeof buildCostOfSalesReport>[1];
      const money = (v: number): string => v.toFixed(2);
      const tables = buildCostOfSalesReport(snapStub, stateStub, money);
      const build = tables[0];
      check('E7 the FIRST table an asset shows is the build, not the charge',
        !!build && build.title === 'Cost of Sales Build, A', build?.title ?? 'none');
      if (build) {
        const labels = build.rows.map((rr) => rr.label);
        check('E8 the build names the capex, the IDC and the total base, each as a YEAR series',
          ['Capex, from Module 1', 'Capitalised IDC', 'Total base charged through cost of sales']
            .every((l) => build.rows.some((rr) => rr.label === l && rr.values.length === N && anyNonZeroArr(rr.values))),
          labels.join(' | '));
        check('E9 the recognition share is flagged as a RATIO, so no surface prints it as money',
          build.rows.some((rr) => /Recognition share/.test(rr.label) && rr.isPercent === true));
        // No label in the build may lean on a parenthesis: REFM PDF text
        // extraction drops them (TRAPS 4.1), so a row named "Capex (Module 1)"
        // cannot be found in the exported document by the name it was given.
        check('E9a no build label depends on a parenthesis surviving the PDF',
          build.rows.every((rr) => !/[()]/.test(rr.label)),
          build.rows.filter((rr) => /[()]/.test(rr.label)).map((rr) => rr.label).join(' | '));
        check('E10 the base rows come BEFORE the cost of sales row',
          labels.findIndex((l) => l === 'Total base charged through cost of sales')
          < labels.findIndex((l) => /^Cost of Sales, total base/.test(l)));
        const checkRow = build.rows[build.rows.length - 1];
        check('E11 the build ends on a check row',
          /^Check, / .test(checkRow.label), checkRow.label);
        check('E12 the check is zero in every period (base x share reproduces the charge)',
          checkRow.values.length === N && checkRow.values.every((v) => near(v, 0, 1e-6)),
          checkRow.values.join(','));
        check('E13 the check TOTAL is the independent footing, base less cost of sales, and it is zero',
          checkRow.totalOverride === money(0),
          String(checkRow.totalOverride));
      }
    }

    // THE Y0 REGRESSION, tested on the projection itself. The old rule sent
    // local index 0 to `offset - 1`, which is -1 for a phase starting WITH the
    // project, so a phase-1 upfront lump landed off the axis and was silently
    // dropped. Measured live before the fix: 56,375,000 on Marina Gate.
    //
    // Tested here rather than through a fixture asset because a fixture with no
    // cost lines has no lump to lose: that version of this check passed with
    // the rule sabotaged, which is worse than no check at all.
    const lump = [1000, 200, 300];
    const at0 = projectCapexOntoAxis(lump, 0, N);
    check('B10 a phase starting WITH the project keeps its Y0 lump on the axis',
      near(sum(at0), 1500) && near(at0[0], 1200), `${at0.join(',')}`);
    const at2 = projectCapexOntoAxis(lump, 2, N);
    check('B11 a later phase places the lump in the period BEFORE it starts',
      near(at2[1], 1000) && near(at2[2], 200) && near(at2[3], 300) && near(sum(at2), 1500), `${at2.join(',')}`);
    check('B12 a series running past the axis loses nothing, it lands in the last period',
      near(sum(projectCapexOntoAxis([100, 100, 100, 100, 100, 100, 100, 100], 3, N)), 800));
  }

  console.log('C. The cost engine does not truncate a line that outruns its window');
  {
    const layer = src('src/core/calculations/index.ts');
    const stripped = strip(layer);
    check('C1 the aggregation loop no longer clamps to periodSlots',
      !/const lim = Math\.min\(dist\.length, periodSlots\)/.test(stripped)
      && !/const lim = Math\.min\(tmp\.length, periodSlots\)/.test(stripped));
    check('C2 it iterates the DISTRIBUTION, so a longer one grows the aggregate',
      /for \(let i = 0; i < dist\.length; i\+\+\)/.test(stripped));
    check('C3 the grown arrays are hole-filled before they are returned',
      /perPeriod\[i\] = perPeriod\[i\] \?\? 0/.test(stripped));
  }

  console.log('D. ONE implementation');
  {
    check('D1 the second engine file is gone',
      !fs.existsSync(path.join(ROOT, 'src/core/calculations/revenue/costOfSalesV2.ts')));
    const revIndex = strip(src('src/core/calculations/revenue/index.ts'));
    check('D2 and it is not exported any more', !/buildCostOfSalesV2/.test(revIndex));

    // Exactly ONE call site of the engine in the whole app.
    const walk = (dir: string, out: string[] = []): string[] => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p, out);
        else if (/\.tsx?$/.test(e.name)) out.push(p);
      }
      return out;
    };
    const files = [...walk(path.join(ROOT, 'src')), ...walk(path.join(ROOT, 'app'))];
    const callers = files.filter((f) => {
      if (f.endsWith(path.join('revenue', 'costOfSales.ts')) || f.endsWith(path.join('revenue', 'index.ts'))) return false;
      return /\bbuildCostOfSales\s*\(/.test(strip(fs.readFileSync(f, 'utf8')));
    });
    check('D3 the engine has exactly ONE call site in the app',
      callers.length === 1 && callers[0].endsWith(path.join('refm', 'lib', 'costOfSales.ts')),
      callers.map((c) => path.relative(ROOT, c)).join(', ') || 'none');

    // No surface re-assembles a capex base for cost of sales.
    const cosReports = strip(src('src/hubs/modeling/platforms/refm/lib/reports/cosReports.ts'));
    check('D4 the shared report builder computes nothing, it shapes the result',
      !/computeAssetCost/.test(cosReports) && /byAssetCostOfSales/.test(cosReports));
    const screen = strip(src('src/hubs/modeling/platforms/refm/components/modules/Module2CostOfSales.tsx'));
    check('D5 the Module 2 screen renders the shared builder and assembles nothing',
      !/computeAssetCost/.test(screen) && /buildCostOfSalesReport/.test(screen));

    // The build reaches BOTH exports from the same builder, and all three
    // renderers honour the ratio flag. Without the flag a share of 0.1573 is a
    // money cell: "-" on screen, "0" in the PDF, "0.00" in the workbook.
    check('D5a the PDF renders the Module 2 CoS section from the shared builder',
      /buildCostOfSalesReport\(snap, state, cosFmtFn\)/.test(strip(src('src/hubs/modeling/platforms/refm/lib/pdf/generateProjectPdf.ts'))));
    check('D5b the workbook renders the Module 2 CoS section from the shared builder',
      /buildCostOfSalesReport\(snap, state,/.test(strip(src('src/hubs/modeling/platforms/refm/lib/excel/buildModelWorkbook.ts'))));
    for (const [rel, pat] of [
      ['src/hubs/modeling/platforms/refm/components/modules/Module2CostOfSales.tsx', /r\.isPercent \? pctFmt/],
      ['src/hubs/modeling/platforms/refm/lib/pdf/generateProjectPdf.ts', /if \(r\.isPercent\)/],
      ['src/hubs/modeling/platforms/refm/lib/excel/buildModelWorkbook.ts', /row\.isPercent \? NUMFMT\.pct/],
    ] as Array<[string, RegExp]>) {
      check(`D5c ${path.basename(rel)} renders a ratio row as a percentage`, pat.test(strip(src(rel))));
    }
    const schedules = strip(src('src/hubs/modeling/platforms/refm/components/modules/Module2Schedules.tsx'));
    check('D6 the Schedules screen reads the result rather than rebuilding it',
      !/computeAssetCost/.test(schedules) && /byAssetCostOfSales/.test(schedules));

    // The Y0 rule is stated once.
    for (const rel of [
      'src/hubs/modeling/platforms/refm/lib/costOfSales.ts',
      'src/hubs/modeling/platforms/refm/lib/fixed-assets-resolvers.ts',
      'src/hubs/modeling/platforms/refm/lib/reports/capexReports.ts',
    ]) {
      check(`D7 ${path.basename(rel)} places the Y0 lump with the shared rule`,
        /phaseLocalToProjectIndex\(/.test(strip(src(rel)))
        && !/i === 0 \? (?:Math\.max\(0, )?offset - 1/.test(strip(src(rel))));
    }

    // The P&L reads, it does not rebuild.
    const fin = strip(src('src/hubs/modeling/platforms/refm/lib/financials-resolvers.ts'));
    check('D8 the P&L reads the one result and never calls the engine',
      !/buildCostOfSales\s*\(/.test(fin) && /byAssetCostOfSales\.get\(a\.id\)/.test(fin));
    check('D9 the balance sheet inventory comes from the SAME object as the charge',
      /cosResult\.inventoryPerPeriod/.test(fin));
    check('D10 the schedule bundle no longer carries a cost-of-sales result',
      !/cos:\s*CostOfSalesResult/.test(strip(src('src/hubs/modeling/platforms/refm/lib/revenue-resolvers.ts'))));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}
main();
