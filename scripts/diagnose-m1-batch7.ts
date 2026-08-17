/**
 * diagnose-m1-batch7.ts (2026-08-17)
 *
 * READ ONLY. Answers four reported defects with measurements from the live
 * saved snapshots rather than by reading the source:
 *
 *   1. country       is `project.country` empty, and is a gated line carrying a
 *                    rate that is therefore not charged?
 *   2. rett phasing  what window does each RETT line actually resolve to, and
 *                    what does the engine say it followed?
 *   3. capexPhasing  does the saved snapshot carry `asset.capexPhasing`, and
 *                    does it survive the hydrate the app runs on open?
 *   4. sub-units     is the count derivable from area / unit size?
 *
 * Run: npx tsx scripts/diagnose-m1-batch7.ts
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import {
  hydrationFromAnySnapshot, isV8Snapshot, isV7Snapshot,
} from '@/src/hubs/modeling/platforms/refm/lib/state/module1-migrate';
import { computeAssetCost } from '@/src/core/calculations';
import type {
  Asset, CostLine, SubUnit, Parcel, Phase, Project, CostOverride,
  LandAllocationMode, ParcelFundingConfig,
} from '@/src/hubs/modeling/platforms/refm/lib/state/module1-types';

for (const file of ['.env.local', '.env']) {
  try {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim());
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* file optional */ }
}
const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
if (!url || !key) { console.error('Missing SUPABASE creds'); process.exit(1); }
const sb = createClient(url, key, { auth: { persistSession: false } });

const only = process.argv[2];

function shapeOf(snap: unknown): string {
  if (isV8Snapshot(snap)) return 'v8 wrapper';
  if (isV7Snapshot(snap)) return 'v7 wrapper';
  return 'LOOSE (runs migrateLegacyToV8, the field whitelist)';
}

async function main(): Promise<void> {
  const { data: projects } = await sb
    .from('refm_projects')
    .select('id, name, archived, updated_at')
    .order('updated_at', { ascending: false })
    .limit(20);

  for (const proj of projects ?? []) {
    if (only && !proj.name.toLowerCase().includes(only.toLowerCase())) continue;
    const { data: vers } = await sb
      .from('refm_project_versions')
      .select('id, version_number, label, snapshot')
      .eq('project_id', proj.id)
      .order('version_number', { ascending: false })
      .limit(1);
    if (!vers || vers.length === 0) continue;
    const raw = vers[0].snapshot as Record<string, unknown> | null;
    if (!raw) continue;

    // What the app actually loads.
    const s = hydrationFromAnySnapshot(raw);
    const project = s.project as Project;
    const assets = s.assets as Asset[];
    const costLines = s.costLines as CostLine[];
    const subUnits = s.subUnits as SubUnit[];
    const parcels = s.parcels as Parcel[];
    const phases = s.phases as Phase[];
    const overrides = (s.costOverrides ?? []) as CostOverride[];
    if (assets.length === 0) continue;

    console.log('\n' + '='.repeat(78));
    console.log(`PROJECT ${proj.name}  (v${vers[0].version_number} "${vers[0].label ?? ''}", ${shapeOf(raw)})`);
    console.log('='.repeat(78));

    // ---- 1. country -------------------------------------------------------
    const rawProject = (raw as { project?: Partial<Project> }).project ?? {};
    console.log(`\n[1] SAVED   project.country=${JSON.stringify(rawProject.country)}  location=${JSON.stringify(rawProject.location)}`);
    console.log(`    LOADED  project.country=${JSON.stringify(project.country)}  location=${JSON.stringify(project.location)}`);
    for (const c of costLines.filter((x) => !!x.requiresCountry)) {
      const matches = c.requiresCountry === project.country;
      console.log(`    gated ${c.id} "${c.name}" needs ${JSON.stringify(c.requiresCountry)} rate=${c.value} -> ${matches ? 'CHARGED' : 'HIDDEN, NOT CHARGED'}`);
    }
    for (const c of costLines.filter((x) => !x.requiresCountry && /rett|transfer/i.test(x.name))) {
      console.log(`    user  ${c.id} "${c.name}" rate=${c.value} method=${c.method} source=${c.phasingSource ?? '(none)'} window ${c.startPeriod}..${c.endPeriod} phasing=${c.phasing}`);
    }

    // ---- 2 + 3. resolved windows, per phase ------------------------------
    console.log('\n[2] what the ENGINE resolves for the land + RETT lines');
    for (const ph of phases) {
      const asset = assets.find((a) => a.phaseId === ph.id && a.isCompanion !== true && a.visible !== false);
      if (!asset) { console.log(`    ${ph.name}: no asset`); continue; }
      const bd = computeAssetCost({
        asset, project, phase: ph, parcels, assets, subUnits, costLines,
        costOverrides: overrides,
        landAllocationMode: (s.landAllocationMode ?? 'autoByBua') as LandAllocationMode,
        parcelFunding: ((s.project as { parcelFunding?: ParcelFundingConfig[] }).parcelFunding ?? []),
      });
      console.log(`    ${ph.name} (cp=${ph.constructionPeriods}) via asset "${asset.name}"`);
      for (const c of costLines.filter((x) => x.phaseId === ph.id && (/rett|transfer/i.test(x.name) || /^land-/.test(x.id)))) {
        const w = bd.resolvedWindowByLineId[c.id];
        const series = bd.perLinePerPeriod[c.id];
        console.log(`      ${c.id} "${c.name}" own ${c.startPeriod}..${c.endPeriod} src=${c.phasingSource ?? '(none)'}`);
        console.log(`         resolved ${w ? `${w.startPeriod}..${w.endPeriod} source=${w.source}${w.degraded ? ' DEGRADED' : ''} (${w.reason ?? ''})` : '(not charged)'}`);
        if (series) console.log(`         per period: [${series.map((v) => Math.round(v)).join(', ')}]`);
      }
    }

    // ---- 3. asset.capexPhasing -------------------------------------------
    console.log('\n[3] asset.capexPhasing');
    const savedAssets = ((raw as { assets?: Array<Record<string, unknown>> }).assets ?? []);
    let savedCount = 0;
    for (const a of savedAssets) {
      if (a.capexPhasing) { savedCount += 1; console.log(`    SAVED   ${String(a.name)}: ${JSON.stringify(a.capexPhasing)}`); }
    }
    if (savedCount === 0) console.log('    SAVED   no asset carries a curve');
    let loadedCount = 0;
    for (const a of assets) {
      if (a.capexPhasing) { loadedCount += 1; console.log(`    LOADED  ${a.name}: ${JSON.stringify(a.capexPhasing)}`); }
    }
    if (loadedCount === 0) console.log('    LOADED  no asset carries a curve');
    // Round-trip probe: put a curve on the RAW snapshot, hydrate, see if it survives.
    const probe = JSON.parse(JSON.stringify(raw)) as Record<string, unknown>;
    const probeAssets = probe.assets as Array<Record<string, unknown>> | undefined;
    if (probeAssets && probeAssets.length > 0) {
      probeAssets[0].capexPhasing = { phasing: 'manual', distribution: [1, 0, 0] };
      const kept = hydrationFromAnySnapshot(probe).assets[0]?.capexPhasing;
      console.log(`    ROUND TRIP: set a curve on "${String(probeAssets[0].name)}" -> after hydrate: ${kept ? JSON.stringify(kept) : 'DESTROYED (undefined)'}`);
    }

    // ---- 4. sub-units -----------------------------------------------------
    console.log('\n[4] sub-units (metric / metricValue / unitArea)');
    for (const u of subUnits.slice(0, 30)) {
      const a = assets.find((x) => x.id === u.assetId);
      const ua = u.unitArea ?? 0;
      const area = u.metric === 'units' ? u.metricValue * ua : u.metricValue;
      console.log(`    ${a?.name ?? '?'} / ${u.name}: metric=${u.metric} metricValue=${u.metricValue} unitArea=${ua} -> area=${area}${u.metric === 'units' && ua === 0 ? '  <-- no unit size, count is the input' : ''}`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
