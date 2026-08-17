/**
 * diagnose-parcel-references.ts (2026-08-17)
 *
 * WHAT IT ANSWERS: which saved assets hold a land parcel reference that the
 * OLD phase-scoped lookup could not resolve, and how much land value each of
 * them was reporting as zero because of it.
 *
 * Three classes, and they need different answers:
 *
 *   cross_phase  The asset points at a real parcel that sits in ANOTHER phase.
 *                The old lookup filtered parcels to the asset's own phase, so
 *                this resolved to `undefined` -> rate 0 -> land value 0, with
 *                nothing on screen saying so. The 2026-08-17 widening resolves
 *                it, so these REPAIR THEMSELVES on open. No data is rewritten.
 *
 *   dangling     The parcel id matches nothing anywhere (a deleted parcel).
 *                NOT auto-repaired, deliberately: picking a replacement parcel
 *                for the user would invent a number. The asset card now shows
 *                an amber "points at a land parcel that no longer exists"
 *                banner, which is the honest answer.
 *
 *   zero_rate    The parcel resolves and its rate is 0. A real answer, but the
 *                card now says so rather than showing a bare zero.
 *
 * READ ONLY. It opens the latest saved version of every project and never
 * writes. Run: npx tsx scripts/diagnose-parcel-references.ts
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import {
  computeAssetLandBreakdown,
  type LandRateIssue,
} from '@/src/core/calculations';
import {
  isParcelSentinel,
  type Asset,
  type Parcel,
  type SubUnit,
  type LandAllocationMode,
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
if (!url || !key) { console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }
const sb = createClient(url, key, { auth: { persistSession: false } });

interface Finding {
  project: string;
  version: string;
  phase: string;
  asset: string;
  parcelId: string;
  klass: 'cross_phase' | 'dangling' | 'zero_rate';
  parcelPhase?: string;
  sqm: number;
  /** What the OLD phase-scoped rule produced. */
  valueBefore: number;
  /** What the widened rule produces. */
  valueAfter: number;
  issueAfter?: LandRateIssue;
}

/** The land value the PREVIOUS (phase-scoped) rule produced for one asset. */
function valueUnderOldRule(asset: Asset, parcels: Parcel[], mode: LandAllocationMode): number {
  const phaseParcels = parcels.filter((p) => p.phaseId === asset.phaseId);
  const sqm = Math.max(0, asset.landAllocation?.sqm ?? asset.landAreaSqm ?? 0);
  const id = asset.landAllocation?.parcelId;
  if (mode !== 'sqm' || !id || isParcelSentinel(id)) return Number.NaN; // not this diagnosis
  const parcel = phaseParcels.find((p) => p.id === id);
  return sqm * (parcel ? Math.max(0, parcel.rate) : 0);
}

async function main(): Promise<void> {
  const { data: projects, error: pErr } = await sb
    .from('refm_projects')
    .select('id, name, archived, updated_at')
    .order('updated_at', { ascending: false });
  if (pErr) { console.error('project query error:', pErr.message); process.exit(1); }

  const findings: Finding[] = [];
  let scanned = 0;
  let assetsScanned = 0;

  for (const proj of projects ?? []) {
    const { data: vers, error: vErr } = await sb
      .from('refm_project_versions')
      .select('id, version_number, label, snapshot')
      .eq('project_id', proj.id)
      .order('version_number', { ascending: false })
      .limit(1);
    if (vErr || !vers || vers.length === 0) continue;
    const snap = vers[0].snapshot as Record<string, unknown> | null;
    if (!snap) continue;
    scanned += 1;

    const assets = (snap.assets ?? []) as Asset[];
    const parcels = (snap.parcels ?? []) as Parcel[];
    const subUnits = (snap.subUnits ?? []) as SubUnit[];
    const phases = (snap.phases ?? []) as Array<{ id: string; name: string }>;
    const mode = (snap.landAllocationMode ?? 'autoByBua') as LandAllocationMode;
    const phaseName = (id: string): string => phases.find((p) => p.id === id)?.name ?? id;

    for (const a of assets) {
      if (a.isCompanion === true) continue;
      assetsScanned += 1;
      const id = a.landAllocation?.parcelId;
      const after = computeAssetLandBreakdown(a, parcels, assets, subUnits, mode);
      if (!id || isParcelSentinel(id)) {
        // Sentinels are diagnosed by the engine's own issue flag only.
        if (after.rateIssue && after.landSqm > 0) {
          findings.push({
            project: proj.name, version: String(vers[0].version_number), phase: phaseName(a.phaseId),
            asset: a.name, parcelId: id ?? '(none)', klass: 'zero_rate',
            sqm: after.landSqm, valueBefore: after.landValue, valueAfter: after.landValue,
            issueAfter: after.rateIssue,
          });
        }
        continue;
      }
      const parcel = parcels.find((p) => p.id === id);
      const before = valueUnderOldRule(a, parcels, mode);
      if (!parcel) {
        findings.push({
          project: proj.name, version: String(vers[0].version_number), phase: phaseName(a.phaseId),
          asset: a.name, parcelId: id, klass: 'dangling',
          sqm: after.landSqm, valueBefore: 0, valueAfter: after.landValue, issueAfter: after.rateIssue,
        });
      } else if (parcel.phaseId !== a.phaseId) {
        findings.push({
          project: proj.name, version: String(vers[0].version_number), phase: phaseName(a.phaseId),
          asset: a.name, parcelId: id, klass: 'cross_phase', parcelPhase: phaseName(parcel.phaseId),
          sqm: after.landSqm, valueBefore: Number.isNaN(before) ? 0 : before, valueAfter: after.landValue,
          issueAfter: after.rateIssue,
        });
      } else if (after.rateIssue) {
        findings.push({
          project: proj.name, version: String(vers[0].version_number), phase: phaseName(a.phaseId),
          asset: a.name, parcelId: id, klass: 'zero_rate',
          sqm: after.landSqm, valueBefore: after.landValue, valueAfter: after.landValue,
          issueAfter: after.rateIssue,
        });
      }
    }
  }

  const money = (n: number): string => n.toLocaleString('en-US', { maximumFractionDigits: 0 });
  console.log(`Scanned ${scanned} project snapshots, ${assetsScanned} non-companion assets.\n`);
  if (findings.length === 0) {
    console.log('No parcel reference problems found.');
    return;
  }
  for (const klass of ['cross_phase', 'dangling', 'zero_rate'] as const) {
    const rows = findings.filter((f) => f.klass === klass);
    if (rows.length === 0) continue;
    console.log(`── ${klass.toUpperCase()} (${rows.length}) ──`);
    for (const f of rows) {
      console.log(
        `  ${f.project} v${f.version} | ${f.phase} | ${f.asset} | parcel ${f.parcelId}`
        + (f.parcelPhase ? ` (in ${f.parcelPhase})` : '')
        + ` | ${money(f.sqm)} sqm | before ${money(f.valueBefore)} -> after ${money(f.valueAfter)}`
        + (f.issueAfter ? ` | still flagged: ${f.issueAfter}` : ''),
      );
    }
    const recovered = rows.reduce((s, f) => s + (f.valueAfter - f.valueBefore), 0);
    console.log(`  land value recovered by the fix: ${money(recovered)}\n`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
