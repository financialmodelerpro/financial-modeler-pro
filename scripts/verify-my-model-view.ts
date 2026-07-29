/**
 * scripts/verify-my-model-view.ts
 *
 * Pins the reviewed-model return path end to end:
 *
 *  1. The marked-up model comes back on EITHER decision (it used to be
 *     approve-only, which withheld feedback from the students being sent back
 *     for another attempt).
 *  2. Both review emails render an absolute download link when a file was
 *     attached, and no link at all when one was not (no dead button).
 *  3. Every dashboard/email deep link is ABSOLUTE. A relative href in an email
 *     is dead, and a perl sweep briefly made exactly that mistake here.
 *  4. The student can reach both halves of an attempt (their own file and the
 *     reviewed copy) through ownership-checked routes, and the My Model view
 *     is wired into the sidebar.
 *
 * Renders real email HTML + asserts on source. No DB, no network:
 *   npx tsx scripts/verify-my-model-view.ts
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { modelSubmissionApprovedTemplate } from '../src/shared/email/templates/modelSubmissionApproved';
import { modelSubmissionRejectedTemplate } from '../src/shared/email/templates/modelSubmissionRejected';

const ROOT = join(__dirname, '..');
let pass = 0;
let fail = 0;

function ok(label: string, cond: boolean) {
  if (cond) { pass++; return; }
  fail++;
  console.error(`FAIL ${label}`);
}
function read(rel: string): string { return readFileSync(join(ROOT, rel), 'utf8'); }

const FILE_URL = 'https://learn.financialmodelerpro.com/api/training/model-submission/abc-123/reviewed-file';

async function main() {
  // ── 1. Reject carries the reviewed file ───────────────────────────────────
  const reviewRoute = read('app/api/admin/model-submissions/[id]/review/route.ts');
  ok('review route no longer gates the upload on approve',
    !/if \(decision === 'approve' && reviewedFile\)/.test(reviewRoute));
  ok('review route uploads whenever a file is attached', /if \(reviewedFile\) \{/.test(reviewRoute));
  ok('rejected email receives a reviewedFileUrl',
    /modelSubmissionRejectedTemplate\(\{[\s\S]{0,600}reviewedFileUrl:/.test(reviewRoute));
  ok('approved email still receives a reviewedFileUrl',
    /modelSubmissionApprovedTemplate\(\{[\s\S]{0,600}reviewedFileUrl:/.test(reviewRoute));

  const adminUi = read('app/admin/training-hub/model-submissions/page.tsx');
  ok('admin UI posts multipart on either decision', /const res = reviewedFile$/m.test(adminUi) || /const res = reviewedFile\s*$/m.test(adminUi));
  ok('admin UI no longer restricts the file to approve', !/decision === 'approve' && reviewedFile/.test(adminUi));

  // ── 2. Emails render the link only when a file exists ────────────────────
  const rejWith = await modelSubmissionRejectedTemplate({
    name: 'Ali', courseLabel: '3SFM', fileName: 'model.xlsx', attemptNumber: 1,
    attemptsRemaining: 2, maxAttempts: 3, reviewerNote: 'Fix the debt schedule.',
    reviewedFileUrl: FILE_URL, reviewedFileName: 'model_reviewed.xlsx',
  });
  ok('reject email links the marked-up model', rejWith.html.includes(FILE_URL));
  ok('reject email names the file', rejWith.html.includes('model_reviewed.xlsx'));
  ok('reject plain text carries the link', rejWith.text.includes(FILE_URL));

  const rejWithout = await modelSubmissionRejectedTemplate({
    name: 'Ali', courseLabel: '3SFM', fileName: 'model.xlsx', attemptNumber: 1,
    attemptsRemaining: 2, maxAttempts: 3, reviewerNote: 'Fix the debt schedule.',
  });
  ok('reject email without a file shows no download block', !rejWithout.html.includes('marked-up model'));
  ok('reject email without a file still renders', rejWithout.html.length > 500);
  ok('reject email without a file keeps the reviewer note', rejWithout.html.includes('Fix the debt schedule.'));

  const appWith = await modelSubmissionApprovedTemplate({
    name: 'Ali', courseLabel: '3SFM', fileName: 'model.xlsx', attemptNumber: 2,
    reviewerNote: 'Good work.', reviewedFileUrl: FILE_URL, reviewedFileName: 'model_reviewed.xlsx',
  });
  ok('approve email links the reviewed model', appWith.html.includes(FILE_URL));

  // ── 3. Every link is absolute (a relative href in an email is dead) ───────
  for (const [label, html] of [
    ['reject+file', rejWith.html], ['reject-only', rejWithout.html], ['approve+file', appWith.html],
  ] as [string, string][]) {
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map(m => m[1]);
    ok(`${label}: has at least one link`, hrefs.length > 0);
    ok(`${label}: no relative href`, hrefs.every(h => /^(https?:|mailto:)/i.test(h)));
  }
  for (const [label, txt] of [['reject+file', rejWith.text], ['approve+file', appWith.text]] as [string, string][]) {
    ok(`${label}: text deep link is absolute`, !/(^|\s)\/training\/dashboard/.test(txt));
  }

  // Both templates deep-link to the My Model tab.
  ok('reject email deep-links My Model', rejWith.html.includes('/training/dashboard?tab=my-model'));
  ok('approve email deep-links My Model', appWith.html.includes('/training/dashboard?tab=my-model'));

  // ── 4. Student routes + sidebar wiring ───────────────────────────────────
  const ownFile = read('app/api/training/model-submission/[id]/file/route.ts');
  ok('own-file route checks the training session', ownFile.includes('getTrainingCookieSession'));
  ok('own-file route enforces ownership', /sub\.email\.toLowerCase\(\) !== session\.email\.toLowerCase\(\)/.test(ownFile));
  ok('own-file route streams bytes (no signed URL)', ownFile.includes('.download(') && !ownFile.includes('createSignedUrl'));

  const history = read('app/api/training/model-submission/history/route.ts');
  ok('history route scopes rows to the session email', /\.ilike\('email', session\.email/.test(history));
  ok('history route accepts no id (cannot be probed)', !/params/.test(history));
  ok('history route never leaks storage paths',
    !/storage_path:/.test(history) && !/reviewed_file_path:/.test(history));
  ok('history route exposes only a hasReviewedFile flag', history.includes('hasReviewedFile'));

  const view = read('src/hubs/training/components/dashboard/MyModelView.tsx');
  ok('view downloads the student\'s own file', view.includes('/file`'));
  ok('view downloads the reviewed file', view.includes('/reviewed-file`'));
  ok('view renders every attempt, not just the latest', view.includes('attempts.map'));

  const dash = read('app/training/dashboard/page.tsx');
  ok('dashboard imports the view', dash.includes('MyModelView'));
  ok('dashboard has a my-model view state', /'my-model'/.test(dash));
  ok('dashboard renders the view', /activeView === 'my-model'/.test(dash));
  ok('dashboard honours ?tab=my-model', /tabParam === 'my-model'/.test(dash));

  // ── 5. House style ───────────────────────────────────────────────────────
  for (const rel of [
    'src/hubs/training/components/dashboard/MyModelView.tsx',
    'app/api/training/model-submission/history/route.ts',
    'app/api/training/model-submission/[id]/file/route.ts',
    'src/shared/email/templates/modelSubmissionRejected.ts',
  ]) {
    ok(`${rel} has no em dash`, !read(rel).includes('—'));
  }

  console.log(`\nverify-my-model-view: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
