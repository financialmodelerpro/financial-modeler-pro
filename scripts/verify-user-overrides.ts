/**
 * verify-user-overrides.ts
 *
 * Pure tests for the per-user override resolver (resolveEffectiveFeatures).
 * No DB: proves override-beats-plan, expired overrides are ignored, limit
 * overrides replace the plan cap, Unlimited (-1) survives, and the explicit
 * grant + revoke test case the Phase C brief asks for.
 *
 * Run: npx tsx scripts/verify-user-overrides.ts
 */
import {
  resolveEffectiveFeatures,
  isOverrideActive,
  type ResolveFeature,
  type PlanCell,
  type UserOverride,
} from '../src/shared/entitlements/resolveOverrides';

let pass = 0, fail = 0; const fails: string[] = [];
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { pass++; console.log(`  [PASS] ${name}`); }
  else { fail++; fails.push(name); console.log(`  [FAIL] ${name}${detail ? ` :: ${detail}` : ''}`); }
};

// A small representative feature list (two gate modules, one export gate, one limit).
const features: ResolveFeature[] = [
  { feature_key: 'module_1', label: 'Module 1', category: 'module', feature_type: 'gate', display_order: 1, moduleStatus: 'live' },
  { feature_key: 'module_7', label: 'Module 7', category: 'module', feature_type: 'gate', display_order: 7, moduleStatus: 'coming_soon' },
  { feature_key: 'pdf_export', label: 'PDF Export', category: 'export', feature_type: 'gate', display_order: 12 },
  { feature_key: 'excel_formula', label: 'Excel (formula)', category: 'export', feature_type: 'gate', display_order: 14 },
  { feature_key: 'projects', label: 'Saved Projects', category: 'limits', feature_type: 'limit', display_order: 18 },
];

// Plan coverage: module_1 + pdf_export included; module_7 + excel_formula NOT;
// projects capped at 3. (Mirrors a Solo-like plan.)
const planCells = new Map<string, PlanCell>([
  ['module_1', { included: true, limit_value: null }],
  ['module_7', { included: false, limit_value: null }],
  ['pdf_export', { included: true, limit_value: null }],
  ['excel_formula', { included: false, limit_value: null }],
  ['projects', { included: true, limit_value: 3 }],
]);

const NOW = Date.parse('2026-06-22T00:00:00Z');
const FUTURE = '2030-01-01T00:00:00Z';
const PAST = '2020-01-01T00:00:00Z';

console.log('=== Per-user override resolver ===');

// ── The brief test case: one GRANT (module_7, not in plan) + one REVOKE (pdf_export, in plan) ──
console.log('\n-- Test case: user with one grant + one revoke --');
const tcOverrides: UserOverride[] = [
  { feature_key: 'module_7', mode: 'grant', override_value: null, reason: 'beta access', expires_at: null },
  { feature_key: 'pdf_export', mode: 'revoke', override_value: null, reason: 'abuse', expires_at: null },
];
const tc = resolveEffectiveFeatures(features, planCells, tcOverrides, NOW);
const m7 = tc.find((r) => r.feature_key === 'module_7')!;
const pdf = tc.find((r) => r.feature_key === 'pdf_export')!;
const m1 = tc.find((r) => r.feature_key === 'module_1')!;
check('GRANT: module_7 NOT in plan, now included via override', m7.included === true && m7.source === 'override');
check('REVOKE: pdf_export in plan, now excluded via override', pdf.included === false && pdf.source === 'override');
check('untouched: module_1 stays included via plan', m1.included === true && m1.source === 'plan');
console.log(`     module_7 : plan=${m7.planIncluded} -> effective=${m7.included} (${m7.source})`);
console.log(`     pdf_export: plan=${pdf.planIncluded} -> effective=${pdf.included} (${pdf.source})`);
console.log(`     module_1 : plan=${m1.planIncluded} -> effective=${m1.included} (${m1.source})`);

// ── Expired overrides are ignored (plan baseline shows through) ──
console.log('\n-- Expired overrides ignored --');
const expiredOverrides: UserOverride[] = [
  { feature_key: 'module_7', mode: 'grant', override_value: null, reason: null, expires_at: PAST },   // expired grant
  { feature_key: 'pdf_export', mode: 'revoke', override_value: null, reason: null, expires_at: PAST }, // expired revoke
];
const exp = resolveEffectiveFeatures(features, planCells, expiredOverrides, NOW);
const m7e = exp.find((r) => r.feature_key === 'module_7')!;
const pdfe = exp.find((r) => r.feature_key === 'pdf_export')!;
check('expired grant ignored: module_7 falls back to plan (excluded)', m7e.included === false && m7e.source === 'none');
check('expired revoke ignored: pdf_export falls back to plan (included)', pdfe.included === true && pdfe.source === 'plan');
check('expired override is flagged expired on the row', m7e.override?.expired === true && pdfe.override?.expired === true);

// ── A future-dated override IS active ──
const futureGrant: UserOverride[] = [{ feature_key: 'excel_formula', mode: 'grant', override_value: null, reason: null, expires_at: FUTURE }];
const fut = resolveEffectiveFeatures(features, planCells, futureGrant, NOW);
const xf = fut.find((r) => r.feature_key === 'excel_formula')!;
check('future-dated grant is active (excel_formula included)', xf.included === true && xf.source === 'override' && xf.override?.expired === false);

// ── Limit override replaces the plan cap; Unlimited (-1) survives ──
console.log('\n-- Limit overrides --');
const limitOverride: UserOverride[] = [{ feature_key: 'projects', mode: 'grant', override_value: 25, reason: 'power user', expires_at: null }];
const lim = resolveEffectiveFeatures(features, planCells, limitOverride, NOW);
const proj = lim.find((r) => r.feature_key === 'projects')!;
check('limit override: projects 3 -> 25 via override', proj.value === 25 && proj.source === 'override' && proj.planValue === 3);

const unlimitedOverride: UserOverride[] = [{ feature_key: 'projects', mode: 'grant', override_value: -1, reason: null, expires_at: null }];
const unl = resolveEffectiveFeatures(features, planCells, unlimitedOverride, NOW);
const projU = unl.find((r) => r.feature_key === 'projects')!;
check('limit override: projects -> Unlimited (-1) survives', projU.value === -1 && projU.included === true);

// ── No overrides: pure plan passthrough ──
const none = resolveEffectiveFeatures(features, planCells, [], NOW);
check('no overrides: included set = plan included set', none.filter((r) => r.included).map((r) => r.feature_key).sort().join(',') === 'module_1,pdf_export,projects');

// ── isOverrideActive edge cases ──
check('isOverrideActive: no expiry is active', isOverrideActive({ expires_at: null }, NOW) === true);
check('isOverrideActive: past expiry is inactive', isOverrideActive({ expires_at: PAST }, NOW) === false);
check('isOverrideActive: future expiry is active', isOverrideActive({ expires_at: FUTURE }, NOW) === true);

console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
if (fail) { console.log('Failures: ' + fails.join(' | ')); process.exit(1); }
