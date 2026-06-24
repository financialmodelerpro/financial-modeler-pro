/**
 * verify-pricing-application-ready.ts
 *
 * Structure-level checks for the application-ready public pricing page: the Firm
 * dual-action is data-driven (no hardcoded plan key), the billing disclosure +
 * subscription terms + founder credibility lines render, Coming Soon modules are
 * still shown (nothing hides module rows), and no orange / em dashes crept in.
 *
 * Run: npx tsx scripts/verify-pricing-application-ready.ts
 */
import fs from 'fs';
import path from 'path';

let pass = 0, fail = 0; const fails: string[] = [];
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { pass++; console.log(`  [PASS] ${name}`); }
  else { fail++; fails.push(name); console.log(`  [FAIL] ${name}${detail ? ` :: ${detail}` : ''}`); }
};
const read = (rel: string): string => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
const EM = String.fromCharCode(0x2014);
const ORANGE = /#F97316|#EA580C|#FB923C|#FDBA74|#FFEDD5|249,\s*115,\s*22|234,\s*88,\s*22/i;

const lpc = read('src/hubs/main/components/pricing/LivePlanCards.tsx');
const inapp = read('app/modeling/pricing/page.tsx');
const helper = read('src/shared/entitlements/pricingDisplay.ts');
const settings = read('src/shared/entitlements/pricingPageSettings.ts');
const adminPlans = read('app/admin/plans/page.tsx');

console.log('=== Dual-action is data-driven (not hardcoded) ===');
check('planCardMode helper exists (pure, data-driven)', /export function planCardMode/.test(helper));
check('public card uses planCardMode', /planCardMode\(/.test(lpc));
check('public renders a self-checkout button in dual/self mode', /data-testid=\{`pricing-checkout-\$\{p\.plan_key\}`\}/.test(lpc));
check('public renders a contact-sales link', /data-testid=\{`pricing-contact-\$\{p\.plan_key\}`\}/.test(lpc));
check('dual mode adds the contact link conditionally', /mode === 'dual'/.test(lpc));
check('NOT hardcoded to firm/the plan key', !/['"`]firm['"`]/.test(lpc));
check('dual price shows the number (helper not overridden)', /contact_sales: false/.test(lpc));
check('in-app also data-driven via planCardMode', /planCardMode\(/.test(inapp));

console.log('=== New copy lines render ===');
check('billing disclosure line present', /data-testid="billing-disclosure"/.test(lpc) && /exclusive of applicable taxes/.test(lpc) && /Cancel anytime/.test(lpc));
check('annual save % is dynamic (annualSavePct)', /Annual plans save up to \{annualSavePct\}%/.test(lpc) && /const annualSavePct =/.test(lpc));
check('subscription terms line present', /data-testid="subscription-terms"/.test(lpc) && /renew automatically unless cancelled/.test(lpc));
// Editable model: the band still renders, but the text is a prop driven by the
// Plan Builder setting (cms_content), NOT hardcoded in the component.
check('founder credibility band renders from prop (editable, not hardcoded)',
  /data-testid="founder-credibility"/.test(lpc) && /\{credibilityLine\}/.test(lpc) && !/PaceMakers Business Consultants/.test(lpc));
check('band hidden when the value is blank (no broken band)', /credibilityLine\.trim\(\) !== ''/.test(lpc));
check('default credibility text says Platform (not product) + Ahmad Din + 12+ years',
  /A PaceMakers Business Consultants Platform\./.test(settings) && /Ahmad Din/.test(settings) && /12\+ years/.test(settings) && !/product of PaceMakers/i.test(settings));
const founderBlock = lpc.slice(lpc.indexOf('data-testid="founder-credibility"'), lpc.indexOf('data-testid="founder-credibility"') + 420);
check('founder band has no customer/geography trust claims', !/customers|clients|countries|trusted by|\bworldwide\b/i.test(founderBlock));
// Plan Builder owns the editable setting; in-app page renders the same band.
check('Plan Builder has the editable credibility field + save', /data-testid="pricing-credibility-input"/.test(adminPlans) && /data-testid="save-credibility"/.test(adminPlans));
check('in-app pricing page renders the same credibility band from data', /data-testid="founder-credibility"/.test(inapp) && /\{credibilityLine\}/.test(inapp));

console.log('=== Coming Soon modules kept (nothing hidden) ===');
check('comparison still renders every ordered feature (no module hiding)', /ordered\.forEach\(/.test(lpc) && !/filter\([^)]*coming_soon/.test(lpc));
check('coming-soon module tag still rendered', /moduleStatus !== 'live'/.test(lpc) && /MODULE_TAG\[/.test(lpc));

console.log('=== Alignment: one shared grid + min width for cards AND comparison ===');
check('GRID derives from LABEL_W', /const GRID = `\$\{LABEL_W\}px repeat/.test(lpc));
check('both blocks use INNER_MIN min width', (lpc.match(/minWidth: INNER_MIN/g) ?? []).length >= 2);
check('rowGrid used for card row + comparison rows', (lpc.match(/\.\.\.rowGrid/g) ?? []).length >= 3);

console.log('=== No orange + no em dashes ===');
for (const f of ['src/hubs/main/components/pricing/LivePlanCards.tsx', 'app/pricing/page.tsx', 'app/modeling/pricing/page.tsx']) {
  const src = read(f);
  check(`no orange: ${f}`, !ORANGE.test(src));
  check(`no em dash: ${f}`, !src.includes(EM));
}

console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
if (fail > 0) { console.log('Failures:', fails.join('; ')); process.exit(1); }
