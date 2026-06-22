/**
 * verify-footer-legal-links.ts
 *
 * Pure tests for the publish-driven footer legal links (selectFooterLegalLinks).
 * Proves: only PUBLISHED legal pages appear, drafts are absent, a newly
 * published page (Refund Policy) shows up, order follows FOOTER_LEGAL_SLUGS,
 * and labels come from each page's title.
 *
 * Run: npx tsx scripts/verify-footer-legal-links.ts
 */
import { selectFooterLegalLinks, FOOTER_LEGAL_SLUGS } from '../src/shared/cms';

let pass = 0, fail = 0; const fails: string[] = [];
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { pass++; console.log(`  [PASS] ${name}`); }
  else { fail++; fails.push(name); console.log(`  [FAIL] ${name}${detail ? ` :: ${detail}` : ''}`); }
};

console.log('=== Footer legal links (publish-driven) ===');

// The catalog of legal slugs is the curated set.
check('FOOTER_LEGAL_SLUGS = privacy/terms/confidentiality/refund',
  FOOTER_LEGAL_SLUGS.join(',') === 'privacy-policy,terms-of-service,confidentiality,refund-policy');

// Original state: refund-policy was DRAFT, so only 3 published.
const before = selectFooterLegalLinks([
  { slug: 'privacy-policy', title: 'Privacy Policy' },
  { slug: 'terms-of-service', title: 'Terms of Service' },
  { slug: 'confidentiality', title: 'Confidentiality & Terms' },
]);
check('draft refund-policy is ABSENT', !before.some((l) => l.slug === 'refund-policy'));
check('3 published links shown', before.length === 3, String(before.length));

// After publishing Refund Policy: it appears, in order (last).
const after = selectFooterLegalLinks([
  { slug: 'privacy-policy', title: 'Privacy Policy' },
  { slug: 'terms-of-service', title: 'Terms of Service' },
  { slug: 'confidentiality', title: 'Confidentiality & Terms' },
  { slug: 'refund-policy', title: 'Refund Policy' },
]);
check('published refund-policy now SHOWS', after.some((l) => l.slug === 'refund-policy'));
check('order follows FOOTER_LEGAL_SLUGS', after.map((l) => l.slug).join(',') === 'privacy-policy,terms-of-service,confidentiality,refund-policy');
check('label comes from title', after.find((l) => l.slug === 'refund-policy')?.label === 'Refund Policy');
check('links point to /<slug>', after.every((l) => l.slug.length > 0));

// Drafting a previously-shown page removes it (e.g. confidentiality -> draft).
const draftedConf = selectFooterLegalLinks([
  { slug: 'privacy-policy', title: 'Privacy Policy' },
  { slug: 'terms-of-service', title: 'Terms of Service' },
  { slug: 'refund-policy', title: 'Refund Policy' },
]);
check('drafting confidentiality removes it from the footer', !draftedConf.some((l) => l.slug === 'confidentiality'));
check('remaining order preserved', draftedConf.map((l) => l.slug).join(',') === 'privacy-policy,terms-of-service,refund-policy');

// Unknown / non-legal slugs in the published set are ignored.
const withNoise = selectFooterLegalLinks([
  { slug: 'privacy-policy', title: 'Privacy Policy' },
  { slug: 'about', title: 'About' },
  { slug: 'some-landing', title: 'Landing' },
]);
check('non-legal published pages are ignored', withNoise.length === 1 && withNoise[0].slug === 'privacy-policy');

// Empty title falls back to the default label.
const noTitle = selectFooterLegalLinks([{ slug: 'privacy-policy', title: '' }]);
check('empty title -> default label', noTitle[0].label === 'Privacy Policy');

// All drafts -> no links.
check('no published legal pages -> empty', selectFooterLegalLinks([]).length === 0);

console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
if (fail) { console.log('Failures: ' + fails.join(' | ')); process.exit(1); }
