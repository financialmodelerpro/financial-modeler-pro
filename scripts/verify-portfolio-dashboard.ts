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
    debtByYear: {}, fcfeByYear: {}, fundingByYear: {}, projectIrr: null, equityIrr: null,
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
    const early = proj({ projectId: 'e', fundingByYear: { 2026: 50 }, debtByYear: { 2026: 10 } });
    const late = proj({ projectId: 'l', fundingByYear: { 2029: 70 }, debtByYear: { 2029: 20 } });
    const g = aggregatePortfolio([early, late]).groups[0];
    const years = g.fundingByYear.map((p) => p.year);
    // DENSE axis: 2026..2029, gap years zero-filled. A sparse axis would place
    // 2029 two slots after 2026 and an IRR over it would be overstated.
    check('C1 the year axis is DENSE, so a gap year cannot compress time',
      years.join(',') === '2026,2027,2028,2029');
    check('C2 each year carries only its own project',
      g.fundingByYear[0].byProject.e === 50 && g.fundingByYear[0].byProject.l === undefined);
    check('C3 the chart can stack by project',
      Object.keys(g.fundingByYear[3].byProject)[0] === 'l' && g.fundingByYear[3].year === 2029);
    check('C3b the gap years are genuinely empty, not invented',
      g.fundingByYear[1].total === 0 && g.fundingByYear[2].total === 0);
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
    check('E6 the UI shows the modelled count beside every ratio',
      (src('src/hubs/modeling/platforms/refm/components/PortfolioSummary.tsx').match(/of \$\{g\.projectCount\} modelled/g) ?? []).length >= 2);
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
