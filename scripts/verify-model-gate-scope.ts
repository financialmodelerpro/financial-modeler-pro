/**
 * verify-model-gate-scope.ts
 *
 * Brief regression guard for the hot fix that scopes the model-submission
 * gate to Final Exams only. Two failure modes the gate must reject:
 *   1. Session 2 (or any non-final session) triggering the gate.
 *   2. Apps Script returning a "first upload model" error for a per-session
 *      quiz being passed through to the student.
 *
 * Final Exam triggering must keep working (otherwise the cert flow breaks).
 *
 * Run:  npx tsx scripts/verify-model-gate-scope.ts
 */

import {
  resolveIsFinal,
  looksLikeModelGateError,
} from '../src/hubs/training/lib/assessment/modelGateScope';

let pass = 0;
let fail = 0;

function expect(label: string, actual: unknown, expected: unknown): void {
  const ok = actual === expected;
  if (ok) {
    pass++;
    console.log(`  PASS  ${label}`);
  } else {
    fail++;
    console.log(`  FAIL  ${label}  expected=${String(expected)}  actual=${String(actual)}`);
  }
}

console.log('\n[verify-model-gate-scope] resolveIsFinal');
expect('3SFM_S1 is not final',     resolveIsFinal('3SFM_S1'),     false);
expect('3SFM_S2 is not final',     resolveIsFinal('3SFM_S2'),     false);
expect('3SFM_S17 is not final',    resolveIsFinal('3SFM_S17'),    false);
expect('3SFM_S18 IS final',        resolveIsFinal('3SFM_S18'),    true);
expect('3SFM_Final IS final',      resolveIsFinal('3SFM_Final'),  true);
expect('BVM_L1 is not final',      resolveIsFinal('BVM_L1'),      false);
expect('BVM_L7 IS final',          resolveIsFinal('BVM_L7'),      true);
expect('BVM_Final IS final',       resolveIsFinal('BVM_Final'),   true);
expect('unknown course returns false', resolveIsFinal('XYZ_S1'),  false);
expect('empty string returns false',   resolveIsFinal(''),        false);
expect('no underscore returns false',  resolveIsFinal('garbage'), false);

console.log('\n[verify-model-gate-scope] looksLikeModelGateError');
expect('plain "first upload model"',
  looksLikeModelGateError('first upload model'), true);
expect('"please submit your model first"',
  looksLikeModelGateError('please submit your model first'), true);
expect('"model not approved yet"',
  looksLikeModelGateError('Your model is not approved yet'), true);
expect('mentions model only (no upload/submit/approve) -> false',
  looksLikeModelGateError('model is not loaded'), false);
expect('unrelated error -> false',
  looksLikeModelGateError('Network timeout'), false);
expect('empty string -> false',
  looksLikeModelGateError(''), false);

console.log(`\n[verify-model-gate-scope] ${pass} pass / ${fail} fail`);
if (fail > 0) process.exit(1);
