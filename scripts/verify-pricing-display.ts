/**
 * verify-pricing-display.ts
 *
 * Pure tests for the in-app pricing page display helpers (formatPlanPrice +
 * comparisonCellText). No DB, no React. Proves prices come from data (not
 * hardcoded), contact_sales overrides numbers, the monthly/annual toggle picks
 * the right field, Trial is free, and the comparison cell mirrors coverage.
 *
 * Run: npx tsx scripts/verify-pricing-display.ts
 */
import { formatPlanPrice, comparisonCellText, visibleForCustomers, type PricedPlan } from '../src/shared/entitlements/pricingDisplay';

let pass = 0, fail = 0; const fails: string[] = [];
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { pass++; console.log(`  [PASS] ${name}`); }
  else { fail++; fails.push(name); console.log(`  [FAIL] ${name}${detail ? ` :: ${detail}` : ''}`); }
};

const mk = (over: Partial<PricedPlan>): PricedPlan => ({
  plan_key: 'solo', label: 'Solo', price_monthly: 99, price_annual: 990, currency: 'SAR', contact_sales: false, ...over,
});

console.log('=== Pricing display helpers ===');

// Billing toggle picks the right field, currency from data.
const solo = mk({});
check('monthly shows price_monthly with currency', formatPlanPrice(solo, 'monthly').big === 'SAR 99' && formatPlanPrice(solo, 'monthly').sub === 'per month');
check('annual shows price_annual with currency', formatPlanPrice(solo, 'annual').big === 'SAR 990' && formatPlanPrice(solo, 'annual').sub === 'per year');

// Currency is data-driven (not hardcoded SAR).
const usd = mk({ currency: 'USD', price_monthly: 25 });
check('currency comes from data (USD)', formatPlanPrice(usd, 'monthly').big === 'USD 25');

// Trial is free.
const trial = mk({ plan_key: 'trial', label: 'Trial', price_monthly: 0, price_annual: 0 });
check('trial price 0 -> Free', formatPlanPrice(trial, 'monthly').big === 'Free');

// Contact sales overrides any number.
const firm = mk({ plan_key: 'firm', label: 'Firm', contact_sales: true, price_monthly: 999 });
check('contact_sales -> Contact sales (overrides number)', formatPlanPrice(firm, 'monthly').big === 'Contact sales');

// Unpriced -> Not priced.
const unpriced = mk({ price_monthly: null, price_annual: null });
check('null price -> Not priced', formatPlanPrice(unpriced, 'monthly').big === 'Not priced');

// Comparison cells.
console.log('\n=== Comparison cells ===');
check('gate included -> check', comparisonCellText('gate', true, null) === '✓');
check('gate excluded -> dash', comparisonCellText('gate', false, null) === '–');
check('limit included 25 -> 25', comparisonCellText('limit', true, 25) === '25');
check('limit included -1 -> Unlimited', comparisonCellText('limit', true, -1) === 'Unlimited');
check('limit excluded -> dash', comparisonCellText('limit', false, null) === '–');

// Customer visibility filter (mig 164): non-module hidden dropped, modules kept.
console.log('\n=== visibleForCustomers ===');
const feats = [
  { feature_key: 'module_1', moduleStatus: 'live', visible: true },
  { feature_key: 'module_7', moduleStatus: 'coming_soon', visible: true },
  { feature_key: 'pdf_export', visible: true },
  { feature_key: 'rbac', visible: false },          // hidden non-module
  { feature_key: 'seats', visible: false },         // hidden non-module
  { feature_key: 'sensitivity', visible: true },
];
const vis = visibleForCustomers(feats);
const keys = vis.map((f) => f.feature_key);
check('hidden non-module rbac excluded', !keys.includes('rbac'));
check('hidden non-module seats excluded', !keys.includes('seats'));
check('visible non-module pdf_export kept', keys.includes('pdf_export'));
check('module rows always kept (module_1 + module_7)', keys.includes('module_1') && keys.includes('module_7'));
check('count = 4 (2 modules + 2 visible non-module)', vis.length === 4, String(vis.length));
// A non-module with visible undefined (pre-mig default) is treated as shown.
check('undefined visible treated as shown', visibleForCustomers([{ feature_key: 'x', visible: undefined as unknown as boolean }]).length === 1);

console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
if (fail) { console.log('Failures: ' + fails.join(' | ')); process.exit(1); }
