/**
 * scripts/verify-testimonial-company.ts
 *
 * Pins the optional company/organization behaviour across BOTH testimonial
 * systems (they stay independent: separate tables, routes and field names).
 *
 *  1. The byline formatter: "{title} at {company}", with no dangling "at" when
 *     either side is missing (existing rows have no company and must render
 *     exactly as before).
 *  2. Both write routes persist `company`, and each display card formats its
 *     byline through the shared helper rather than joining inline.
 *  3. The shared submit modal posts the field names each hub's route actually
 *     reads (the Modeling branch used camelCase the route ignored, so every
 *     modeling submit 400'd).
 *
 * Pure + source assertions. No DB, no network:
 *   npx tsx scripts/verify-testimonial-company.ts
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { testimonialByline } from '../src/shared/utils/testimonialByline';

const ROOT = join(__dirname, '..');
let pass = 0;
let fail = 0;

function eq(label: string, actual: unknown, expected: unknown) {
  if (actual === expected) { pass++; return; }
  fail++;
  console.error(`FAIL ${label}\n     expected: ${JSON.stringify(expected)}\n     actual  : ${JSON.stringify(actual)}`);
}
function ok(label: string, cond: boolean) {
  if (cond) { pass++; return; }
  fail++;
  console.error(`FAIL ${label}`);
}
function read(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8');
}

// ── 1. Byline formatting ────────────────────────────────────────────────────
eq('title + company', testimonialByline('Financial Analyst', 'KPMG'), 'Financial Analyst at KPMG');
eq('title only', testimonialByline('Financial Analyst', ''), 'Financial Analyst');
eq('title only (null company)', testimonialByline('Financial Analyst', null), 'Financial Analyst');
eq('title only (undefined company)', testimonialByline('Financial Analyst', undefined), 'Financial Analyst');
eq('company only, no leading at', testimonialByline('', 'KPMG'), 'KPMG');
eq('company only (null title)', testimonialByline(null, 'KPMG'), 'KPMG');
eq('neither', testimonialByline('', ''), '');
eq('neither (null/null)', testimonialByline(null, null), '');
eq('whitespace title is empty', testimonialByline('   ', 'KPMG'), 'KPMG');
eq('whitespace company is empty', testimonialByline('Analyst', '   '), 'Analyst');
eq('both whitespace', testimonialByline('  ', '  '), '');
eq('values are trimmed', testimonialByline('  Analyst  ', '  KPMG  '), 'Analyst at KPMG');

// The invariant that protects existing data: no output may ever start or end
// with a bare "at", and a single-sided byline never contains " at ".
for (const [t, c] of [['Analyst', ''], ['', 'KPMG'], ['', ''], [null, null], ['Analyst', null]] as [string | null, string | null][]) {
  const out = testimonialByline(t, c);
  ok(`no dangling at for (${JSON.stringify(t)}, ${JSON.stringify(c)})`, !/(^at\b|\bat$| at )/.test(out));
}

// ── 2. Storage: both systems persist company, independently ─────────────────
const trainingRoute = read('app/api/training/submit-testimonial/route.ts');
const studentRoute  = read('app/api/testimonials/student/route.ts');
const modelingRoute = read('app/api/modeling/submit-testimonial/route.ts');

ok('training route writes company', /company:\s*/.test(trainingRoute));
ok('student route writes company', /company:\s*/.test(studentRoute));
ok('modeling route writes company', /company:\s*/.test(modelingRoute));
ok('training system uses student_testimonials', trainingRoute.includes('student_testimonials'));
ok('student route uses student_testimonials', studentRoute.includes('student_testimonials'));
ok('modeling system uses the testimonials table', /from\('testimonials'\)/.test(modelingRoute));
ok('modeling route tags hub modeling', /hub:\s*'modeling'/.test(modelingRoute));
ok('systems stay independent (modeling never writes student_testimonials)', !modelingRoute.includes('student_testimonials'));
ok('systems stay independent (training never writes the testimonials table)', !/from\('testimonials'\)/.test(trainingRoute));

// ── 3. Every DB-testimonial card formats through the helper ────────────────
for (const rel of ['app/training/TestimonialsCarousel.tsx', 'app/(portal)/page.tsx', 'app/modeling/page.tsx']) {
  const src = read(rel);
  ok(`${rel} imports the byline helper`, src.includes('testimonialByline'));
  ok(`${rel} no longer joins role and company inline`, !/\[t\.role,\s*t\.company\][\s\S]{0,40}join\(/.test(src));
}
ok('carousel byline goes through the helper', /const subtitle = testimonialByline\(/.test(read('app/training/TestimonialsCarousel.tsx')));

// ── 4. Submission forms expose the field ───────────────────────────────────
for (const rel of [
  'app/training/submit-testimonial/page.tsx',
  'app/modeling/submit-testimonial/page.tsx',
  'src/shared/components/ShareExperienceModal.tsx',
]) {
  ok(`${rel} labels the field Company / Organization`, read(rel).includes('Company / Organization'));
}
const modal = read('src/shared/components/ShareExperienceModal.tsx');
ok('share modal has a company input on BOTH tabs', (modal.match(/setCompany\(e\.target\.value\)/g) ?? []).length >= 2);

// ── 5. Per-hub payload matches what each route reads ───────────────────────
ok('modal posts testimonial_type for modeling', /testimonial_type:\s*type/.test(modal));
ok('modal posts text for modeling', /text:\s*content/.test(modal));
ok('modal posts video_url for modeling', /video_url:\s*videoUrl/.test(modal));
ok('modal posts role for modeling', /role:\s*jobTitle/.test(modal));
ok('modal posts linkedin_url for modeling', /linkedin_url:\s*linkedinUrl/.test(modal));
ok('modal keeps camelCase payload for training', /registrationId:\s*regId/.test(modal));
ok('modal routes each hub to its own API', modal.includes("'/api/testimonials/student'") && modal.includes("'/api/modeling/submit-testimonial'"));

// Every key the modeling route reads must be present in the modeling payload.
const modelingBranch = modal.slice(modal.indexOf('email:            studentEmail'), modal.indexOf('email:            studentEmail') + 400);
for (const key of ['testimonial_type', 'text', 'video_url', 'role', 'company', 'linkedin_url', 'rating']) {
  ok(`modeling payload carries ${key}`, modelingBranch.includes(`${key}:`) || modelingBranch.includes(`${key},`));
}

// ── 6. Modeling dashboard offers the MODELING share button ─────────────────
const dash = read('app/modeling/dashboard/page.tsx');
ok('modeling dashboard mounts the share modal', dash.includes('ShareExperienceModal'));
ok('modeling dashboard passes hub="modeling"', /hub="modeling"/.test(dash));
ok('modeling dashboard never passes hub="training"', !/hub="training"/.test(dash));
ok('modeling dashboard has the share button', dash.includes('modeling-share-experience'));
ok('share prompt hidden for no-plan users', /!noPlan && !shareDone/.test(dash));

const trainingDash = read('app/training/dashboard/page.tsx');
ok('training dashboard still passes hub="training"', /hub="training"/.test(trainingDash));

console.log(`\nverify-testimonial-company: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
