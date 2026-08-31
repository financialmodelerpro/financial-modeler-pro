/**
 * scripts/probe-capex-split-reconciliation.ts
 *
 * READ-ONLY. Does capex land in exactly one of the two bases?
 *
 * Capex splits by asset nature: a Sell asset's cost is released through COST OF
 * SALES, an Operate or Lease asset's is capitalised into FIXED ASSETS. The two
 * bases should therefore partition the project's capex: every currency unit in
 * one of them, none in both, none in neither.
 *
 * This measures that on whatever projects it can reach, and reports the parts
 * rather than a verdict, so a difference can be attributed rather than guessed
 * at. It also prints the per-asset classification, because the question "is a
 * Sell + Manage asset counted twice or missed" is answered by the classification,
 * not by the totals.
 *
 * IDC IS REPORTED SEPARATELY on both sides. It is capitalised into the asset it
 * financed, so it is inside the cost-of-sales base for a Sell asset and inside
 * the fixed-asset base for an Operate or Lease one. A reconciliation that did
 * not state it could hide a double count.
 *
 * Never writes. Skips cleanly with no credentials.
 *
 * Run: npx tsx scripts/probe-capex-split-reconciliation.ts
 *
 * No em dashes in this file.
 */
/* eslint-disable no-console, @typescript-eslint/no-explicit-any */
import { createClient } from '@supabase/supabase-js';
import { computeFinancialsSnapshot } from '@/src/hubs/modeling/platforms/refm/lib/financials-resolvers';
import { hydrationFromAnySnapshot } from '@/src/hubs/modeling/platforms/refm/lib/state/module1-migrate';

const sum = (a: number[] | undefined): number => (a ?? []).reduce((s, v) => s + (v ?? 0), 0);
const money = (v: number): string => v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function report(name: string, snapshot: any): void {
  console.log(`\n${'='.repeat(78)}\n${name}\n${'='.repeat(78)}`);
  const state: any = hydrationFromAnySnapshot(snapshot);
  let snap: any;
  try { snap = computeFinancialsSnapshot(state); }
  catch (e) { console.log(`  engine failed: ${(e as Error).message}`); return; }

  // ── Per-asset classification ──────────────────────────────────────────────
  const inCos = new Set<string>(snap.byAssetCostOfSales.keys());
  const inFa = new Set<string>();
  for (const [id, row] of snap.fixedAssets.byAsset as Map<string, any>) {
    if (sum(row.depreciable?.additionsPerPeriod) !== 0 || sum(row.land?.additionsPerPeriod) !== 0) inFa.add(id);
  }
  // Each asset's OWN capex, so "in neither base" can be told apart from
  // "in neither base and carrying money", which are very different findings.
  const ownCapex = new Map<string, number>();
  for (const [id, v] of snap.byAssetCostOfSales as Map<string, any>) ownCapex.set(id, v.assetCost);
  for (const [id, row] of snap.fixedAssets.byAsset as Map<string, any>) {
    if (!ownCapex.has(id)) {
      ownCapex.set(id, sum(row.depreciable?.additionsPerPeriod) + sum(row.land?.additionsPerPeriod));
    }
  }
  console.log('\n  ASSET CLASSIFICATION');
  console.log(`  ${'asset'.padEnd(30)} ${'strategy'.padEnd(14)} ${'comp'.padEnd(5)} CoS  FA ${'own capex'.padStart(20)}`);
  const both: string[] = [], neitherWithMoney: string[] = [], neitherEmpty: string[] = [];
  for (const a of state.assets as any[]) {
    if (a.visible === false) continue;
    const c = inCos.has(a.id), f = inFa.has(a.id);
    const cx = ownCapex.get(a.id) ?? 0;
    if (c && f) both.push(a.name);
    if (!c && !f) (Math.abs(cx) > 0.005 ? neitherWithMoney : neitherEmpty).push(`${a.name} (${money(cx)})`);
    console.log(`  ${String(a.name).slice(0, 30).padEnd(30)} ${String(a.strategy).padEnd(14)}`
      + ` ${(a.isCompanion === true ? 'yes' : 'no').padEnd(5)} ${c ? ' Y ' : ' . '}  ${f ? 'Y' : '.'}`
      + ` ${money(cx).padStart(20)}`);
  }
  console.log(`  counted in BOTH bases          : ${both.length ? both.join(', ') : 'none'}`);
  console.log(`  in NEITHER, carrying capex     : ${neitherWithMoney.length ? neitherWithMoney.join(', ') : 'none'}`);
  console.log(`  in neither, but ZERO capex     : ${neitherEmpty.length ? neitherEmpty.join(', ') : 'none'}`);

  // ── The two bases ─────────────────────────────────────────────────────────
  let cosAssetCapex = 0, cosIdc = 0;
  for (const [, v] of snap.byAssetCostOfSales as Map<string, any>) {
    cosAssetCapex += v.assetCost; cosIdc += v.idc;
  }
  const cosBase = cosAssetCapex + cosIdc;

  const faDepreciable = sum(snap.fixedAssets.projectTotals.depreciable.additionsPerPeriod);
  const faLand = sum(snap.fixedAssets.projectTotals.land.additionsPerPeriod);
  // IDC ON AN OPERATE / LEASE ASSET IS NOT IN `depreciable.additionsPerPeriod`.
  // It is a SECOND capitalised stream with its own roll-forward
  // (idc.idcNbvPerPeriod / idcDepreciationPerPeriod), which is why the balance
  // sheet carries it as its own line. Leaving it out understates the fixed-asset
  // base by exactly the IDC that did not go to a Sell asset, so it is added
  // here and shown separately rather than folded in silently.
  let faIdc = 0;
  for (const [id, row] of (snap.idc?.byAsset ?? new Map()) as Map<string, any>) {
    if (inCos.has(id)) continue; // that asset's IDC is already inside the cost-of-sales base
    faIdc += sum(row.idcPerPeriod);
  }
  const faBase = faDepreciable + faLand + faIdc;

  // ── Total capex, in the variants the platform carries ────────────────────
  const cap = snap.financing.capex.perPeriod;
  const inclAllLand = sum(cap.inclAllLand);
  const exclLandInKind = sum(cap.exclLandInKind);
  const exclAllLand = sum(cap.exclAllLand);
  const idcTotal = sum(snap.idc?.totalIdcPerPeriod);

  console.log('\n  THE TWO BASES');
  console.log(`    cost of sales base                       ${money(cosBase).padStart(20)}`);
  console.log(`      of which asset capex                   ${money(cosAssetCapex).padStart(20)}`);
  console.log(`      of which capitalised IDC               ${money(cosIdc).padStart(20)}`);
  console.log(`    fixed asset base                         ${money(faBase).padStart(20)}`);
  console.log(`      of which depreciable additions         ${money(faDepreciable).padStart(20)}`);
  console.log(`      of which land additions                ${money(faLand).padStart(20)}`);
  console.log(`      of which capitalised IDC (own stream)   ${money(faIdc).padStart(20)}`);
  console.log(`    SUM OF THE TWO BASES                     ${money(cosBase + faBase).padStart(20)}`);

  console.log('\n  TOTAL CAPEX, as the platform carries it');
  console.log(`    incl. all land                           ${money(inclAllLand).padStart(20)}`);
  console.log(`    excl. in-kind land                       ${money(exclLandInKind).padStart(20)}`);
  console.log(`    excl. all land                           ${money(exclAllLand).padStart(20)}`);
  console.log(`    capitalised IDC (project)                ${money(idcTotal).padStart(20)}`);
  console.log(`    incl. all land PLUS IDC                  ${money(inclAllLand + idcTotal).padStart(20)}`);

  console.log('\n  IDC, WHICH BASE IS IT IN');
  console.log(`    project capitalised IDC                  ${money(idcTotal).padStart(20)}`);
  console.log(`      inside the cost of sales base          ${money(cosIdc).padStart(20)}`);
  console.log(`      inside the fixed asset base            ${money(faIdc).padStart(20)}`);
  console.log(`      unaccounted (must be 0.00)             ${money(idcTotal - cosIdc - faIdc).padStart(20)}`);

  console.log('\n  DIFFERENCES (sum of bases MINUS the candidate total)');
  for (const [label, total] of [
    ['incl. all land', inclAllLand],
    ['incl. all land + IDC', inclAllLand + idcTotal],
    ['excl. in-kind land', exclLandInKind],
    ['excl. in-kind land + IDC', exclLandInKind + idcTotal],
  ] as Array<[string, number]>) {
    const d = cosBase + faBase - total;
    console.log(`    vs ${label.padEnd(28)} ${money(d).padStart(20)}${Math.abs(d) < 0.005 ? '   <== RECONCILES' : ''}`);
  }
}

async function main(): Promise<void> {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.log('(skipped: no database credentials)'); return; }
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const { data: projects, error } = await sb
    .from('refm_projects').select('id,name').order('updated_at', { ascending: false }).range(0, 49);
  if (error) { console.log(`(skipped: ${error.message})`); return; }
  for (const p of (projects ?? []) as any[]) {
    const { data } = await sb.from('refm_project_versions')
      .select('snapshot,version_label').eq('project_id', p.id)
      .order('created_at', { ascending: false }).limit(1);
    if (!data?.length) continue;
    report(`${p.name} (version ${(data[0] as any).version_label})`, (data[0] as any).snapshot);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
