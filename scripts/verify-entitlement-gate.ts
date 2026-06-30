/**
 * verify-entitlement-gate.ts
 *
 * Pure tests for the live entitlement gate (computeGate + cap helpers), which
 * sits on top of the REUSED Phase C resolver (resolveEffectiveFeatures). No DB.
 *
 * Proves the brief's verification matrix:
 *   - reconciliation result (pro/firm/trial feature sets resolve correctly)
 *   - safety net (unknown plan -> full access, never locked out)
 *   - admin bypass (full access everywhere)
 *   - firm (all included), trial (only trial features), solo/pro (match plan)
 *   - override at the gate (grant unlocks, revoke locks)
 *   - trial expiry (loses paid features at the gate)
 *   - cap + archive (at cap blocked, unlimited bypass, unarchive=create)
 *   - fail-closed shape (denied gate denies non-admin, admin still passes)
 *
 * Run: npx tsx scripts/verify-entitlement-gate.ts
 */
import {
  computeGate,
  featureAllowed,
  canAddActiveProject,
  capCheck,
  isKnownPlanKey,
  isNonePlan,
  isNoPlanLockedOut,
  computeLapseState,
  addCalendarMonths,
  resolveLapseAnchorMs,
  writeBlockReason,
  GRACE_PERIOD_MONTHS,
  NONE_PLAN_KEY,
  type GateInput,
} from '../src/shared/entitlements/gate';
import type { ResolveFeature, PlanCell, UserOverride } from '../src/shared/entitlements/resolveOverrides';

let pass = 0, fail = 0; const fails: string[] = [];
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { pass++; console.log(`  [PASS] ${name}`); }
  else { fail++; fails.push(name); console.log(`  [FAIL] ${name}${detail ? ` :: ${detail}` : ''}`); }
};

// ── Feature catalog (subset that exercises every gate point) ──────────────────
const FEATURES: ResolveFeature[] = [
  { feature_key: 'module_1', label: 'M1', category: 'module', feature_type: 'gate', display_order: 1, moduleStatus: 'live' },
  { feature_key: 'module_6', label: 'M6 Scenarios', category: 'module', feature_type: 'gate', display_order: 6, moduleStatus: 'live' },
  { feature_key: 'module_10', label: 'M10', category: 'module', feature_type: 'gate', display_order: 10, moduleStatus: 'pro' },
  { feature_key: 'module_11', label: 'M11', category: 'module', feature_type: 'gate', display_order: 11, moduleStatus: 'enterprise' },
  { feature_key: 'pdf_export', label: 'PDF', category: 'export', feature_type: 'gate', display_order: 12 },
  { feature_key: 'excel_snapshot', label: 'Excel snap', category: 'export', feature_type: 'gate', display_order: 13 },
  { feature_key: 'excel_formula', label: 'Excel formula', category: 'export', feature_type: 'gate', display_order: 14 },
  { feature_key: 'white_label_pdf', label: 'WL PDF', category: 'export', feature_type: 'gate', display_order: 15 },
  { feature_key: 'sensitivity', label: 'Sensitivity', category: 'analysis', feature_type: 'gate', display_order: 16 },
  { feature_key: 'versioning', label: 'Versioning', category: 'platform', feature_type: 'gate', display_order: 17 },
  { feature_key: 'branding', label: 'Branding', category: 'branding', feature_type: 'gate', display_order: 21 },
  { feature_key: 'projects', label: 'Projects', category: 'limits', feature_type: 'limit', display_order: 18 },
];

// ── plan_permissions fixtures mirroring migration 158 seed ────────────────────
const PLAN: Record<string, Map<string, PlanCell>> = {
  trial: new Map([
    ['module_1', { included: true, limit_value: null }],
    ['module_6', { included: true, limit_value: null }],
    ['pdf_export', { included: true, limit_value: null }],
    ['excel_snapshot', { included: false, limit_value: null }],
    ['excel_formula', { included: false, limit_value: null }],
    ['sensitivity', { included: false, limit_value: null }],
    ['versioning', { included: false, limit_value: null }],
    ['branding', { included: false, limit_value: null }],
    ['projects', { included: true, limit_value: 1 }],
  ]),
  solo: new Map([
    ['module_1', { included: true, limit_value: null }],
    ['module_6', { included: true, limit_value: null }],
    ['pdf_export', { included: true, limit_value: null }],
    ['excel_snapshot', { included: true, limit_value: null }],
    ['excel_formula', { included: false, limit_value: null }],
    ['sensitivity', { included: true, limit_value: null }],
    ['versioning', { included: true, limit_value: null }],
    ['branding', { included: false, limit_value: null }],
    ['projects', { included: true, limit_value: 3 }],
  ]),
  pro: new Map([
    ['module_1', { included: true, limit_value: null }],
    ['module_6', { included: true, limit_value: null }],
    ['module_10', { included: true, limit_value: null }],
    ['pdf_export', { included: true, limit_value: null }],
    ['excel_snapshot', { included: true, limit_value: null }],
    ['excel_formula', { included: true, limit_value: null }],
    ['white_label_pdf', { included: true, limit_value: null }],
    ['sensitivity', { included: true, limit_value: null }],
    ['versioning', { included: true, limit_value: null }],
    ['branding', { included: true, limit_value: null }],
    ['projects', { included: true, limit_value: 25 }],
  ]),
  firm: new Map(FEATURES.map((f) => [f.feature_key, { included: true, limit_value: f.feature_type === 'limit' ? -1 : null } as PlanCell])),
};

const NOW = Date.parse('2026-06-22T00:00:00Z');
const baseInput = (over: Partial<GateInput>): GateInput => ({
  isAdmin: false, planKey: 'solo', knownPlan: true, trialExpired: false,
  features: FEATURES, planCells: PLAN.solo, overrides: [], nowMs: NOW, ...over,
});

const GATE_POINTS = ['module_1', 'module_6', 'pdf_export', 'excel_snapshot', 'excel_formula', 'white_label_pdf', 'sensitivity', 'versioning', 'branding'];

// ── 1. Reconciliation: former professional->pro, enterprise->firm, free->trial.
console.log('=== Reconciliation (resolved feature sets per new plan) ===');
const proGate = computeGate(baseInput({ planKey: 'pro', planCells: PLAN.pro }));
check('former professional resolves as pro: excel_formula + branding included', proGate.featureMap.excel_formula.included && proGate.featureMap.branding.included);
check('pro: white_label_pdf included, module_10 included', proGate.featureMap.white_label_pdf.included && proGate.featureMap.module_10.included);
check('pro: projects cap = 25', proGate.projectLimit === 25);

const firmGate = computeGate(baseInput({ planKey: 'firm', planCells: PLAN.firm }));
check('former enterprise resolves as firm: EVERY gate point included', GATE_POINTS.every((k) => featureAllowed(firmGate, k)));
check('firm: projects unlimited (-1)', firmGate.projectLimit === -1);
check('firm: module_11 (enterprise) included', firmGate.featureMap.module_11.included);

const trialGate = computeGate(baseInput({ planKey: 'trial', planCells: PLAN.trial }));
check('former free resolves as trial: module_1 + module_6 + pdf included', trialGate.featureMap.module_1.included && trialGate.featureMap.module_6.included && trialGate.featureMap.pdf_export.included);
check('trial: NO export(excel) / NO sensitivity / NO versioning / NO branding',
  !trialGate.featureMap.excel_formula.included && !trialGate.featureMap.sensitivity.included && !trialGate.featureMap.versioning.included && !trialGate.featureMap.branding.included);
check('trial: exactly one project, no archive', trialGate.projectLimit === 1 && trialGate.archiveAllowed === false);

// ── 2. Safety net: unknown plan -> full access, never locked out.
console.log('\n=== Safety net (unknown plan key) ===');
check('isKnownPlanKey: legacy keys are NOT known', !isKnownPlanKey('professional') && !isKnownPlanKey('free') && !isKnownPlanKey('enterprise'));
check('isKnownPlanKey: new keys ARE known', ['trial', 'solo', 'pro', 'firm'].every(isKnownPlanKey));
const unknownGate = computeGate(baseInput({ planKey: 'legacy_weird', knownPlan: false, planCells: new Map() }));
check('unknown plan: fullAccess granted (access-preserving)', unknownGate.fullAccess === true);
check('unknown plan: every gate point allowed (no lockout)', GATE_POINTS.every((k) => featureAllowed(unknownGate, k)));
check('unknown plan: projects unlimited', unknownGate.projectLimit === -1);

// ── 2b. None state: deliberate NO-ACCESS, distinct from the unknown safety net.
console.log('\n=== None state (deliberate no-access, distinct from unknown) ===');
check('NONE_PLAN_KEY is "none"', NONE_PLAN_KEY === 'none');
check('isNonePlan true for none, false for others', isNonePlan('none') && !isNonePlan('pro') && !isNonePlan('legacy_weird'));
check('none is NOT a known (paid) plan key', !isKnownPlanKey('none'));
const noneGate = computeGate(baseInput({ planKey: NONE_PLAN_KEY, knownPlan: false, planCells: new Map() }));
check('none: NOT fullAccess (does not hit the safety net)', noneGate.fullAccess === false);
check('none: every gate point DENIED (zero entitlements)', GATE_POINTS.every((k) => !featureAllowed(noneGate, k)));
check('none: no projects, no archive', noneGate.projectLimit === 0 && noneGate.archiveAllowed === false);
check('none vs unknown are DISTINCT: none denies, unknown grants', noneGate.fullAccess === false && unknownGate.fullAccess === true);
// A none user must not gain access via an override (access requires a plan).
const noneGrantOv: UserOverride[] = [{ feature_key: 'sensitivity', mode: 'grant', override_value: null, reason: 'beta', expires_at: null }];
const noneWithGrant = computeGate(baseInput({ planKey: NONE_PLAN_KEY, knownPlan: false, planCells: new Map(), overrides: noneGrantOv }));
check('none: an override does NOT leak access (still denied)', !featureAllowed(noneWithGrant, 'sensitivity'));
// Admin on 'none' still bypasses (never locked out).
const adminNone = computeGate(baseInput({ isAdmin: true, planKey: NONE_PLAN_KEY, knownPlan: false, planCells: new Map() }));
check('admin on none: fullAccess (admin bypass independent of plan)', adminNone.fullAccess === true && GATE_POINTS.every((k) => featureAllowed(adminNone, k)));
// A none user who is then moved to a real plan resolves that plan normally.
const noneThenPro = computeGate(baseInput({ planKey: 'pro', knownPlan: true, planCells: PLAN.pro }));
check('none -> pro (granted a plan): resolves pro access', featureAllowed(noneThenPro, 'excel_formula') && noneThenPro.projectLimit === 25);

// Workspace lockout decision (the /refm server gate + dashboard cards both use it).
console.log('\n=== Direct-URL / card gating (isNoPlanLockedOut) ===');
check('none non-admin is locked out of the workspace', isNoPlanLockedOut('none', false) === true);
check('admin on none is NOT locked out (bypass)', isNoPlanLockedOut('none', true) === false);
check('real plan is NOT locked out', isNoPlanLockedOut('pro', false) === false && isNoPlanLockedOut('trial', false) === false);
check('unknown plan is NOT locked out (safety net)', isNoPlanLockedOut('legacy_weird', false) === false);
check('empty plan is NOT locked out (only explicit none)', isNoPlanLockedOut('', false) === false);

// ── 3. Admin bypass everywhere.
console.log('\n=== Admin bypass ===');
const adminGate = computeGate(baseInput({ isAdmin: true, planKey: 'trial', planCells: PLAN.trial }));
check('admin: fullAccess even on the trial plan', adminGate.fullAccess === true);
check('admin: every gate point allowed', GATE_POINTS.every((k) => featureAllowed(adminGate, k)));
check('admin: unlimited projects + archive allowed', adminGate.projectLimit === -1 && adminGate.archiveAllowed === true);

// ── 4. Solo / Pro match plan_permissions exactly at each gate point.
console.log('\n=== Solo / Pro exact-match per gate point ===');
const soloGate = computeGate(baseInput({ planKey: 'solo', planCells: PLAN.solo }));
const soloExpected = (k: string): boolean => PLAN.solo.get(k)?.included ?? false;
check('solo: every gate point matches plan_permissions', GATE_POINTS.every((k) => featureAllowed(soloGate, k) === soloExpected(k)));
check('solo: excel_snapshot YES, excel_formula NO, branding NO', soloGate.featureMap.excel_snapshot.included && !soloGate.featureMap.excel_formula.included && !soloGate.featureMap.branding.included);
const proExpected = (k: string): boolean => PLAN.pro.get(k)?.included ?? false;
check('pro: every gate point matches plan_permissions', GATE_POINTS.every((k) => featureAllowed(proGate, k) === proExpected(k)));

// ── 5. Override at a REAL gate point (not the admin screen).
console.log('\n=== Override at the gate ===');
const grantOv: UserOverride[] = [{ feature_key: 'sensitivity', mode: 'grant', override_value: null, reason: 'beta', expires_at: null }];
const soloGrant = computeGate(baseInput({ planKey: 'pro', planCells: PLAN.pro, overrides: [{ feature_key: 'module_11', mode: 'grant', override_value: null, reason: null, expires_at: null }] }));
check('grant unlocks at the gate: pro + grant module_11 -> allowed', featureAllowed(soloGrant, 'module_11') && !PLAN.pro.has('module_11'));
const trialGrant = computeGate(baseInput({ planKey: 'trial', planCells: PLAN.trial, overrides: grantOv }));
check('grant unlocks at the gate: trial + grant sensitivity -> allowed', featureAllowed(trialGrant, 'sensitivity'));
const revokeOv: UserOverride[] = [{ feature_key: 'pdf_export', mode: 'revoke', override_value: null, reason: null, expires_at: null }];
const proRevoke = computeGate(baseInput({ planKey: 'pro', planCells: PLAN.pro, overrides: revokeOv }));
check('revoke locks at the gate: pro + revoke pdf_export -> denied', !featureAllowed(proRevoke, 'pdf_export'));

// ── 6. Trial expiry: loses paid features at the gate.
// NOTE: the legacy boolean path (trialExpired / planExpired with NO lapseState)
// now maps a fully-expired plan to the 'lapsed' state, which is the deliberate
// NO-ACCESS shape (identical to 'none'). This supersedes the pre-grace behavior
// where an override could still leak through a fully-expired plan: a lapsed user
// has no active plan, so overrides do not leak (consistent with the 'none'
// override test above). The read-only GRACE window (where features ARE still
// viewable) is exercised in section 9 via the explicit lapseState input.
console.log('\n=== Trial expiry (legacy boolean -> lapsed) ===');
const trialActive = computeGate(baseInput({ planKey: 'trial', planCells: PLAN.trial, trialExpired: false }));
const trialExpired = computeGate(baseInput({ planKey: 'trial', planCells: PLAN.trial, trialExpired: true }));
check('active trial: module_1 + pdf included', featureAllowed(trialActive, 'module_1') && featureAllowed(trialActive, 'pdf_export'));
check('expired trial: loses ALL features (baseline)', GATE_POINTS.every((k) => !featureAllowed(trialExpired, k)));
check('expired trial: projects cap drops to 0', trialExpired.projectLimit === 0);
const trialExpiredWithGrant = computeGate(baseInput({ planKey: 'trial', planCells: PLAN.trial, trialExpired: true, overrides: grantOv }));
check('lapsed trial: an override does NOT leak access (no active plan, like none)', !featureAllowed(trialExpiredWithGrant, 'sensitivity'));

// Manual-plan expiry (mig 179): expires_at past -> planExpired -> lapsed (no access),
// mirroring trial expiry. A paid plan (pro) is NOT trial but still expires.
const proActive = computeGate(baseInput({ planKey: 'pro', planCells: PLAN.pro, planExpired: false }));
const proExpired = computeGate(baseInput({ planKey: 'pro', planCells: PLAN.pro, planExpired: true }));
check('active manual plan (pro): features included', featureAllowed(proActive, 'module_1'));
check('expired manual plan (pro): loses ALL features (baseline)', GATE_POINTS.every((k) => !featureAllowed(proExpired, k)));
check('expired manual plan: projects cap drops to 0', proExpired.projectLimit === 0);
const proExpiredWithGrant = computeGate(baseInput({ planKey: 'pro', planCells: PLAN.pro, planExpired: true, overrides: grantOv }));
check('lapsed manual plan: an override does NOT leak access (no active plan, like none)', !featureAllowed(proExpiredWithGrant, 'sensitivity'));
const adminExpired = computeGate(baseInput({ isAdmin: true, planKey: 'pro', planCells: PLAN.pro, planExpired: true }));
check('admin bypass survives plan expiry (still full access)', adminExpired.fullAccess && GATE_POINTS.every((k) => featureAllowed(adminExpired, k)));
check('planExpired defaults to false when omitted (no behavior change)', featureAllowed(proGate, 'module_1'));

// ── 7. Cap + archive.
console.log('\n=== Cap + archive ===');
check('trial (limit 1): create blocked at 1 active', capCheck(1, 1) === 'CAP_REACHED');
check('trial (limit 1): create allowed at 0 active', capCheck(0, 1) === 'OK');
check('solo (limit 3): allowed at 2, blocked at 3', canAddActiveProject(2, 3) && !canAddActiveProject(3, 3));
check('unlimited (-1): bypasses cap at any count', canAddActiveProject(999, -1) && capCheck(999, -1) === 'OK');
check('archive frees a slot: at 3/3 blocked, after archive 2/3 allowed', !canAddActiveProject(3, 3) && canAddActiveProject(2, 3));
check('unarchive = create: blocked when already at cap', !canAddActiveProject(3, 3));
check('trial cannot archive (archiveAllowed false)', trialGate.archiveAllowed === false);
check('pro/firm/solo can archive', proGate.archiveAllowed && firmGate.archiveAllowed && soloGate.archiveAllowed);
check('no projects entitlement (limit 0): create blocked', !canAddActiveProject(0, 0) && capCheck(0, 0) === 'CAP_REACHED');

// ── 8. Fail-closed shape (denied gate): non-admin denied, admin still passes.
console.log('\n=== Fail-closed ===');
const deniedNonAdmin = { featureMap: {} as Record<string, never>, fullAccess: false };
check('denied gate (non-admin): every gate point denied', GATE_POINTS.every((k) => !featureAllowed(deniedNonAdmin, k)));
const deniedAdmin = { featureMap: {} as Record<string, never>, fullAccess: true };
check('denied gate (admin fullAccess): every gate point still allowed', GATE_POINTS.every((k) => featureAllowed(deniedAdmin, k)));

// ── 9. Three-state lapse model: active / grace (read-only) / lapsed.
console.log('\n=== Lapse model: active / grace / lapsed ===');
const DAY = 86400000;
const EXPIRY = Date.parse('2026-06-01T00:00:00Z');

// 9a. computeLapseState pure boundaries.
check('lapse: null anchor -> active (never expires)', computeLapseState(null, NOW).state === 'active');
check('lapse: now before expiry -> active', computeLapseState(EXPIRY, EXPIRY - DAY).state === 'active');
check('lapse: at expiry -> grace (boundary inclusive)', computeLapseState(EXPIRY, EXPIRY).state === 'grace');
check('lapse: mid grace (15 days after) -> grace', computeLapseState(EXPIRY, EXPIRY + 15 * DAY).state === 'grace');
const graceEnd = addCalendarMonths(EXPIRY, GRACE_PERIOD_MONTHS);
check('lapse: 1 day before grace end -> grace', computeLapseState(EXPIRY, graceEnd - DAY).state === 'grace');
check('lapse: at grace end -> lapsed (boundary)', computeLapseState(EXPIRY, graceEnd).state === 'lapsed');
check('lapse: well past grace -> lapsed', computeLapseState(EXPIRY, graceEnd + 60 * DAY).state === 'lapsed');
check('lapse: grace window is exactly 1 calendar month', addCalendarMonths(Date.parse('2026-01-31T00:00:00Z'), 1) === Date.parse('2026-02-28T00:00:00Z'));

// 9b. resolveLapseAnchorMs source priority (trial / manual / canceled-paddle).
const T = Date.parse('2026-06-10T00:00:00Z'); const M = Date.parse('2026-07-01T00:00:00Z'); const P = Date.parse('2026-08-01T00:00:00Z');
check('anchor: trial plan uses trial_ends_at', resolveLapseAnchorMs({ planKey: 'trial', trialEndsAtMs: T, subExpiresAtMs: M, subPeriodEndMs: P, subStatus: 'active' }) === T);
check('anchor: manual expires_at wins for a paid plan', resolveLapseAnchorMs({ planKey: 'pro', trialEndsAtMs: null, subExpiresAtMs: M, subPeriodEndMs: P, subStatus: 'active' }) === M);
check('anchor: canceled paddle uses period end', resolveLapseAnchorMs({ planKey: 'pro', trialEndsAtMs: null, subExpiresAtMs: null, subPeriodEndMs: P, subStatus: 'canceled' }) === P);
check('anchor: active renewing paddle -> null (never lapses)', resolveLapseAnchorMs({ planKey: 'pro', trialEndsAtMs: null, subExpiresAtMs: null, subPeriodEndMs: P, subStatus: 'active' }) === null);

// 9c. Grace gate: read-only, but the feature map + project view are PRESERVED.
const proGrace = computeGate(baseInput({ planKey: 'pro', planCells: PLAN.pro, lapseState: 'grace' }));
check('grace (pro): lapseState grace + readOnly true', proGrace.lapseState === 'grace' && proGrace.readOnly === true);
check('grace (pro): features still resolve (can VIEW modules)', featureAllowed(proGrace, 'module_1') && featureAllowed(proGrace, 'module_10'));
check('grace (pro): project cap preserved (can open existing projects)', proGrace.projectLimit === 25);
check('grace (pro): archiving (a write) is denied', proGrace.archiveAllowed === false);
check('grace: writeBlockReason = READ_ONLY_GRACE (create/save/export denied)', writeBlockReason(proGrace) === 'READ_ONLY_GRACE');
check('grace: not full access, not locked out of workspace (can log in + view)', proGrace.fullAccess === false && isNoPlanLockedOut('pro', false, 'grace') === false);

// 9d. Lapsed gate: behaves exactly like 'none' (no access), distinct from grace.
const proLapsed = computeGate(baseInput({ planKey: 'pro', planCells: PLAN.pro, lapseState: 'lapsed' }));
check('lapsed (pro): lapseState lapsed + readOnly false', proLapsed.lapseState === 'lapsed' && proLapsed.readOnly === false);
check('lapsed (pro): every gate point DENIED (no access)', GATE_POINTS.every((k) => !featureAllowed(proLapsed, k)));
check('lapsed (pro): no projects, no archive', proLapsed.projectLimit === 0 && proLapsed.archiveAllowed === false);
check('lapsed: writeBlockReason = LAPSED', writeBlockReason(proLapsed) === 'LAPSED');
check('lapsed: locked out of workspace (sent to choose-plan)', isNoPlanLockedOut('pro', false, 'lapsed') === true);
check('grace vs lapsed DISTINCT: grace views, lapsed denied', featureAllowed(proGrace, 'module_1') && !featureAllowed(proLapsed, 'module_1'));

// 9e. Applies to ended trials too (trial in grace can still view).
const trialGrace = computeGate(baseInput({ planKey: 'trial', planCells: PLAN.trial, lapseState: 'grace' }));
check('grace (trial): can still VIEW trial modules, read-only', featureAllowed(trialGrace, 'module_1') && trialGrace.readOnly === true);
const trialLapsed = computeGate(baseInput({ planKey: 'trial', planCells: PLAN.trial, lapseState: 'lapsed' }));
check('lapsed (trial): no access', GATE_POINTS.every((k) => !featureAllowed(trialLapsed, k)) && writeBlockReason(trialLapsed) === 'LAPSED');

// 9f. Admin bypass SURVIVES grace + lapsed (never read-only, never locked out).
const adminGrace = computeGate(baseInput({ isAdmin: true, planKey: 'pro', planCells: PLAN.pro, lapseState: 'grace' }));
const adminLapsed = computeGate(baseInput({ isAdmin: true, planKey: 'pro', planCells: PLAN.pro, lapseState: 'lapsed' }));
check('admin-bypass-survives-grace: fullAccess, not readOnly, no write block', adminGrace.fullAccess && !adminGrace.readOnly && writeBlockReason(adminGrace) === null);
check('admin-bypass-survives-lapsed: fullAccess, every gate point allowed', adminLapsed.fullAccess && GATE_POINTS.every((k) => featureAllowed(adminLapsed, k)) && writeBlockReason(adminLapsed) === null);
check('admin never locked out by lapse', isNoPlanLockedOut('pro', true, 'lapsed') === false && isNoPlanLockedOut('none', true, 'lapsed') === false);

// 9g. Backward compat: legacy boolean (no lapseState) still maps expired -> lapsed.
const legacyTrialExpired = computeGate(baseInput({ planKey: 'trial', planCells: PLAN.trial, trialExpired: true }));
check('legacy fallback: trialExpired (no lapseState) -> lapsed (empty baseline)', legacyTrialExpired.lapseState === 'lapsed' && GATE_POINTS.every((k) => !featureAllowed(legacyTrialExpired, k)));
const activeNoLapse = computeGate(baseInput({ planKey: 'pro', planCells: PLAN.pro }));
check('active (no lapseState, not expired): lapseState active, not readOnly, no write block', activeNoLapse.lapseState === 'active' && !activeNoLapse.readOnly && writeBlockReason(activeNoLapse) === null);

// 9h. None + unknown carry the new fields without changing behavior.
check('none: lapseState active, no write block applies after the none deny', noneGate.lapseState === 'active');
check('unknown safety net: fullAccess so writeBlockReason null (never write-blocked)', writeBlockReason(unknownGate) === null);

console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
if (fail) { console.log('Failures: ' + fails.join(' | ')); process.exit(1); }
