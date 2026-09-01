/**
 * fetch-census-fixture.ts
 *
 * Pulls a LIVE project's latest-version snapshot from Supabase and writes it as
 * a census fixture, so the Module 6 field audit runs against a real project
 * rather than a sample.
 *
 * THE DEFAULT IS MARINA GATE, THE REFERENCE MODEL (2026-09-01d). The census ran
 * against FMP RE HUB, which is a TEST project, and that produced findings that
 * were facts about the fixture rather than about the product:
 *
 *   - RE HUB's two facilities carry 33.33% and 50%, summing to 83.33, so the
 *     model is already malformed on the shares-sum-to-100 invariant before any
 *     override is applied. That is what forced `facilitySharePct` to need a
 *     per-field precondition rather than a result filter.
 *   - Its `buaSqm` and `unitArea` fields sit at zero, so the census's candidate
 *     ladder ran to 100,000x and reported movers off deltas of 0.0005%.
 *   - Every asset holding land uses `landAllocation.parcelId: "__custom__"`
 *     with its own `customRate`, so the parcel rate legitimately feeds nothing
 *     and the land-price check asserted a property that does not hold there.
 *
 * None of those reproduce on Marina Gate. A finding that appears only on RE HUB
 * is not a finding, so the fixture moved to the project the numbers are read
 * off.
 *
 * The written file is GITIGNORED: it is live project data.
 *
 * Run: npx tsx scripts/fetch-census-fixture.ts            (Marina Gate)
 *      npx tsx scripts/fetch-census-fixture.ts "RE HUB"   (any other project)
 *
 * No em dashes in this file.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'node:fs';

// Load .env.local manually (tsx does not auto-load it).
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

/** Which project, and where its fixture lives. */
const TARGETS: Record<string, { match: string; out: string }> = {
  'marina gate': { match: '%MARINA GATE%', out: 'scripts/marinaGateSnapshot.json' },
  're hub': { match: '%RE HUB%', out: 'scripts/fmpReHubSnapshot.json' },
};

async function main(): Promise<void> {
  const arg = (process.argv[2] ?? 'Marina Gate').toLowerCase().trim();
  const target = TARGETS[arg];
  if (!target) {
    console.error(`Unknown target "${process.argv[2]}". Known: ${Object.keys(TARGETS).join(', ')}`);
    process.exit(1);
  }

  const { data: projects, error: pErr } = await sb
    .from('refm_projects')
    .select('id, name, updated_at')
    .ilike('name', target.match)
    .order('updated_at', { ascending: false });
  if (pErr) { console.error('project query error:', pErr.message); process.exit(1); }
  const proj = (projects ?? [])[0];
  if (!proj) { console.error(`No project matching ${target.match}`); process.exit(1); }

  const { data: ver, error: vErr } = await sb
    .from('refm_project_versions')
    .select('id, version_number, snapshot, label, created_at')
    .eq('project_id', proj.id)
    .order('version_number', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (vErr) { console.error('version query error:', vErr.message); process.exit(1); }
  if (!ver?.snapshot) { console.error('No snapshot on latest version'); process.exit(1); }

  const out = {
    projectId: proj.id,
    projectName: proj.name,
    versionId: ver.id,
    versionNumber: ver.version_number,
    label: ver.label,
    snapshot: ver.snapshot,
  };
  writeFileSync(target.out, JSON.stringify(out, null, 2));
  const snap = ver.snapshot as Record<string, unknown>;
  const n = (k: string): number => (snap[k] as unknown[] | undefined)?.length ?? 0;
  console.log(`Wrote ${target.out}`);
  console.log(`Project: ${proj.name}  version ${ver.version_number}  (${ver.label ?? 'no label'})`);
  console.log(`  assets=${n('assets')} subUnits=${n('subUnits')} costLines=${n('costLines')}`
    + ` costOverrides=${n('costOverrides')} financingTranches=${n('financingTranches')} parcels=${n('parcels')}`);
  // The invariant that made RE HUB the wrong fixture, stated on every fetch.
  const shares = ((snap.financingTranches as Array<{ facilitySharePct?: number }> | undefined) ?? [])
    .map((t) => Number(t.facilitySharePct)).filter((x) => Number.isFinite(x));
  const sum = shares.reduce((s, v) => s + v, 0);
  console.log(`  facility shares: [${shares.join(', ')}] sum=${sum}`
    + `  ${Math.abs(sum - 100) < 0.01 ? 'OK' : 'MALFORMED (expected 100): this project cannot measure facilitySharePct'}`);
}

void main();
