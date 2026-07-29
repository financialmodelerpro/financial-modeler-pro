/**
 * scripts/verify-ai-client.ts
 *
 * Unit 1 verifier: the central AI client is the SINGLE call path.
 *
 * The load-bearing checks are the containment ones. A central client only stays
 * central if nothing else constructs an SDK client or reads the key, so those
 * are asserted against the whole tree rather than trusted to review.
 *
 * Pure + source assertions. No DB, no network, no API key needed:
 *   npx tsx scripts/verify-ai-client.ts
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { modelAcceptsTemperature, DEFAULT_AI_MODEL, DEFAULT_TIMEOUT_MS } from '../src/shared/ai/models';
import { aiConfigured, aiConfigSummary, runAi } from '../src/shared/ai/client';

const ROOT = join(__dirname, '..');
let pass = 0;
let fail = 0;

function ok(label: string, cond: boolean) {
  if (cond) { pass++; return; }
  fail++;
  console.error(`FAIL ${label}`);
}
function eq(label: string, actual: unknown, expected: unknown) {
  ok(`${label} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`, actual === expected);
}
function read(rel: string): string { return readFileSync(join(ROOT, rel), 'utf8'); }

/** Source with comments removed. The feature-agnosticism check below has to run
 *  against CODE, not prose: a doc comment that says "this module knows nothing
 *  about metering" would otherwise fail a naive substring scan. */
function code(rel: string): string {
  return read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** Every .ts/.tsx under app/ and src/, excluding the AI module itself. */
function sourceFiles(): string[] {
  const out: string[] = [];
  const skip = new Set(['node_modules', '.next', '.git', '.claude']);
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (skip.has(name)) continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (/\.tsx?$/.test(name)) out.push(relative(ROOT, full).split(sep).join('/'));
    }
  };
  for (const d of ['app', 'src']) walk(join(ROOT, d));
  return out;
}

async function main() {
  const files = sourceFiles();
  ok('found source files to scan', files.length > 100);

  // ── 1. Containment: ONE key read, ONE SDK client construction ─────────────
  const AI_MODULE = 'src/shared/ai/';

  const keyReaders = files.filter((f) => /process\.env\.ANTHROPIC_API_KEY/.test(code(f)));
  ok(`ANTHROPIC_API_KEY is read in exactly one module (found: ${keyReaders.join(', ') || 'none'})`,
    keyReaders.length === 1 && keyReaders[0].startsWith(AI_MODULE));

  const sdkImporters = files.filter((f) => /from '@anthropic-ai\/sdk'/.test(read(f)));
  ok(`the Anthropic SDK is imported in exactly one module (found: ${sdkImporters.join(', ') || 'none'})`,
    sdkImporters.length === 1 && sdkImporters[0].startsWith(AI_MODULE));

  const constructors = files.filter((f) => /new Anthropic\s*\(/.test(read(f)));
  ok(`an Anthropic client is constructed in exactly one module (found: ${constructors.join(', ') || 'none'})`,
    constructors.length === 1 && constructors[0].startsWith(AI_MODULE));

  const directCalls = files.filter((f) => /\.messages\.create\s*\(/.test(read(f)));
  ok(`messages.create is called in exactly one module (found: ${directCalls.join(', ') || 'none'})`,
    directCalls.length === 1 && directCalls[0].startsWith(AI_MODULE));

  // ── 2. The migrated call site routes through the client ──────────────────
  const enhance = read('app/api/admin/newsletter/enhance/route.ts');
  ok('enhance route imports runAi', enhance.includes("from '@/src/shared/ai/client'"));
  ok('enhance route no longer imports the SDK', !enhance.includes('@anthropic-ai/sdk'));
  ok('enhance route no longer reads the key', !enhance.includes('ANTHROPIC_API_KEY'));
  // Behaviour preservation: same model, same cap, same error strings.
  ok('enhance route preserves its model pin', enhance.includes("'claude-sonnet-4-20250514'"));
  ok('enhance route preserves max_tokens 2048', /maxTokens:\s*2048/.test(enhance));
  ok('enhance route preserves the "AI not configured" message', enhance.includes("'AI not configured'"));
  ok('enhance route preserves the "AI enhancement failed" message', enhance.includes("'AI enhancement failed'"));
  ok('enhance route preserves the original-content fallback', /result\.text \|\| content/.test(enhance));

  // ── 3. The client is feature-agnostic ────────────────────────────────────
  const clientCode = code('src/shared/ai/client.ts');
  const typesSrc = read('src/shared/ai/types.ts');
  for (const word of ['module7', 'Module7', 'narrative', 'IC report', 'refm', 'REFM', 'metering', 'entitlement']) {
    ok(`client.ts has no "${word}" in its CODE`, !clientCode.includes(word));
  }
  ok('client.ts is server-only (no "use client")', !clientCode.includes("'use client'"));
  ok('types.ts imports no SDK (stays pure)', !typesSrc.includes('@anthropic-ai/sdk'));

  // ── 4. Sampling-parameter safety ─────────────────────────────────────────
  // Sending `temperature` to a model that removed sampling params is a hard
  // 400, so the allow-list must be conservative and unknown must mean "omit".
  eq('sonnet 4.6 accepts temperature', modelAcceptsTemperature('claude-sonnet-4-6'), true);
  eq('haiku 4.5 accepts temperature', modelAcceptsTemperature('claude-haiku-4-5'), true);
  eq('opus 4.6 accepts temperature', modelAcceptsTemperature('claude-opus-4-6'), true);
  eq('opus 5 REJECTS temperature', modelAcceptsTemperature('claude-opus-5'), false);
  eq('opus 4.7 REJECTS temperature', modelAcceptsTemperature('claude-opus-4-7'), false);
  eq('opus 4.8 REJECTS temperature', modelAcceptsTemperature('claude-opus-4-8'), false);
  eq('sonnet 5 REJECTS temperature', modelAcceptsTemperature('claude-sonnet-5'), false);
  eq('fable 5 REJECTS temperature', modelAcceptsTemperature('claude-fable-5'), false);
  eq('an UNKNOWN model omits temperature (fail-safe)', modelAcceptsTemperature('some-future-model'), false);
  eq('empty model omits temperature', modelAcceptsTemperature(''), false);

  // ── 5. Config surface ────────────────────────────────────────────────────
  ok('a default model is set', typeof DEFAULT_AI_MODEL === 'string' && DEFAULT_AI_MODEL.length > 0);
  ok('the timeout is in milliseconds (>= 1000)', DEFAULT_TIMEOUT_MS >= 1000);
  ok('the timeout constant is named in ms', read('src/shared/ai/models.ts').includes('DEFAULT_TIMEOUT_MS'));
  const summary = aiConfigSummary();
  ok('config summary never returns the raw key', !Object.values(summary).some(
    (v) => typeof v === 'string' && v.length > 20 && v.startsWith('sk-ant-') && !v.endsWith('...')));
  ok('config summary reports the model', summary.model === DEFAULT_AI_MODEL);
  eq('aiConfigured matches summary.configured', aiConfigured(), summary.configured);

  // ── 6. The client returns typed results and never throws ─────────────────
  // Runs WITHOUT a key, which is the state on this machine, so these exercise
  // the real guard paths rather than mocks.
  const noMessages = await runAi({ messages: [] });
  eq('empty messages fails as bad_request', noMessages.ok === false && noMessages.kind, 'bad_request');

  const assistantFirst = await runAi({ messages: [{ role: 'assistant', content: 'hi' }] });
  eq('assistant-first fails as bad_request', assistantFirst.ok === false && assistantFirst.kind, 'bad_request');

  if (!aiConfigured()) {
    const noKey = await runAi({ messages: [{ role: 'user', content: 'hi' }] });
    eq('missing key fails as not_configured', noKey.ok === false && noKey.kind, 'not_configured');
    eq('missing key is not retryable', noKey.ok === false && noKey.retryable, false);
    ok('failure carries elapsedMs', typeof noKey.elapsedMs === 'number');
    ok('failure message does not leak a key', !/sk-ant-/.test(noKey.ok === false ? noKey.message : ''));
  } else {
    console.log('  (key present: skipped the not_configured path)');
    pass++;
  }

  // ── 7. House style ───────────────────────────────────────────────────────
  for (const rel of ['src/shared/ai/client.ts', 'src/shared/ai/types.ts', 'src/shared/ai/models.ts']) {
    ok(`${rel} has no em dash`, !read(rel).includes('—'));
  }

  console.log(`\nverify-ai-client: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
