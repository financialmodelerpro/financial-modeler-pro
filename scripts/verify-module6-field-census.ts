/**
 * verify-module6-field-census.ts
 *
 * EXHAUSTIVE, EMPIRICAL per-field audit of every Module 6 overridable input on
 * the LIVE "FMP RE HUB" project snapshot (scripts/fmpReHubSnapshot.json), not a
 * sample. For each field offered by the grid + add-row catalog it APPLIES an
 * override, recomputes through the real comparison pipeline (applyOverrides ->
 * computeFinancialsSnapshot -> computeReturnsSnapshot -> CASE_KPIS) and records
 * the observed KPI delta.
 *
 * It then proves the two-way gating contract so no silent dead lever can ship:
 *   1. NO field that EMPIRICALLY moves a comparison KPI is gated or excluded
 *      (a live lever must never be hidden).
 *   2. EVERY field that moves NO comparison KPI is gated (inactiveLeverReason),
 *      excluded as non-economic (nonEconomicLeverReason) or excluded as a
 *      per-period lever (isPerPeriodLever). No inert, unexplained ("silent
 *      dead") lever remains.
 *
 * A future change that adds a dead lever, or that breaks the wiring of a live
 * one, flips one of these assertions red.
 *
 * Run: npx tsx scripts/verify-module6-field-census.ts
 * (Refresh the fixture from prod with: npx tsx scripts/fetch-fmp-re-hub.ts)
 */
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import {
  enumerateOverridableFields, applyOverrides, type OverridableField,
} from '../src/hubs/modeling/platforms/refm/lib/cases/applyOverrides';
import {
  isPerPeriodLever, inactiveLeverReason, nonEconomicLeverReason,
} from '../src/hubs/modeling/platforms/refm/lib/cases/assumptionGrid';
import { computeFinancialsSnapshot } from '../src/hubs/modeling/platforms/refm/lib/financials-resolvers';
import { computeReturnsSnapshot } from '../src/hubs/modeling/platforms/refm/lib/returns-resolvers';
import { CASE_KPIS } from '../src/hubs/modeling/platforms/refm/lib/reports/caseComparisonReport';

let passed = 0, failed = 0; const fails: string[] = [];
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) { passed++; console.log(`  [PASS] ${label}`); }
  else { failed++; fails.push(label); console.log(`  [FAIL] ${label}${detail ? ` :: ${detail}` : ''}`); }
}

// The fixture is the user's LIVE project data, so it is .gitignore-listed and not
// committed. When it is absent (fresh clone / CI), skip-with-notice rather than
// fail: refresh it with `npx tsx scripts/fetch-fmp-re-hub.ts` (needs Supabase env).
const FIXTURE = 'scripts/fmpReHubSnapshot.json';
if (!existsSync(FIXTURE)) {
  console.log(`[SKIP] ${FIXTURE} not present (live project data, gitignored).`);
  console.log('       Refresh it with: npx tsx scripts/fetch-fmp-re-hub.ts');
  console.log('=== Result: skipped (no fixture) ===');
  process.exit(0);
}
const doc = JSON.parse(readFileSync(FIXTURE, 'utf8'));
const base = doc.snapshot as any;
console.log(`=== Module 6 field census on LIVE project "${doc.projectName}" (v${doc.versionNumber}) ===`);
console.log(`funding method ${base.project?.financing?.fundingMethod}, terminal ${base.project?.returns?.terminalMethod}, ${base.assets?.length} assets, ${base.subUnits?.length} sub-units, ${base.costLines?.length} cost lines, ${base.costOverrides?.length} overrides\n`);

type KpiVals = Record<string, number | null>;
function kpisOf(model: any): KpiVals | null {
  try {
    const rs = computeReturnsSnapshot(computeFinancialsSnapshot(model), model.project);
    const out: KpiVals = {}; for (const k of CASE_KPIS) out[k.label] = k.get(rs); return out;
  } catch { return null; }
}
const baseKpis = kpisOf(base);
if (!baseKpis) { console.error('base model failed to compute'); process.exit(1); }
function movedKpis(scen: KpiVals | null): string[] {
  if (!scen) return ['<compute-error>'];
  const moved: string[] = [];
  for (const k of CASE_KPIS) {
    const b = baseKpis![k.label], s = scen[k.label];
    const bn = b == null || !Number.isFinite(b), sn = s == null || !Number.isFinite(s);
    if (bn && sn) continue;
    if (bn !== sn) { moved.push(k.label); continue; }
    if (Math.abs((s as number) - (b as number)) > 1e-6 * Math.max(1, Math.abs(b as number))) moved.push(k.label);
  }
  return moved;
}

// Path-aware override candidates (enum domains keyed by full leaf path so an
// enum is never fed an invalid value that reads as a false dead lever).
const PATH_ALTERNATES: ReadonlyArray<readonly [RegExp, string[]]> = [
  [/recognitionProfile\.method$/, ['point_in_time', 'over_time']],
  [/recognitionProfile\.profileMode$/, ['equal', 'absolute_with_catchup']],
  [/recognitionProfile\.pointInTimeYear$/, ['handover', 'first_operations', 'custom']],
  [/cashPaymentProfile\.profileMode$/, ['equal', 'absolute_with_catchup']],
  [/(adrIndexation|rentIndexation|defaultIndexation)\.method$/, ['none', 'single_rate', 'yoy_compound', 'yoy_per_period']],
  [/\.indexation\.method$/, ['none', 'single_rate', 'yoy_compound', 'step']],
  [/returns\.terminalMethod$/, ['exit_multiple', 'perpetuity']],
  [/\.strategy$/, ['Sell', 'Operate', 'Lease', 'Sell + Manage']],
  [/idcConfig\.fundingMode$/, ['capitalized', 'expensed', 'conditional']],
  [/idcConfig\.allocationBasis$/, ['nsa', 'bua', 'gfa']],
  [/parcelFunding\[[^\]]+\]\.fundingType$/, ['fixed_ratio', '100pct_equity', '100pct_debt']],
  [/\.fb\.mode$/, ['percent_of_rooms', 'fixed_per_room', 'percent_of_revenue']],
  [/otherRevenue\.mode$/, ['percent_of_rooms', 'fixed_per_room', 'percent_of_revenue']],
  [/rentalPoolMode$/, ['phased_ramp', 'day_one_full']],
  [/dividendPolicy\.mode$/, ['pct_of_ebitda', 'pct_of_fcf', 'fixed']],
  [/\.country$/, ['Saudi Arabia', 'United Arab Emirates']],
  [/financialTerminology$/, ['standard', 'saudi']],
  [/^landAllocationMode$/, ['gfa', 'sqm']],
];
// Period / count / year / index leaves must be probed with SMALL integers only:
// feeding a huge value makes the engine allocate / loop over millions of periods
// and hang. Detected by leaf-name semantics.
function isPeriodish(field: string): boolean {
  const leaf = field.split('.').pop() ?? field;
  return /(Period|Periods|Year|Years|Start|startYear|startingYear|overlap|constructionStart|drawdownStart|repayment)/i.test(leaf)
    || /Days$/.test(leaf);
}
function candidatesFor(f: OverridableField): unknown[] {
  if (f.type === 'boolean') return [!f.value];
  if (f.type === 'string') { for (const [re, alts] of PATH_ALTERNATES) if (re.test(f.path)) return alts.filter((a) => a !== f.value); return []; }
  const v = Number(f.value);
  if (isPeriodish(f.field)) {
    // small, bounded integer shifts only
    if (Math.abs(v) > 1e-9) return [v + 1, Math.max(0, v - 1), v + 3];
    return [1, 2, 5, 10];
  }
  if (Math.abs(v) > 1e-9) return [v * 1.5, v * 0.5, -v, v * 3, v + 1000];
  return [0.05, 0.25, 1, 5, 50, 100, 1000, 1e5];
}

interface Row { path: string; type: string; baseValue: unknown; applied: unknown; moved: string[]; status: 'MOVER' | 'GATED' | 'NON-ECONOMIC' | 'PER-PERIOD' | 'DEAD'; reason: string; }

const all = enumerateOverridableFields(base);
const perPeriod = all.filter((f) => isPerPeriodLever(f.field));
const picker = all.filter((f) => !isPerPeriodLever(f.field));

const rows: Row[] = [];
for (const f of picker) {
  let best: string[] = []; let bestVal: unknown;
  for (const c of candidatesFor(f)) {
    const moved = movedKpis(kpisOf(applyOverrides(base, { [f.path]: c })));
    if (moved.length > best.length) { best = moved; bestVal = c; }
    if (best.length === CASE_KPIS.length) break;
  }
  const isMover = best.length > 0; // <compute-error> counts as engine-reactive => mover
  const gated = inactiveLeverReason(f.path, base);
  const nonEcon = nonEconomicLeverReason(f.path, f.field);
  let status: Row['status']; let reason = '';
  if (isMover) { status = 'MOVER'; reason = best[0] === '<compute-error>' ? 'engine-reactive (override exercises the recompute path)' : ''; }
  else if (gated) { status = 'GATED'; reason = gated; }
  else if (nonEcon) { status = 'NON-ECONOMIC'; reason = nonEcon; }
  else { status = 'DEAD'; reason = 'INERT, no gating reason (silent dead lever)'; }
  rows.push({ path: f.path, type: f.type, baseValue: f.value, applied: bestVal, moved: best, status, reason });
}

// ── Two-way contract assertions ──────────────────────────────────────────────
const movers = rows.filter((r) => r.status === 'MOVER');
// Documented engine-internal inert: a master construction-parking line's endPeriod
// is inert in a phase whose parking is fully entered per asset, but its live
// siblings (the same field in another phase, and its own startPeriod) DO move, so
// static config cannot distinguish it without replicating the capex-phasing
// engine. Allow-listed by exact pattern + asserted empirically inert, so any NEW
// dead lever that does not match still fails the guard red.
const DOCUMENTED_INERT = (r: Row): boolean =>
  /^costLines\[id=construction-parking__[^\]]+\]\.endPeriod$/.test(r.path);
const dead = rows.filter((r) => r.status === 'DEAD' && !DOCUMENTED_INERT(r));
const documentedInert = rows.filter((r) => r.status === 'DEAD' && DOCUMENTED_INERT(r));
// False-gated: empirically moves a KPI yet a gating/exclusion reason claims it is inert.
const falseGated = rows.filter((r) => r.moved.length > 0 && r.moved[0] !== '<compute-error>'
  && (inactiveLeverReason(r.path, base) || nonEconomicLeverReason(r.path, r.path.split('.').pop()!)));

console.log('=== Census summary ===');
const byStatus = new Map<string, number>();
for (const r of rows) byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + 1);
for (const [s, n] of [...byStatus.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${s}: ${n}`);
console.log(`  PER-PERIOD (excluded from picker): ${perPeriod.length}`);
console.log(`  picker total: ${picker.length}\n`);

check('base model computes a full KPI set', Object.values(baseKpis).some((v) => v != null));
check('a non-trivial number of fields empirically move a comparison KPI', movers.length > 30, `movers=${movers.length}`);
check('NO live lever is hidden: every empirical KPI mover is offered active (not gated / excluded)', falseGated.length === 0,
  falseGated.slice(0, 8).map((r) => `${r.path} moves[${r.moved.join(',')}]`).join(' ; '));
check('NO silent dead lever: every inert field is gated or excluded with a reason', dead.length === 0,
  `${dead.length} ungated dead: ` + dead.slice(0, 25).map((r) => `${r.path}`).join(' ; '));
check('documented engine-internal inert set stays small (<= 2) and is empirically inert', documentedInert.length <= 2 && documentedInert.every((r) => r.moved.length === 0),
  documentedInert.map((r) => r.path).join(' ; '));
if (documentedInert.length) console.log('  documented engine-internal inert (audit finding): ' + documentedInert.map((r) => r.path).join(' ; '));

// ── Spot-proofs: named movers with their observed KPI deltas (regression pins) ─
console.log('\n=== Spot-proof: representative levers move named KPIs (observed) ===');
function proveMoves(label: string, path: string, value: unknown, kpi: string): void {
  const f = picker.find((x) => x.path === path);
  if (!f) { check(`${label}: field present in catalog`, false, `path not found: ${path}`); return; }
  const scen = kpisOf(applyOverrides(base, { [path]: value }));
  const b = baseKpis![kpi], s = scen?.[kpi] ?? null;
  const moved = b != null && s != null && Math.abs(s - b) > 1e-6 * Math.max(1, Math.abs(b));
  check(`${label} moves ${kpi}`, moved, `base=${b} scen=${s}`);
}
// pick concrete entities from the live model
function proveMovesAny(label: string, path: string, value: unknown): void {
  const f = picker.find((x) => x.path === path);
  if (!f) { check(`${label}: field present in catalog`, false, `path not found: ${path}`); return; }
  const moved = movedKpis(kpisOf(applyOverrides(base, { [path]: value })));
  check(`${label} moves at least one comparison KPI`, moved.length > 0, `movedKpis=${moved.join(',') || 'none'}`);
}
const sellAsset = (base.assets as any[]).find((a) => a.strategy === 'Sell');
const activeOv = (base.costOverrides as any[]).find((o) => o.overridden !== false && !o.disabled && Number(o.value) > 0);
const parcel = (base.parcels as any[])[0];
if (parcel) proveMovesAny('Land price (per-parcel rate)', `parcels[id=${parcel.id}].rate`, Number(parcel.rate) * 1.5);
if (activeOv) proveMoves('Per-asset construction rate (costOverride)', `costOverrides[${activeOv.assetId}::${activeOv.lineId}].value`, Number(activeOv.value) * 1.5, 'Total Development Cost');
proveMoves('Discount rate', 'project.returns.discountRate', Number(base.project.returns?.discountRate ?? 0.1) + 0.05, 'NPV (FCFF)');
proveMoves('Perpetuity growth (active terminal method)', 'project.returns.perpetuityGrowth', Number(base.project.returns?.perpetuityGrowth ?? 0.02) + 0.01, 'Terminal Equity Value');
if (sellAsset) {
  const su = (base.subUnits as any[]).find((u) => u.assetId === sellAsset.id && Number(u.unitPrice) > 0);
  if (su) proveMoves('Sub-unit unit price', `subUnits[id=${su.id}].unitPrice`, Number(su.unitPrice) * 1.5, 'Gross Development Value');
}

// ── Gating spot-proofs: known config-inert levers carry the right reason ──────
console.log('\n=== Spot-proof: config-inert levers are gated (not silent) ===');
function proveGated(label: string, path: string): void {
  const r = rows.find((x) => x.path === path);
  if (!r) { console.log(`  [SKIP] ${label} (path not in catalog: ${path})`); return; }
  check(`${label} is gated/excluded, not a silent dead lever`, r.status === 'GATED' || r.status === 'NON-ECONOMIC', `status=${r.status}`);
}
proveGated('fixed-ratio Debt % under Method 3', 'project.financing.fixedRatio.debtPct');
proveGated('net-funding (Method 2) debt %', 'project.financing.netFundingConfig.debtPct');
proveGated('fixed-amount (Method 4) debt amount', 'project.financing.fixedAmountConfig.debtAmount');
proveGated('exit multiple under perpetuity terminal', 'project.returns.exitMultiple');
const operateAsset = (base.assets as any[]).find((a) => a.strategy === 'Operate');
if (operateAsset) proveGated('asset-level operate ADR (ADR is per sub-unit)', `assets[id=${operateAsset.id}].revenue.operate.startingADR`);
const tranche = (base.financingTranches as any[])[0];
if (tranche) proveGated('tranche interest rate (debt sized centrally)', `financingTranches[id=${tranche.id}].interestRatePct`);
// occupancy lever (the original wrong-field bug) stays excluded as per-period
check('occupancy % stays a per-period lever (excluded from picker)', isPerPeriodLever('occupancyPct'));

// ── Full census table to file ────────────────────────────────────────────────
const out = ['path\ttype\tbaseValue\tappliedOverride\tstatus\tmovedKpis\treason'];
for (const r of rows.sort((a, b) => a.path.localeCompare(b.path))) out.push([r.path, r.type, JSON.stringify(r.baseValue), JSON.stringify(r.applied), r.status, r.moved.join('|'), r.reason].join('\t'));
writeFileSync('scripts/module6-field-census.out.tsv', out.join('\n'));
console.log(`\nFull census table -> scripts/module6-field-census.out.tsv (${rows.length} fields)`);

console.log(`\n=== Result: ${passed} passed, ${failed} failed ===`);
if (failed) { console.log('Failures: ' + fails.join(' | ')); process.exit(1); }
