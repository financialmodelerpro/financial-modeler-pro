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
const pricingPage = read('app/pricing/page.tsx');
const explorer = read('src/hubs/main/components/pricing/PricingExplorer.tsx');
const platformsConfig = read('src/hubs/modeling/config/platforms.ts');

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

console.log('=== One-page platform picker (config-driven) -> plans in place ===');
check('pricing page reads the platform config (PLATFORMS), not a hardcoded list', /from '@\/src\/hubs\/modeling\/config\/platforms'/.test(pricingPage) && /PLATFORMS\.map\(/.test(pricingPage));
check('pricing page renders the PricingExplorer (picker + plans)', /<PricingExplorer\b/.test(pricingPage));
check('explorer step 1: a platform picker built from the platforms prop', /data-testid="platform-picker"/.test(explorer) && /platforms\.map\(/.test(explorer));
check('explorer marks live as Available now (clickable) + coming-soon disabled', /Available now/.test(explorer) && /Coming soon/.test(explorer) && /aria-disabled="true"/.test(explorer));
check('live platform card is a clickable button that selects in place', /platform-card-\$\{p\.slug\}/.test(explorer) && /onClick=\{\(\) => setSelected\(p\.slug\)\}/.test(explorer));
check('explorer step 2: plans view reuses LivePlanCards scoped to the selection', /data-testid="pricing-plans-view"/.test(explorer) && /<LivePlanCards\b/.test(explorer));
check('explorer step 2 has a back-to-platforms control', /data-testid="back-to-platforms"/.test(explorer));
check('explorer shows the real platform NAME (not a generic label)', /data-testid="selected-platform-name"/.test(explorer) && /selectedPlatform\.name/.test(explorer));
check('platform config has REFM live + coming-soon others', /slug: 'real-estate'[\s\S]*?status: 'live'/.test(platformsConfig) && /status: 'coming_soon'/.test(platformsConfig));

console.log('=== No Training Hub content + no generic "Modeling Platform" label in the pricing flow ===');
for (const [label, src] of [['app/pricing/page.tsx', pricingPage], ['PricingExplorer.tsx', explorer]] as const) {
  check(`no Training Hub banner/button in ${label}`,
    !/Browse Free Courses/i.test(src) && !/Always 100% Free/i.test(src) && !/learn\.financialmodelerpro/.test(src) && !src.includes('\u{1F393}'));
  check(`no generic "Modeling Platform" label in ${label}`, !/Modeling Platform/i.test(src));
}

console.log('=== Footer wording aligned to Platform (no "product of" in code) ===');
check('no "product of PaceMakers" string remains under app/', (() => {
  const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? walk(p) : (/\.(tsx?|jsx?)$/.test(d.name) ? [p] : []);
  });
  return !walk(path.join(process.cwd(), 'app')).some((f) => /product of PaceMakers/i.test(fs.readFileSync(f, 'utf8')));
})());

console.log('=== No orange + no em dashes ===');
for (const f of ['src/hubs/main/components/pricing/LivePlanCards.tsx', 'src/hubs/main/components/pricing/PricingExplorer.tsx', 'app/pricing/page.tsx', 'app/modeling/pricing/page.tsx']) {
  const src = read(f);
  check(`no orange: ${f}`, !ORANGE.test(src));
  check(`no em dash: ${f}`, !src.includes(EM));
}

console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
if (fail > 0) { console.log('Failures:', fails.join('; ')); process.exit(1); }
