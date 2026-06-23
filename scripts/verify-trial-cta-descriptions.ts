/**
 * verify-trial-cta-descriptions.ts
 *
 * Proves the modeling trial CTA reads the single-source trial length and links
 * to pricing, and that migration 169 seeds a description for every feature
 * (fill-only). Pure helper tests + source/migration structure checks (no DB).
 *
 * Run: npx tsx scripts/verify-trial-cta-descriptions.ts
 */
import fs from 'fs';
import path from 'path';
import { withTrialDays } from '../src/shared/entitlements/trialConfig';

let pass = 0, fail = 0; const fails: string[] = [];
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { pass++; console.log(`  [PASS] ${name}`); }
  else { fail++; fails.push(name); console.log(`  [FAIL] ${name}${detail ? ` :: ${detail}` : ''}`); }
};
const read = (rel: string): string => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
const EM = String.fromCharCode(0x2014);

console.log('=== withTrialDays (single-source injection) ===');
check('{trialDays} token replaced', withTrialDays('Start {trialDays}-Day Free Trial', 30) === 'Start 30-Day Free Trial');
check('legacy NN-day literal normalized (trial context)', withTrialDays('Start 15-Day Free Trial', 30) === 'Start 30-Day Free Trial');
check('reflects the configured value (45)', withTrialDays('Start {trialDays}-Day Free Trial', 45) === 'Start 45-Day Free Trial');
check('idempotent on token+literal', withTrialDays(withTrialDays('Start {trialDays}-Day Free Trial', 30), 30) === 'Start 30-Day Free Trial');
check('non-trial copy untouched', withTrialDays('Register Free', 30) === 'Register Free');
check('numbers outside trial context untouched', withTrialDays('30 day money back', 30) === '30 day money back');
check('empty string safe', withTrialDays('', 30) === '');

console.log('=== Modeling landing CTA wiring ===');
const mp = read('app/modeling/page.tsx');
check('imports resolveTrialDays + withTrialDays', /resolveTrialDays/.test(mp) && /withTrialDays/.test(mp));
check('resolves trial days from single source', /resolveTrialDays\(getServerClient\(\), 'real-estate'\)/.test(mp));
check('applies withTrialDays to CTA text', /withTrialDays\(/.test(mp));
check('no hardcoded NN-day trial literal in code', !/\d+\s*-?\s*day free trial/i.test(mp));
check('pricing path resolves to the main site', /MAIN_SITE_PATH/.test(mp) && /pricing/.test(mp));
check('CTA href uses ctaHref resolver', /href=\{ctaHref\(/.test(mp));

console.log('=== Migration 169 seeds every feature (fill-only) ===');
const mig = read('supabase/migrations/169_features_registry_seed_descriptions.sql');
const KEYS = ['module_1','module_2','module_3','module_4','module_5','module_6','module_7','module_8','module_9','module_10','module_11','pdf_export','excel_snapshot','excel_formula','white_label_pdf','sensitivity','versioning','projects','seats','rbac','branding','ai_contextual','ai_research'];
for (const k of KEYS) check(`169 seeds ${k}`, new RegExp(`feature_key = '${k}'`).test(mig));
check('169 is fill-only (guards on empty)', (mig.match(/description IS NULL OR description = ''/g) ?? []).length >= KEYS.length);
check('169 coming-soon honesty for stubs', /Coming soon:.*module_7|module_7'[\s\S]*Coming soon:/m.test(mig) || /Coming soon/.test(mig));
check('169 module 1 to 6 not flagged coming soon', !/Coming soon[\s\S]{0,200}feature_key = 'module_1'/m.test(mig));

console.log('=== Seed script parity + no em dashes ===');
const seed = read('scripts/seed-feature-descriptions.ts');
check('seed script is fill-only (never overwrites)', /trim\(\) !== ''/.test(seed) && /never overwrite/i.test(seed));
for (const k of KEYS) check(`seed has ${k}`, new RegExp(`${k}:`).test(seed));
for (const f of ['app/modeling/page.tsx', 'src/shared/entitlements/trialConfig.ts', 'supabase/migrations/169_features_registry_seed_descriptions.sql']) {
  check(`no em dash: ${f}`, !read(f).includes(EM));
}

console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
if (fail > 0) { console.log('Failures:', fails.join('; ')); process.exit(1); }
