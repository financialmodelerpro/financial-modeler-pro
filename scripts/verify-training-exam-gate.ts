/**
 * verify-training-exam-gate.ts
 *
 * Guards the corrected Training model-submission gate predicates
 * (src/hubs/training/lib/modelSubmission/examGate.ts):
 *   - Exam access is gated only by "has a model been submitted" (any status).
 *   - The result + certificate are withheld until the model is approved.
 *
 * These predicates are the single source of truth shared by the server
 * recording gate (/api/training/submit-assessment) and the dashboard UI
 * (CourseContent). A regression that re-couples exam access to approval, or
 * stops withholding the result, fails here red.
 *
 * Run: npx tsx scripts/verify-training-exam-gate.ts
 */
import {
  examUnlockedBySubmission, examLockedNoSubmission, resultWithheldUntilApproval,
} from '../src/hubs/training/lib/modelSubmission/examGate';

let passed = 0, failed = 0; const fails: string[] = [];
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) { passed++; console.log(`  [PASS] ${label}`); }
  else { failed++; fails.push(label); console.log(`  [FAIL] ${label}${detail ? ` :: ${detail}` : ''}`); }
}

type S = { required: boolean; latestStatus: 'none' | 'pending_review' | 'rejected' | 'approved'; hasApproved: boolean };
const expect = (s: S, unlocked: boolean, withheld: boolean, label: string): void => {
  check(`${label}: exam ${unlocked ? 'UNLOCKED' : 'LOCKED'}`, examUnlockedBySubmission(s) === unlocked, `got unlocked=${examUnlockedBySubmission(s)}`);
  check(`${label}: examLockedNoSubmission is the inverse`, examLockedNoSubmission(s) === !unlocked);
  check(`${label}: result ${withheld ? 'WITHHELD' : 'DECLARED'}`, resultWithheldUntilApproval(s) === withheld, `got withheld=${resultWithheldUntilApproval(s)}`);
};

console.log('=== Training exam-gate predicates ===\n');

// Gate not required: exam always open, nothing withheld.
expect({ required: false, latestStatus: 'none', hasApproved: false }, true, false, 'gate OFF / no submission');
expect({ required: false, latestStatus: 'approved', hasApproved: true }, true, false, 'gate OFF / approved');

// Gate required: access keyed ONLY on "submitted".
expect({ required: true, latestStatus: 'none', hasApproved: false }, false, true, 'required / NO submission');
expect({ required: true, latestStatus: 'pending_review', hasApproved: false }, true, true, 'required / pending (NEW: unlocks)');
expect({ required: true, latestStatus: 'rejected', hasApproved: false }, true, true, 'required / rejected (still submitted)');
expect({ required: true, latestStatus: 'approved', hasApproved: true }, true, false, 'required / approved (result declared)');
// Sticky approval: a later pending resubmission keeps approved access + declared result.
expect({ required: true, latestStatus: 'pending_review', hasApproved: true }, true, false, 'required / pending after prior approval (sticky)');

// Null / undefined status (gate not loaded) treated as open.
check('null status treats exam as unlocked', examUnlockedBySubmission(null) === true);
check('undefined status treats exam as unlocked', examUnlockedBySubmission(undefined) === true);
check('null status does not withhold', resultWithheldUntilApproval(null) === false);

// ── Existing-student regression matrix (no student loses access) ─────────────
console.log('\n=== Existing-student regression (no access lost) ===');
const oldApproved: S = { required: true, latestStatus: 'approved', hasApproved: true };
const oldPending: S = { required: true, latestStatus: 'pending_review', hasApproved: false };
const newPending: S = { required: true, latestStatus: 'pending_review', hasApproved: false };
const noSubmission: S = { required: true, latestStatus: 'none', hasApproved: false };
check('OLD approved student can still take the exam', examUnlockedBySubmission(oldApproved));
check('OLD approved student result is declared (not withheld)', !resultWithheldUntilApproval(oldApproved));
check('OLD previously-submitted PENDING student can NOW take the exam', examUnlockedBySubmission(oldPending));
check('OLD pending student result stays withheld until approval', resultWithheldUntilApproval(oldPending));
check('NEW submission unlocks the exam immediately', examUnlockedBySubmission(newPending));
check('candidate with NO submission still cannot take the exam', examLockedNoSubmission(noSubmission));

console.log(`\n=== Result: ${passed} passed, ${failed} failed ===`);
if (failed) { console.log('Failures: ' + fails.join(' | ')); process.exit(1); }
