/**
 * scripts/diagnose_anthropic_key.ts
 *
 * READ-ONLY. Unit 0 gate for the AI foundation: does the configured Anthropic
 * key authenticate and respond?
 *
 * Makes ONE minimal call (max_tokens 8, "reply OK") so the cost is a fraction
 * of a cent. Reports the exact outcome and distinguishes the failure modes that
 * need different fixes:
 *   401 authentication_error -> wrong or revoked key
 *   404 not_found_error      -> model string wrong / not available to this org
 *   400 invalid_request      -> malformed request
 *   429 rate_limit_error     -> rate limited
 *   402 / credit             -> billing or quota exhausted
 *
 * The key is read from process.env.ANTHROPIC_API_KEY, the same variable
 * `runAi()` reads (src/shared/ai/client.ts is the single place the platform
 * constructs an SDK client), and the model comes from that same config via
 * DEFAULT_AI_MODEL. So this script tests the real configuration rather than a
 * private copy of it, and cannot report a failure the platform would not have.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/diagnose_anthropic_key.ts [model]
 *
 * The key must be present locally to run this. As of 2026-08-01 `.env.local`
 * has ANTHROPIC_API_KEY present but EMPTY, so the script exits 2 (cannot test)
 * rather than making a call; the working key lives in the Vercel project env.
 * Paste it into .env.local or run `vercel env pull` to test locally.
 */

import Anthropic from '@anthropic-ai/sdk';
import { DEFAULT_AI_MODEL } from '../src/shared/ai/models';

// IMPORTED, never restated. This script used to pin its own copy of a model id
// ('claude-sonnet-4-20250514'), which was retired on 2026-06-15 and now 404s,
// so running the script against a perfectly good key reported a failure and
// read as a key problem. A diagnostic that can invent its own failure is worse
// than no diagnostic. Reading DEFAULT_AI_MODEL from the AI client's own config
// means this test always exercises the model the platform actually calls, and
// a model change stays a one-line edit in one place.
const model = process.argv[2] ?? DEFAULT_AI_MODEL;

async function main() {
  const key = process.env.ANTHROPIC_API_KEY ?? '';

  console.log('=== Anthropic key check ===');
  console.log('  source        : process.env.ANTHROPIC_API_KEY');
  console.log('  key present   :', key ? 'yes' : 'NO');
  console.log('  key prefix    :', key ? `${key.slice(0, 11)}...` : '-');
  console.log('  key length    :', key.length);
  console.log('  model         :', model);

  if (!key) {
    console.log('\nRESULT: CANNOT TEST. No ANTHROPIC_API_KEY in the local environment.');
    console.log('The key is set in the Vercel project env, which this process does not see.');
    console.log('Fix: paste it into .env.local (ANTHROPIC_API_KEY=sk-ant-...) or run `vercel env pull`,');
    console.log('then re-run this script.');
    process.exit(2);
  }

  const client = new Anthropic({ apiKey: key });
  const started = Date.now();
  try {
    const msg = await client.messages.create({
      model,
      max_tokens: 8,
      messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
    });
    const ms = Date.now() - started;
    const text = msg.content[0]?.type === 'text' ? msg.content[0].text.trim() : '(non-text block)';
    console.log('\nRESULT: SUCCESS');
    console.log('  reply         :', JSON.stringify(text));
    console.log('  stop_reason   :', msg.stop_reason);
    console.log('  input tokens  :', msg.usage?.input_tokens);
    console.log('  output tokens :', msg.usage?.output_tokens);
    console.log('  latency       :', `${ms} ms`);
    console.log('\nThe key authenticates and the model responds. Unit 1 is unblocked.');
  } catch (err: unknown) {
    const e = err as { status?: number; error?: { error?: { type?: string; message?: string } }; message?: string };
    const status = e.status ?? 0;
    const type = e.error?.error?.type ?? '-';
    const message = e.error?.error?.message ?? e.message ?? String(err);
    console.log('\nRESULT: FAILED');
    console.log('  http status   :', status);
    console.log('  error type    :', type);
    console.log('  message       :', message);
    const hint =
      status === 401 ? 'Key is wrong, revoked, or from a different org. Re-copy it from the Anthropic console.'
      : status === 404 ? `Model "${model}" is not available to this org (or has been retired). This is a MODEL problem, not a key problem: the key authenticated. Check DEFAULT_AI_MODEL in src/shared/ai/models.ts, or the ANTHROPIC_MODEL env override.`
      : status === 429 ? 'Rate limited. Retry shortly.'
      : status === 400 ? 'Malformed request (model id or params).'
      : /credit|billing|quota/i.test(message) ? 'Billing or credit problem on the Anthropic account.'
      : 'Unclassified failure, see the message above.';
    console.log('  likely fix    :', hint);
    process.exit(1);
  }
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
