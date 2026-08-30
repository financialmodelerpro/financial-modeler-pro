/**
 * scripts/verify-legacy-training-retirement.ts
 *
 * Pins the 2026-08-30 retirement of the legacy training certificate and
 * assessment system, so it cannot creep back:
 *   A. NO TABLE READ OR WRITE of the five deprecated tables anywhere in app/
 *      or src/. The scan MUST distinguish a TABLE read (sb.from('x') /
 *      db.from('x')) from a STORAGE BUCKET read (sb.storage.from('x')): the
 *      LIVE certificate system keeps its PDFs in a bucket that shares the
 *      dead table's name, and a naive grep over-counted readers by exactly
 *      those bucket calls during the diagnosis (TRAPS 2.10).
 *   B. The retired files are gone (endpoint, pages, API families), and the
 *      surfaces that had to SURVIVE still exist: the admin course editor
 *      (lessons-only now, still fetching its live APIs, no assessment tab),
 *      the live cert viewer (/api/training/certificate, singular), and the
 *      live storage-bucket consumers.
 *   C. The live system is intact: student_certificates readers exist, and
 *      storage-bucket reads of 'certificates' still exist, which is also the
 *      proof that check A genuinely distinguishes the two.
 *   D. Migration 223 is comment-only, guarded, and names all five tables.
 *
 * Runs OFFLINE (no env, no DB).
 * Run: npx tsx scripts/verify-legacy-training-retirement.ts
 *
 * No em dashes in this file.
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..');
let pass = 0; let fail = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.error(`  FAIL ${name}${detail ? `: ${detail}` : ''}`); }
}
const exists = (rel: string) => fs.existsSync(path.join(ROOT, rel));
const strip = (s: string) => s.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

const LEGACY_TABLES = ['certificates', 'enrollments', 'assessments', 'assessment_questions', 'assessment_attempts'];

function* walk(dir: string): Generator<string> {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (/\.(ts|tsx)$/.test(e.name)) yield p;
  }
}

/** TABLE reads of `name`, excluding storage-bucket reads. A bucket call is
 *  `.storage.from('name')` or a chained `.from('name')` on a variable that
 *  was just `.storage`; the discriminator is the token immediately before
 *  `.from(`: `storage` (possibly across whitespace) = bucket, else = table. */
function tableReads(code: string, name: string): number {
  const re = new RegExp(String.raw`(\w+|\))\s*\.\s*from\(\s*['"\`]${name}['"\`]\s*\)`, 'g');
  let n = 0; let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    if (m[1] !== 'storage') n++;
  }
  return n;
}

async function main() {
  console.log('A. No table read of the five deprecated names (bucket reads excluded)');
  const offenders: string[] = [];
  let bucketReads = 0;
  for (const dir of ['app', 'src']) {
    for (const f of walk(path.join(ROOT, dir))) {
      const code = strip(fs.readFileSync(f, 'utf8'));
      for (const t of LEGACY_TABLES) {
        if (tableReads(code, t) > 0) offenders.push(`${path.relative(ROOT, f)} -> ${t}`);
      }
      bucketReads += (code.match(/storage\s*\.\s*from\(\s*['"`]certificates['"`]\s*\)/g) ?? []).length;
    }
  }
  check('A1 zero table reads of any deprecated name in app/ or src/',
    offenders.length === 0, offenders.slice(0, 5).join('; '));
  check('A2 the LIVE certificates storage BUCKET is still read (proves A1 distinguishes bucket from table)',
    bucketReads >= 3, `bucket reads found: ${bucketReads}`);

  console.log('B. Retired files gone, surviving surfaces intact');
  for (const rel of [
    'app/api/training/certificates/route.ts',
    'app/training/certificates/page.tsx',
    'app/training/certificates/layout.tsx',
    'app/training/[courseId]/assessment/page.tsx',
    'app/api/training/[courseId]/assessment/route.ts',
    'app/api/training/[courseId]/assessment/submit/route.ts',
    'app/api/admin/assessments/route.ts',
    'app/api/admin/assessments/questions/route.ts',
    'app/api/admin/assessments/attempts/route.ts',
  ]) {
    check(`B- gone: ${rel}`, !exists(rel));
  }
  const editor = fs.readFileSync(path.join(ROOT, 'app/admin/training/[courseId]/page.tsx'), 'utf8');
  check('B1 admin course editor SURVIVES (Course Manager links to it)', editor.length > 0);
  check('B2 editor keeps its live fetches (lessons, attachments, session links)',
    editor.includes("fetch(`/api/admin/training?courseId=") && editor.includes("'/api/admin/attachments'"));
  check('B3 editor has NO assessment tab left',
    !/activeTab/.test(editor) && !/api\/admin\/assessments/.test(strip(editor)));
  check('B4 the Course Manager index survives untouched', exists('app/admin/training/page.tsx'));
  check('B5 robots.ts no longer lists the deleted certificates page',
    !fs.readFileSync(path.join(ROOT, 'app/robots.ts'), 'utf8').includes("'/training/certificates'"));

  console.log('C. The live system is intact');
  const dash = fs.readFileSync(path.join(ROOT, 'app/training/dashboard/page.tsx'), 'utf8');
  check('C1 dashboard still fetches the LIVE cert endpoint (singular)',
    dash.includes('/api/training/certificate?email='));
  check('C2 the live cert endpoint still reads student_certificates',
    strip(fs.readFileSync(path.join(ROOT, 'app/api/training/certificate/route.ts'), 'utf8')).includes("from('student_certificates')"));
  check('C3 the live admin nav Assessments entry (training-hub) survives',
    fs.readFileSync(path.join(ROOT, 'src/components/admin/CmsAdminNav.tsx'), 'utf8').includes('/admin/training-hub/assessments'));

  console.log('D. Migration 223');
  const mig = fs.readFileSync(path.join(ROOT, 'supabase/migrations/223_deprecate_legacy_training_tables.sql'), 'utf8');
  const migCode = mig.replace(/--[^\n]*/g, '').replace(/'[^']*'/g, "''");
  check('D1 names all five tables', LEGACY_TABLES.every((t) => mig.includes(`'${t}'`)));
  // COMMENT ON TABLE sits INSIDE the format() string literal, so it is
  // asserted on the comment-stripped-but-literal-KEPT text; the dangerous-verb
  // scan runs on the literal-stripped text so prose cannot trip it.
  check('D2 comment-only and guarded (no drop, no data change)',
    /COMMENT ON TABLE/.test(mig.replace(/--[^\n]*/g, '')) && /IF EXISTS/.test(migCode)
    && !/DROP TABLE|TRUNCATE|DELETE\s+FROM|INSERT\s+INTO|UPDATE\s+\w+\s+SET/i.test(migCode));
  check('D3 records the bucket/table name-collision warning', /BUCKET/i.test(mig) && /TRAPS(\.md)?\s+2\.10/.test(mig));

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
