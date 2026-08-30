/**
 * scripts/verify-portfolio-dashboard.ts
 *
 * Pins the 2026-08-30 Portfolio Dashboard rebuild. The interesting checks are
 * BEHAVIOURAL, over the pure aggregator, because the portfolio rules are the
 * kind that look right and are wrong:
 *
 *   A. IRR IS NOT AN AVERAGE. Two projects with known IRRs must produce a
 *      portfolio IRR that is the IRR of the COMBINED cash flows, provably not
 *      their mean and not a size-weighted mean.
 *   B. PEAK DEBT is the max of the summed series. Two projects peaking in
 *      different years must give a portfolio peak BELOW the sum of peaks, and
 *      two peaking in the same year must give exactly the sum.
 *   C. CALENDAR ALIGNMENT: projects starting in different years must not have
 *      their period 0 added together.
 *   D. MIXED CURRENCY is never summed: one group per currency, flagged.
 *   E. An UN-MODELLED project contributes nothing and is counted out, so it
 *      cannot drag a ratio, and "N of M" is reported.
 *   F. The dead status tiles are gone, and with them the duplicate 'Archived'
 *      status value; the route uses the BASE case and excludes archived.
 *   G. The funding chart LEFT the Portfolio Dashboard (2026-08-30), and its
 *      series left with it, while the two series that are load-bearing
 *      (debt for peak debt, FCFE for the IRR) provably stayed.
 *   H. The single-project chart on the project dashboard, over the SHARED
 *      trim rule: empty edges dropped, an INTERIOR gap kept.
 *
 * Runs OFFLINE (no env, no DB).
 * Run: npx tsx scripts/verify-portfolio-dashboard.ts
 *
 * No em dashes in this file.
 */
import * as fs from 'fs';
import * as path from 'path';
import { aggregatePortfolio, type ProjectPortfolioMetrics } from '../src/hubs/modeling/platforms/refm/lib/portfolio/portfolioMetrics';
import { irr } from '../src/core/calculations/returns/irr';
import { trimEmptyEdges, type FundingYearPoint } from '../src/hubs/modeling/platforms/refm/lib/portfolio/fundingSeries';
import { PROJECT_STATUSES } from '../src/hubs/modeling/platforms/refm/lib/persistence/types';

const ROOT = path.resolve(__dirname, '..');
let pass = 0; let fail = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.error(`  FAIL ${name}${detail ? `: ${detail}` : ''}`); }
}
const src = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const strip = (s: string) => s.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

function proj(over: Partial<ProjectPortfolioMetrics>): ProjectPortfolioMetrics {
  return {
    projectId: 'p', name: 'P', currency: 'SAR', modelled: true,
    gdv: 0, totalDevelopmentCost: 0, totalFinancingCost: 0, fundingRequirement: 0,
    saleableAreaSqm: 0, saleableUnits: 0, equityInvested: 0, equityDistributions: 0,
    debtByYear: {}, fcfeByYear: {}, projectIrr: null, equityIrr: null,
    ...over,
  };
}

function main() {
  console.log('A. Portfolio IRR is the IRR of combined flows, never an average');
  {
    // Small fast project: -100 then +200 in one year (100% IRR).
    // Large slow project: -1000 then +1100 over four years (~2.4% IRR).
    const fast = proj({ projectId: 'fast', name: 'Fast', fcfeByYear: { 2026: -100, 2027: 200 } });
    const slow = proj({ projectId: 'slow', name: 'Slow', fcfeByYear: { 2026: -1000, 2030: 1100 } });
    const g = aggregatePortfolio([fast, slow]).groups[0];
    const combined = [-1100, 200, 0, 0, 1100];
    const expected = irr(combined);
    check('A1 the portfolio IRR equals the IRR of the summed streams',
      g.portfolioEquityIrr != null && expected != null && Math.abs(g.portfolioEquityIrr - expected) < 1e-9,
      `got ${g.portfolioEquityIrr}, expected ${expected}`);
    const fastIrr = irr([-100, 200])!;
    const slowIrr = irr([-1000, 0, 0, 0, 1100])!;
    const mean = (fastIrr + slowIrr) / 2;
    check('A2 and it is NOT the mean of the project IRRs',
      Math.abs((g.portfolioEquityIrr ?? 0) - mean) > 0.05, `portfolio ${g.portfolioEquityIrr} vs mean ${mean}`);
    const weighted = (fastIrr * 100 + slowIrr * 1000) / 1100;
    check('A3 and NOT a size-weighted mean either',
      Math.abs((g.portfolioEquityIrr ?? 0) - weighted) > 1e-4, `portfolio ${g.portfolioEquityIrr} vs weighted ${weighted}`);
    check('A4 no sign change -> no IRR invented',
      aggregatePortfolio([proj({ fcfeByYear: { 2026: 10, 2027: 20 } })]).groups[0].portfolioEquityIrr === null);
  }

  console.log('B. Peak debt is the max of the summed series');
  {
    const a = proj({ projectId: 'a', debtByYear: { 2026: 100, 2027: 40 } });
    const b = proj({ projectId: 'b', debtByYear: { 2026: 30, 2027: 90 } });
    const g = aggregatePortfolio([a, b]).groups[0];
    check('B1 staggered peaks: portfolio peak (130) is BELOW the sum of peaks (190)',
      g.peakDebt === 130 && g.peakDebtYear === 2026);
    const c = proj({ projectId: 'c', debtByYear: { 2027: 100 } });
    const d = proj({ projectId: 'd', debtByYear: { 2027: 90 } });
    const g2 = aggregatePortfolio([c, d]).groups[0];
    check('B2 coincident peaks: portfolio peak IS the sum (190)', g2.peakDebt === 190 && g2.peakDebtYear === 2027);
  }

  console.log('C. Series align on calendar years, not period index');
  {
    // Pinned through the OUTPUTS that consume the axis (the IRR and peak debt),
    // because the chart series that used to expose it directly went with the
    // chart on 2026-08-30. The rule it protects is unchanged and is the
    // load-bearing one: stackByYear must zero-fill a gap year rather than
    // closing it up.
    const early = proj({ projectId: 'e', fcfeByYear: { 2026: -100 }, debtByYear: { 2026: 10 } });
    const late = proj({ projectId: 'l', fcfeByYear: { 2030: 160 }, debtByYear: { 2029: 20 } });
    const g = aggregatePortfolio([early, late]).groups[0];
    // DENSE: -100 in 2026 returning 160 in 2030 is four years of waiting.
    const dense = irr([-100, 0, 0, 0, 160])!;
    const sparse = irr([-100, 160])!;
    check('C1 the year axis is DENSE, so a gap year cannot compress time',
      g.portfolioEquityIrr != null && Math.abs(g.portfolioEquityIrr - dense) < 1e-9,
      `got ${g.portfolioEquityIrr}, dense ${dense}`);
    check('C2 and a sparse axis would have overstated it, so this is not vacuous',
      Math.abs(dense - sparse) > 0.3 && Math.abs((g.portfolioEquityIrr ?? 0) - sparse) > 0.3,
      `dense ${dense} vs sparse ${sparse}`);
    check('C3 years align by calendar label, not by period index',
      g.peakDebtYear === 2029 && g.peakDebt === 20);
    check('C4 peak debt of non-overlapping projects is the larger, not the sum', g.peakDebt === 20);
  }

  console.log('D. Mixed currency is never summed');
  {
    const sar = proj({ projectId: 's', currency: 'SAR', gdv: 100 });
    const usd = proj({ projectId: 'u', currency: 'USD', gdv: 50 });
    const agg = aggregatePortfolio([sar, usd]);
    check('D1 one group per currency', agg.groups.length === 2 && agg.mixedCurrency);
    check('D2 the totals are NOT added across currencies',
      agg.groups.find((g) => g.currency === 'SAR')!.gdv === 100
      && agg.groups.find((g) => g.currency === 'USD')!.gdv === 50);
    check('D3 a single-currency portfolio is not flagged as mixed',
      !aggregatePortfolio([sar]).mixedCurrency);
    check('D4 the UI states it rather than showing one number',
      /portfolio-mixed-currency/.test(src('src/hubs/modeling/platforms/refm/components/PortfolioSummary.tsx')));
  }

  console.log('E. Un-modelled projects are counted out, not counted as zero');
  {
    const real = proj({ projectId: 'r', gdv: 100, equityInvested: 50, equityDistributions: 150 });
    const empty = proj({ projectId: 'x', modelled: false });
    const agg = aggregatePortfolio([real, empty]);
    const g = agg.groups[0];
    check('E1 an empty project adds nothing to a total', g.gdv === 100);
    check('E2 it cannot drag the multiple (3.00x, not 1.50x)', g.portfolioEquityMultiple === 3);
    check('E3 "N of M" is reported', g.modelledCount === 1 && g.projectCount === 2);
    check('E4 it is still LISTED, so it is not hidden', g.projects.length === 2);
    check('E5 the aggregate reports the portfolio-wide split', agg.modelledCount === 1 && agg.projectCount === 2);
    // Stated ONCE, in the footnote under the tiles. It used to be repeated on
    // the GDV and IRR tiles, which read as duplication; the rule is that the
    // caveat is present exactly once, not that every ratio repeats it.
    const summary = src('src/hubs/modeling/platforms/refm/components/PortfolioSummary.tsx');
    check('E6 the modelled count is stated exactly ONCE, in the footnote',
      (summary.match(/of \{g\.projectCount\} modelled/g) ?? []).length === 1
      && /portfolio-modelled/.test(summary)
      && !/sub=\{`\$\{g\.modelledCount\} of/.test(summary));
  }

  console.log('E7. Portfolio tiles only, and the footnote carries the captions');
  {
    const summary = src('src/hubs/modeling/platforms/refm/components/PortfolioSummary.tsx');
    check('E7f the Saleable area TILE is gone, the figure moved to the footnote',
      !/<Tile label="Saleable area"/.test(summary) && /portfolio-saleable/.test(summary));
    check('E7g six tiles remain', (summary.match(/<Tile\b/g) ?? []).length === 6);
    check('E7h the counts caption the tiles from below, not a stray line above',
      /groupsWithModel\.length === 0 && counts/.test(summary));
  }

  console.log('G. The funding chart left the portfolio (2026-08-30n)');
  {
    const summary = strip(src('src/hubs/modeling/platforms/refm/components/PortfolioSummary.tsx'));
    check('G1 no chart, caption or legend remains on the Portfolio Dashboard',
      !/FundingChart/.test(summary) && !/portfolio-funding-chart/.test(summary)
      && !/Funding requirement by year/.test(summary) && !/Stacked by project/.test(summary));
    check('G2 the series went with it, rather than being computed for nobody',
      !/fundingByYear/.test(strip(src('src/hubs/modeling/platforms/refm/lib/portfolio/portfolioMetrics.ts')))
      && !/fundingByYear/.test(summary));
    // The two series that remain are NOT presentation and must not follow it out.
    const metrics = src('src/hubs/modeling/platforms/refm/lib/portfolio/portfolioMetrics.ts');
    check('G3 debtByYear survives, because peak debt is the max of the SUMMED series',
      /stackByYear\(live, \(m\) => m\.debtByYear\)/.test(metrics));
    check('G4 fcfeByYear survives, because the portfolio IRR runs over the summed stream',
      /stackByYear\(live, \(m\) => m\.fcfeByYear\)/.test(metrics));
  }

  console.log('H. The project chart: one rule, trimmed at the edges only');
  {
    const pts = (vals: Array<[number, number]>): FundingYearPoint[] => vals.map(([year, value]) => ({ year, value }));
    check('H1 an empty leading run is trimmed',
      JSON.stringify(trimEmptyEdges(pts([[2026, 0], [2027, 0], [2028, 50]]))) === JSON.stringify(pts([[2028, 50]])));
    check('H2 an empty trailing run is trimmed',
      JSON.stringify(trimEmptyEdges(pts([[2026, 50], [2027, 0], [2028, 0]]))) === JSON.stringify(pts([[2026, 50]])));
    // THE distinction. An interior gap is a pause in funding, and closing it up
    // would compress the time axis, which is exactly the mistake that read
    // 9.50% against a true 4.87% before the portfolio axis was made dense.
    const gap = trimEmptyEdges(pts([[2026, 0], [2027, 40], [2028, 0], [2029, 60], [2030, 0]]));
    check('H3 an INTERIOR empty year is KEPT',
      gap.map((p) => p.year).join(',') === '2027,2028,2029' && gap[1].value === 0);
    check('H4 an all-empty series trims to nothing, so no row of zero bars renders',
      trimEmptyEdges(pts([[2026, 0], [2027, 0]])).length === 0);
    check('H5 a fully funded series is returned untouched',
      trimEmptyEdges(pts([[2026, 10], [2027, 20]])).length === 2);
    check('H6 a single funded year survives on its own',
      trimEmptyEdges(pts([[2026, 0], [2027, 5], [2028, 0]])).length === 1);

    const overview = src('src/hubs/modeling/platforms/refm/components/Overview.tsx');
    check('H7 the project dashboard renders it, from the SHARED rule',
      /overview-funding-chart/.test(overview) && /fundingChartPoints\(snap\)/.test(overview)
      && /from '\.\.\/lib\/portfolio\/fundingSeries'/.test(overview));
    check('H8 the amount is ON each bar, not on hover only',
      /\{money\(p\.value\)\}/.test(overview) && !/title=\{`/.test(strip(overview)));
    check('H9 it sits in Cost & capital structure, before Timeline',
      overview.indexOf('{fundingChart}') > overview.indexOf('Cap Rate at Exit')
      && overview.indexOf('{fundingChart}') < overview.indexOf('Timeline &amp; structure'));
    check('H10 locked palette only',
      !/#[0-9a-fA-F]{3,6}/.test(strip(overview).split('overview-funding-chart')[1]?.split('legendRow')[0] ?? ''));
    const series = src('src/hubs/modeling/platforms/refm/lib/portfolio/fundingSeries.ts');
    check('H11 the requirement is the Method 3 waterfall, the same figure the tile totals',
      /computeFundingGap\(snap\)\.method3Waterfall/.test(series)
      && /netCashRequiredPerPeriod/.test(series));
    check('H12 periods are paired with the engine own year labels, never an index',
      /snap\.yearLabels/.test(series));
  }

  console.log('F. The dead tiles and the duplicate status value are gone');
  {
    const dash = strip(src('src/hubs/modeling/platforms/refm/components/Dashboard.tsx'));
    check('F1 the ACTIVE / IN REVIEW / APPROVED tiles are gone',
      !/byStatus\('Active'\)/.test(dash) && !/label="In Review"/.test(dash) && !/label="Approved"/.test(dash));
    check('F2 the dashboard renders the portfolio summary instead', /<PortfolioSummary/.test(dash));
    check('F3 the duplicate Archived STATUS value is removed',
      !(PROJECT_STATUSES as readonly string[]).includes('Archived')
      && PROJECT_STATUSES.length === 4);
    check('F4 archiving is still the separate boolean (unchanged)',
      /archived:\s+boolean;/.test(src('src/hubs/modeling/platforms/refm/lib/persistence/types.ts')));
    const route = src('app/api/refm/portfolio/route.ts');
    check('F5 the route uses the BASE case, never the active case',
      /hydrationFromAnySnapshot/.test(route) && !/modelFromSnapshot/.test(strip(route))
      && /management-base-case/.test(route));
    check('F6 archived projects are excluded from the portfolio',
      /rows\.filter\(\(p\) => !p\.archived\)/.test(route));
    check('F7 PROJECTS and MARKETS survive as secondary counts',
      /portfolio-count-projects/.test(src('src/hubs/modeling/platforms/refm/components/PortfolioSummary.tsx'))
      && /portfolio-count-markets/.test(src('src/hubs/modeling/platforms/refm/components/PortfolioSummary.tsx')));
    check('F8 the IRR tile says it is aggregated, not an average',
      /aggregated cash flows/.test(src('src/hubs/modeling/platforms/refm/components/PortfolioSummary.tsx'))
      && /not an average of project IRRs/.test(src('src/hubs/modeling/platforms/refm/components/PortfolioSummary.tsx')));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}
main();
