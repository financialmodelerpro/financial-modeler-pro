/**
 * scripts/diagnose_testimonial_links.ts
 *
 * READ-ONLY. Lists every stored LinkedIn URL (testimonials + instructors) and
 * shows how the normalizer resolves it, so you can see which rows were
 * rendering as a relative path against our own domain.
 *
 * SELECTs only. Nothing written.
 *
 * Usage: npx tsx --env-file=.env.local scripts/diagnose_testimonial_links.ts
 */

import { getServerClient } from '../src/core/db/supabase';
import { normalizeLinkedInUrl } from '../src/shared/utils/externalUrl';

async function report(
  sb: ReturnType<typeof getServerClient>,
  table: string, nameCol: string, extraCols: string,
): Promise<{ ok: number; broken: number; unusable: number }> {
  const { data, error } = await sb
    .from(table)
    .select(`id, ${nameCol}, ${extraCols}linkedin_url`)
    .not('linkedin_url', 'is', null);
  if (error) { console.error(`  ${table} query failed: ${error.message}`); return { ok: 0, broken: 0, unusable: 0 }; }

  type Row = Record<string, unknown> & { linkedin_url?: string | null };
  // The select string is built at runtime, so the typed parser cannot infer a
  // row shape from it; cast through unknown.
  const rows = ((data ?? []) as unknown as Row[]).filter((r) => String(r.linkedin_url ?? '').trim());
  console.log(`\n=== ${table}: ${rows.length} row(s) with a LinkedIn URL ===`);

  let broken = 0, ok = 0, unusable = 0;
  for (const r of rows) {
    const raw = String(r.linkedin_url);
    const norm = normalizeLinkedInUrl(raw);
    const hadScheme = /^https?:\/\//i.test(raw.trim());
    const state = norm === null ? 'UNUSABLE' : hadScheme ? 'ok' : 'WAS BROKEN';
    if (norm === null) unusable++; else if (hadScheme) ok++; else broken++;
    console.log(`  [${state}] ${String(r[nameCol]).padEnd(24)}`);
    console.log(`      stored : ${raw}`);
    console.log(`      renders: ${norm ?? '(no link rendered)'}`);
  }
  return { ok, broken, unusable };
}

async function main() {
  const sb = getServerClient();
  const t = await report(sb, 'student_testimonials', 'student_name', 'status, hub, ');
  const i = await report(sb, 'instructors', 'name', '');

  const ok = t.ok + i.ok, broken = t.broken + i.broken, unusable = t.unusable + i.unusable;
  console.log(`\nTotal: ${ok} already absolute, ${broken} were resolving against our own domain (now fixed at render), ${unusable} not a usable link`);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
