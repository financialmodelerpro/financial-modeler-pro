/**
 * scripts/diagnose_testimonial_links.ts
 *
 * READ-ONLY. Lists every stored testimonial LinkedIn URL and shows how the
 * normalizer resolves it, so you can see which rows were rendering as a
 * relative path against our own domain.
 *
 * SELECTs only. Nothing written.
 *
 * Usage: npx tsx --env-file=.env.local scripts/diagnose_testimonial_links.ts
 */

import { getServerClient } from '../src/core/db/supabase';
import { normalizeLinkedInUrl } from '../src/shared/utils/externalUrl';

async function main() {
  const sb = getServerClient();
  const { data, error } = await sb
    .from('student_testimonials')
    .select('id, student_name, status, hub, linkedin_url')
    .not('linkedin_url', 'is', null)
    .order('created_at', { ascending: false });
  if (error) { console.error('query failed:', error.message); process.exit(1); }

  const rows = (data ?? []).filter((r: any) => String(r.linkedin_url ?? '').trim());
  console.log(`${rows.length} testimonial(s) with a LinkedIn URL\n`);

  let broken = 0, ok = 0, unusable = 0;
  for (const r of rows as any[]) {
    const raw = String(r.linkedin_url);
    const norm = normalizeLinkedInUrl(raw);
    const hadScheme = /^https?:\/\//i.test(raw.trim());
    const state = norm === null ? 'UNUSABLE' : hadScheme ? 'ok' : 'WAS BROKEN';
    if (norm === null) unusable++; else if (hadScheme) ok++; else broken++;
    console.log(`  [${state}] ${String(r.student_name).padEnd(22)} status=${r.status}`);
    console.log(`      stored : ${raw}`);
    console.log(`      renders: ${norm ?? '(no link rendered)'}`);
  }

  console.log(`\nSummary: ${ok} already absolute, ${broken} were resolving against our own domain (now fixed at render), ${unusable} not a usable link`);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
