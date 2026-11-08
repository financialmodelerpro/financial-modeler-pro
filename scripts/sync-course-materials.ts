/**
 * sync-course-materials.ts: uploads a live course's session materials from a
 * local folder to storage and attaches each file to its session.
 *
 *   <dir>/Session_01/...  ->  the course's session number 1, and so on
 *
 * Uploads NEW and CHANGED files only (by SHA-256), matched to the session's
 * existing file of the SAME NAME, which it replaces in place: the student link
 * stays the same and the previous object is kept in storage as history. An
 * unchanged file is skipped. Files are released to enrolled students only after
 * their session ends (the download route enforces it).
 *
 * The same putMaterial() the admin editor's Replace / Add buttons use.
 *
 * Run:  npm run sync:refm-materials            (REFM, docs/REFM_Live_Course_Materials)
 *       npx tsx --env-file=.env.local scripts/sync-course-materials.ts --course CODE --dir <folder> [--dry-run]
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'fs';
import { join } from 'path';
import { getServerClient } from '../src/core/db/supabase';
import { listMaterials, planMaterialSync, putMaterial, sha256, sessionNumberOf } from '../src/hubs/training/lib/liveCourse/materials';

const arg = (k: string, d: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const course = arg('--course', 'REFM').toUpperCase();
const dir = arg('--dir', 'docs/REFM_Live_Course_Materials');
const dry = process.argv.includes('--dry-run');


(async () => {
  if (!existsSync(dir)) throw new Error(`Folder not found: ${dir}`);
  const sb = getServerClient();
  const { data: sessions, error } = await sb.from('live_sessions').select('id, course_session_no, title').eq('course_code', course);
  if (error) throw new Error(error.message);
  const byNo = new Map((sessions ?? []).map((s) => [s.course_session_no as number, s]));

  const totals = { new: 0, changed: 0, unchanged: 0, failed: 0 };
  for (const folder of readdirSync(dir).sort()) {
    const path = join(dir, folder);
    if (!statSync(path).isDirectory()) continue;
    const no = sessionNumberOf(folder);
    if (no == null) { console.log(`  skip     ${folder} (not a Session_NN folder)`); continue; }
    const session = byNo.get(no);
    if (!session) { console.log(`  skip     ${folder}: ${course} has no session ${no}`); continue; }

    const files = readdirSync(path).filter((f) => !f.startsWith('.') && statSync(join(path, f)).isFile());
    const local = files.map((f) => ({ fileName: f, bytes: readFileSync(join(path, f)) }));
    const plan = planMaterialSync(local.map((l) => ({ fileName: l.fileName, sha: sha256(l.bytes) })), await listMaterials(sb, [session.id as string]));
    for (const step of plan) {
      if (step.kind === 'unchanged') { totals.unchanged++; console.log(`  same     S${no} ${step.fileName}`); continue; }
      console.log(`  ${step.kind === 'new' ? 'upload ' : 'replace'}  S${no} ${step.fileName}${step.existing ? ` (v${step.existing.version} -> v${step.existing.version + 1})` : ''}`);
      if (dry) { totals[step.kind]++; continue; }
      const bytes = local.find((l) => l.fileName === step.fileName)!.bytes;
      const r = await putMaterial(sb, { sessionId: session.id as string, fileName: step.fileName, bytes, by: 'sync-script' });
      if (r.error) { totals.failed++; console.log(`           FAILED: ${r.error}`); } else totals[r.action]++;
    }
  }
  console.log(`\n${dry ? '[dry run] ' : ''}${totals.new} new, ${totals.changed} replaced, ${totals.unchanged} unchanged, ${totals.failed} failed.`);
  if (totals.failed) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
