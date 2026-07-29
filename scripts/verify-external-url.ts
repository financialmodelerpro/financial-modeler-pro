/**
 * scripts/verify-external-url.ts
 *
 * Pins the URL normalization that stops a scheme-less testimonial link from
 * resolving against our own domain (the bug: a stored "www.linkedin.com/in/x"
 * rendered as https://learn.financialmodelerpro.com/www.linkedin.com/in/x).
 *
 * Pure, no DB, no network: npx tsx scripts/verify-external-url.ts
 */

import { normalizeExternalUrl, normalizeLinkedInUrl } from '../src/shared/utils/externalUrl';

let pass = 0;
let fail = 0;

function eq(label: string, actual: string | null, expected: string | null) {
  if (actual === expected) { pass++; return; }
  fail++;
  console.error(`FAIL ${label}\n     expected: ${expected}\n     actual  : ${actual}`);
}

// ── The reported bug ────────────────────────────────────────────────────────
eq('bare www host gains https', normalizeLinkedInUrl('www.linkedin.com/in/raomkamran'), 'https://www.linkedin.com/in/raomkamran');
eq('bare host, no www', normalizeLinkedInUrl('linkedin.com/in/raomkamran'), 'https://linkedin.com/in/raomkamran');
eq('surrounding whitespace trimmed', normalizeLinkedInUrl('  www.linkedin.com/in/raomkamran  '), 'https://www.linkedin.com/in/raomkamran');

// ── Already-valid URLs pass through ─────────────────────────────────────────
eq('https preserved', normalizeLinkedInUrl('https://www.linkedin.com/in/raomkamran'), 'https://www.linkedin.com/in/raomkamran');
eq('http preserved (not silently upgraded)', normalizeLinkedInUrl('http://www.linkedin.com/in/x'), 'http://www.linkedin.com/in/x');
eq('protocol-relative gains https', normalizeLinkedInUrl('//www.linkedin.com/in/x'), 'https://www.linkedin.com/in/x');
eq('query string kept', normalizeExternalUrl('www.example.com/a?b=c&d=e'), 'https://www.example.com/a?b=c&d=e');

// ── LinkedIn-specific path handling ─────────────────────────────────────────
eq('bare in/ path', normalizeLinkedInUrl('in/raomkamran'), 'https://www.linkedin.com/in/raomkamran');
eq('leading-slash in/ path', normalizeLinkedInUrl('/in/raomkamran'), 'https://www.linkedin.com/in/raomkamran');

// ── Empty / junk resolves to null so nothing is rendered ────────────────────
eq('null input', normalizeLinkedInUrl(null), null);
eq('undefined input', normalizeLinkedInUrl(undefined), null);
eq('empty string', normalizeLinkedInUrl(''), null);
eq('whitespace only', normalizeLinkedInUrl('   '), null);
eq('bare handle is NOT turned into a host', normalizeLinkedInUrl('raomkamran'), null);
eq('bare handle via generic helper', normalizeExternalUrl('raomkamran'), null);

// ── Dangerous schemes rejected (these would otherwise land in an href) ──────
eq('javascript: rejected', normalizeLinkedInUrl('javascript:alert(1)'), null);
eq('JavaScript: rejected (case)', normalizeLinkedInUrl('JaVaScRiPt:alert(1)'), null);
eq('data: rejected', normalizeExternalUrl('data:text/html,<script>alert(1)</script>'), null);
eq('vbscript: rejected', normalizeExternalUrl('vbscript:msgbox'), null);
eq('file: rejected', normalizeExternalUrl('file:///etc/passwd'), null);
eq('mailto: not a web link', normalizeExternalUrl('mailto:a@b.com'), null);

// ── The invariant that matters: never a relative path ───────────────────────
for (const input of [
  'www.linkedin.com/in/x', 'linkedin.com/in/x', 'in/x', '/in/x',
  'https://www.linkedin.com/in/x', '//www.linkedin.com/in/x',
]) {
  const out = normalizeLinkedInUrl(input);
  if (out === null) { fail++; console.error(`FAIL expected a link for ${input}`); continue; }
  if (!/^https?:\/\//i.test(out)) { fail++; console.error(`FAIL not absolute: ${input} -> ${out}`); continue; }
  pass++;
}

console.log(`\nverify-external-url: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
