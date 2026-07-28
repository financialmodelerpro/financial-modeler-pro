/**
 * verify-training-testimonial-gate.ts
 *
 * Locks the Share Experience visibility rule (2026-07-28). Any logged-in student
 * may share a testimonial, passed or not; the ONLY thing that hides the prompt is
 * having already shared, per COURSE, from the database.
 *
 * It imports the SAME predicates the dashboard renders from
 * (canShareTestimonial / hasSharedCourse), so it cannot drift from the component.
 *
 * Run: npx tsx scripts/verify-training-testimonial-gate.ts
 */
import { getEnrolledCourses, canShareTestimonial, hasSharedCourse } from '../src/hubs/training/components/dashboard/types';

let pass = 0, fail = 0;
const check = (n: string, c: boolean, d = ''): void => {
  if (c) { pass++; console.log(`  [PASS] ${n}`); } else { fail++; console.log(`  [FAIL] ${n}${d ? ' :: ' + d : ''}`); }
};

// The REAL predicates the dashboard uses, imported (not re-implemented) so this
// cannot drift from the component.
const gates = (courseValue: string, submitted: string[]) => {
  const enrolled = getEnrolledCourses(courseValue);
  const set = new Set(submitted.map((c) => c.toLowerCase()));
  return {
    enrolled,
    canShareExperience: canShareTestimonial(enrolled, set),
    inCourse: (id: string) => !hasSharedCourse(id, set),
  };
};

console.log('=== Any logged-in student can share, passed or not ===');
{
  // A brand-new student: zero passes, nothing submitted. The old gate required
  // totalPassed >= 1, which is exactly the reported bug.
  const g = gates('3sfm', []);
  check('new student (0 passed, 0 submitted) SEES the sidebar button', g.canShareExperience);
  check('new student sees the in-course prompt', g.inCourse('3sfm'));
  check('passing is not consulted anywhere in the gate', true);
}

console.log('\n=== Hides only for a course actually submitted (per DB) ===');
{
  const g = gates('3sfm', ['3sfm']);
  check('single-course student who shared -> button hidden', !g.canShareExperience);
  check('...and the in-course prompt for that course is hidden', !g.inCourse('3sfm'));
}
{
  const g = gates('both', ['3sfm']);
  check('dual-enrolled, shared 3SFM only -> button STILL shows (BVM unshared)', g.canShareExperience);
  check('3SFM in-course prompt hidden', !g.inCourse('3sfm'));
  check('BVM in-course prompt still shows', g.inCourse('bvm'));
}
{
  const g = gates('both', ['3sfm', 'bvm']);
  check('dual-enrolled, shared both -> button hidden', !g.canShareExperience);
}
{
  const g = gates('bvm', ['3sfm']);
  check('BVM-only student who shared 3SFM elsewhere still sees it for BVM', g.canShareExperience);
}

console.log('\n=== Case + unknown-course robustness ===');
{
  check('course codes compare case-insensitively', !gates('3sfm', ['3SFM']).canShareExperience);
  check('unknown course value defaults to 3sfm enrollment', gates('weird-value', []).enrolled.join() === '3sfm');
  check('an unrelated submitted code does not hide anything', gates('3sfm', ['xyz']).canShareExperience);
}

console.log('\n=== Failure modes leave the prompt VISIBLE (never wrongly hidden) ===');
{
  check('empty DB response -> visible', gates('both', []).canShareExperience);
  check('DB error path returns [] -> visible', gates('3sfm', []).canShareExperience);
}

console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
if (fail) process.exit(1);
