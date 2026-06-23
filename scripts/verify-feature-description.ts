/**
 * verify-feature-description.ts
 *
 * Proves the three pricing-page fixes are wired correctly (structure-level, no
 * DB): the Most Popular ribbon carries no orange, the shared label column is
 * widened while staying the single grid source (alignment preserved), and the
 * per-feature description flows end to end (migration -> serverCatalog ->
 * features PATCH -> Plan Builder editor -> shared popover on both pricing
 * surfaces) with no info affordance when empty.
 *
 * Run: npx tsx scripts/verify-feature-description.ts
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
// Orange hexes that must never appear on the pricing surfaces.
const ORANGE = /#F97316|#EA580C|#FB923C|#FDBA74|#FFEDD5|249,\s*115,\s*22|234,\s*88,\s*22/i;

console.log('=== Migration 168 (features_registry.description) ===');
const mig = read('supabase/migrations/168_features_registry_description.sql');
check('168 adds description column additively', /ADD COLUMN IF NOT EXISTS description text/i.test(mig));
check('168 alters/drops nothing else', !/DROP |DELETE |TRUNCATE /i.test(mig));

console.log('=== serverCatalog description plumbing (tolerant + attaches) ===');
const sc = read('src/shared/entitlements/serverCatalog.ts');
check('MergedFeatureRow has description', /description:\s*string \| null/.test(sc));
check('selects description (newest shape)', /select\([^)]*description[^)]*\)/.test(sc));
check('tolerant fallback pads description null', /description:\s*null/.test(sc));
check('builds descByKey from registry rows', /descByKey/.test(sc));
check('attaches description to module rows by key', /description:\s*descByKey\.get\(m\.feature_key\)/.test(sc));

console.log('=== features PATCH accepts description (module keys allowed) ===');
const fr = read('app/api/admin/entitlements/features/route.ts');
check('PATCH reads description', /description/.test(fr) && /req\.json\(\)/.test(fr));
check('description path is NOT gated by isModuleKey', (() => {
  // The isModuleKey guard must sit inside the `visible` branch only, not the
  // description branch. Assert the description assignment is not preceded by a
  // module-key rejection in its own block.
  const descBlock = fr.slice(fr.indexOf('if (description !== undefined)'));
  return descBlock.length > 0 && !/isModuleKey\(feature_key\)/.test(descBlock.slice(0, 240));
})());
check('visible still rejects module keys', /isModuleKey\(feature_key\)/.test(fr));

console.log('=== Plan Builder editor ===');
const pm = read('app/admin/plans/PlanMatrix.tsx');
check('MatrixFeature has description', /description\?:\s*string \| null/.test(pm));
check('renders a per-feature description input', /feature-desc-\$\{f\.feature_key\}/.test(pm));
check('saves on blur via onSaveDescription', /onSaveDescription\(f\.feature_key/.test(pm));
const pp = read('app/admin/plans/page.tsx');
check('page wires saveDescription -> features PATCH', /saveDescription/.test(pp) && /\/api\/admin\/entitlements\/features/.test(pp));
check('page passes onSaveDescription to PlanMatrix', /onSaveDescription=\{saveDescription\}/.test(pp));

console.log('=== Shared FeatureInfoLabel (accessible, no affordance when empty) ===');
const fil = read('src/shared/components/pricing/FeatureInfoLabel.tsx');
check('button trigger only when description present', /has \?/.test(fil) && /<button/.test(fil));
check('plain span (no affordance) when empty', /<span style=\{\{ color, fontWeight: 500/.test(fil));
check('aria-expanded + aria-controls', /aria-expanded=\{open\}/.test(fil) && /aria-controls=/.test(fil));
check('closes on Escape', /'Escape'/.test(fil));
check('renders popover via portal (escapes overflow)', /createPortal\(/.test(fil));
check('opens on click (mobile tap friendly)', /onClick=\{toggle\}/.test(fil));

console.log('=== LivePlanCards: ribbon de-orange + wider shared grid ===');
const lpc = read('src/hubs/main/components/pricing/LivePlanCards.tsx');
check('label column widened to 320', /const LABEL_W = 320/.test(lpc));
check('GRID derives from LABEL_W (single source)', /const GRID = `\$\{LABEL_W\}px repeat/.test(lpc));
check('ONE rowGrid used for card row AND comparison rows', (lpc.match(/\.\.\.rowGrid/g) ?? []).length >= 3);
check('badge shadow neutralized (no warm gold glow on ribbon)', !/boxShadow: featured \? '0 6px 16px rgba\(201,168,76/.test(lpc));
check('badge uses brand gold fill', /background: featured \? GOLD/.test(lpc));
check('comparison uses FeatureInfoLabel', /<FeatureInfoLabel/.test(lpc));
check('LivePlanCards has NO orange hex', !ORANGE.test(lpc));

console.log('=== In-app pricing comparison uses the same popover ===');
const inapp = read('app/modeling/pricing/page.tsx');
check('in-app imports FeatureInfoLabel', /FeatureInfoLabel/.test(inapp));
check('in-app PriceFeature has description', /description\?:\s*string \| null/.test(inapp));
check('in-app comparison uses FeatureInfoLabel', /<FeatureInfoLabel/.test(inapp));

console.log('=== No orange + no em dashes on touched pricing files ===');
const files = [
  'src/hubs/main/components/pricing/LivePlanCards.tsx',
  'app/pricing/page.tsx',
  'app/modeling/pricing/page.tsx',
  'src/shared/components/pricing/FeatureInfoLabel.tsx',
];
for (const f of files) {
  const src = read(f);
  check(`no orange: ${f}`, !ORANGE.test(src));
  check(`no em dash: ${f}`, !src.includes(EM));
}

console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
if (fail > 0) { console.log('Failures:', fails.join('; ')); process.exit(1); }
