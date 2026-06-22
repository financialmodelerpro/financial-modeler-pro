/**
 * verify-trial-days.ts
 *
 * Pure tests for the single-source trial length. Proves the trial length comes
 * from the Trial plan's trial_days (entitlement_plans), with a default fallback,
 * and that trial_ends_at is computed from that one value.
 *
 * Run: npx tsx scripts/verify-trial-days.ts
 */
import { trialDaysFromPlans } from '../src/shared/entitlements/pricingDisplay';
import { trialEndsAtIso, DEFAULT_TRIAL_DAYS } from '../src/shared/entitlements/trialConfig';

let pass = 0, fail = 0; const fails: string[] = [];
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { pass++; console.log(`  [PASS] ${name}`); }
  else { fail++; fails.push(name); console.log(`  [FAIL] ${name}${detail ? ` :: ${detail}` : ''}`); }
};

console.log('=== Trial days single source ===');

// The value comes from the Trial plan's trial_days.
const plans = [
  { plan_key: 'trial', trial_days: 21 },
  { plan_key: 'solo', trial_days: null },
  { plan_key: 'pro', trial_days: null },
];
check('reads the Trial plan trial_days (21)', trialDaysFromPlans(plans, DEFAULT_TRIAL_DAYS) === 21);

// Changing the admin value changes the resolved number (single source).
check('admin sets 30 -> resolves 30', trialDaysFromPlans([{ plan_key: 'trial', trial_days: 30 }], DEFAULT_TRIAL_DAYS) === 30);

// Fallback when missing / non-positive / no trial plan.
check('null trial_days -> fallback default', trialDaysFromPlans([{ plan_key: 'trial', trial_days: null }], DEFAULT_TRIAL_DAYS) === DEFAULT_TRIAL_DAYS);
check('zero trial_days -> fallback default', trialDaysFromPlans([{ plan_key: 'trial', trial_days: 0 }], DEFAULT_TRIAL_DAYS) === DEFAULT_TRIAL_DAYS);
check('no trial plan -> fallback default', trialDaysFromPlans([{ plan_key: 'pro', trial_days: 9 }], DEFAULT_TRIAL_DAYS) === DEFAULT_TRIAL_DAYS);
check('DEFAULT_TRIAL_DAYS is 14', DEFAULT_TRIAL_DAYS === 14);

// trial_ends_at is computed from the resolved value (now + days).
const NOW = Date.parse('2026-06-22T00:00:00Z');
const days = trialDaysFromPlans(plans, DEFAULT_TRIAL_DAYS);
const endsAt = trialEndsAtIso(NOW, days);
const expected = new Date(NOW + 21 * 24 * 60 * 60 * 1000).toISOString();
check('trial_ends_at = now + Trial plan days', endsAt === expected, `${endsAt} vs ${expected}`);

console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
if (fail) { console.log('Failures: ' + fails.join(' | ')); process.exit(1); }
