/* eslint-disable @typescript-eslint/no-explicit-any, no-console */
/**
 * verify-ic-freeform.ts
 *
 * Feature A: free-form AI drafting on any block.
 *
 * The six fixed fields are a closed set with known scope. A free instruction is
 * not, so the properties that matter are different, and four of them carry the
 * whole feature:
 *
 *   1. GROUNDING IS UNCHANGED. Same provider, same whitelisted model facts, no
 *      new source. Proven by EXECUTION: the collect call is captured and its
 *      requested types compared against the feature definition, so "no new
 *      grounding source" is a measurement rather than a claim in a comment.
 *
 *   2. IT REFUSES WHOLLY, NEVER PARTIALLY. An instruction asking for something
 *      the model does not carry (market benchmarks being the obvious case) must
 *      come back as a refusal with NO draft, so nothing half-grounded can be
 *      applied. The prompt has to demand that, and the parser has to detect it.
 *
 *   3. AN EMPTY BLOCK IS HANDLED EXPLICITLY. A block on a freshly added blank
 *      slide has no content and no purpose, so the prompt must SAY so rather
 *      than send a silent empty string, which is what makes a model invent a
 *      subject.
 *
 *   4. THE MONEY RULES ARE THE SAME ONES. Same feature id, same caps, meter
 *      before the call, refund on failure, and no call at all past a denial.
 *      Proven by counting calls on injected fakes, the same way Unit 7 proved
 *      it for the fixed fields.
 *
 * Run: npx tsx scripts/verify-ic-freeform.ts
 *
 * No em dashes in this file.
 */
import { readFileSync } from 'fs';
import {
  validateInstruction, buildFreeformTask, describeBlock, refusalRule, parseFreeformOutput,
  blockIsEmpty, FREEFORM_REFUSAL_MARKER, FREEFORM_INSTRUCTION_MAX, FREEFORM_MAX_TOKENS,
  type FreeformBlockContext,
} from '../src/hubs/modeling/platforms/refm/lib/ai/icFreeform';
import { generateIcFreeform } from '../src/hubs/modeling/platforms/refm/lib/ai/icNarrativeService';
import { IC_NARRATIVE_FEATURE } from '../src/hubs/modeling/platforms/refm/lib/ai/refmAiFeatures';
import { GROUNDING_RULES } from '../src/shared/ai/grounding/render';

let pass = 0, fail = 0;
const failures: string[] = [];
const check = (name: string, cond: boolean, detail = ''): void => {
  if (cond) { pass++; console.log(`  [PASS] ${name}`); }
  else { fail++; failures.push(name); console.log(`  [FAIL] ${name}${detail ? ' :: ' + detail : ''}`); }
};

const BLOCK: FreeformBlockContext = { kind: 'text', slideTitle: 'Returns Analysis', current: 'The project return is earned on the development spread.', name: 'Caption body' };
const EMPTY_BLOCK: FreeformBlockContext = { kind: 'text', slideTitle: 'Untitled slide', current: '' };

/** A model just rich enough to pass the availability gate. */
const MODEL = { headline: { projectIrr: 0.12 }, overview: { name: 'Riverside' } } as any;

/** Injected dependencies that record what the service actually did. */
function fakes(o: { allowed?: boolean; text?: string; runFails?: boolean } = {}) {
  const calls = { meter: 0, run: 0, collect: 0, refund: 0, ensure: 0 };
  const seen: { types?: readonly string[]; task?: string; system?: string; maxTokens?: number } = {};
  const deps: any = {
    ensure: async () => { calls.ensure++; },
    meter: async () => {
      calls.meter++;
      return o.allowed === false
        ? { allowed: false, reason: 'cap_reached', message: 'Monthly AI limit reached.', cap: 5, planKey: 'pro' }
        : { allowed: true, used: 1, cap: 5, remaining: 4, planKey: 'pro', periodStart: '2026-08-01', featureRowId: 'row-1' };
    },
    collect: async (arg: any) => {
      calls.collect++;
      seen.types = arg.types;
      return { documents: [{ type: 'model', title: 'Model', facts: [{ key: 'irr', label: 'Project IRR', kind: 'pct', value: 0.12, formatted: '12.0%' }] }] };
    },
    run: async (req: any) => {
      calls.run++;
      // The two halves are captured separately because the bracketing IS the
      // safety property: the standing figure rules go in `system`, which
      // precedes everything, and the task (carrying the user's instruction)
      // goes in the user message, with the figure reminder repeated after it.
      seen.system = req.system ?? '';
      seen.task = req.messages?.[0]?.content ?? '';
      seen.maxTokens = req.maxTokens;
      if (o.runFails) return { ok: false, kind: 'timeout', status: 504, retryable: true, message: 'timed out' };
      return { ok: true, text: o.text ?? 'The levered return sits above the unlevered one.', model: 'claude-x', usage: { inputTokens: 10, outputTokens: 20 }, elapsedMs: 5 };
    },
    refund: async () => { calls.refund++; return { refunded: true, used: 0 }; },
    configured: () => true,
  };
  return { deps, calls, seen };
}

const run = (o: Parameters<typeof fakes>[0] = {}, input: any = {}) => {
  const f = fakes(o);
  return generateIcFreeform({
    userId: 'u1', instruction: 'Write this up.', block: BLOCK, model: MODEL,
    ...input, deps: f.deps,
  } as any).then((res) => ({ res, ...f }));
};

async function main(): Promise<void> {
  console.log('=== IC free-form drafting ===');

  console.log('\n-- The instruction is validated before anything is spent --');
  {
    check('an empty instruction is rejected', validateInstruction('').ok === false);
    check('whitespace only is rejected', validateInstruction('   ').ok === false);
    check('a non-string is rejected', validateInstruction(undefined).ok === false);
    const long = validateInstruction('a'.repeat(FREEFORM_INSTRUCTION_MAX + 1));
    check('an over-long instruction is REJECTED, not truncated', long.ok === false);
    check('and the refusal says how long it was', long.ok === false && /\d+ characters/.test(long.reason));
    const good = validateInstruction('  Explain   this IRR.  ');
    check('a real instruction passes and is normalised', good.ok === true && good.instruction === 'Explain this IRR.');
    const dashed = validateInstruction(`Write this up${String.fromCharCode(0x2014)}briefly.`);
    check('an em dash in the instruction is removed', dashed.ok === true && !dashed.instruction.includes(String.fromCharCode(0x2014)));
    const ctrl = validateInstruction(`Write${String.fromCharCode(0)}this up.`);
    check('control characters are neutralised', ctrl.ok === true && !ctrl.instruction.includes(String.fromCharCode(0)));
    // An invalid instruction must cost NOTHING: no meter, no call.
    const r = await run({}, { instruction: '' });
    check('an invalid instruction never reaches the meter', r.calls.meter === 0);
    check('and never reaches the AI', r.calls.run === 0);
    check('and reports as a 400', r.res.ok === false && (r.res as any).status === 400);
  }

  console.log('\n-- 3. An EMPTY block is described as empty --');
  {
    check('blockIsEmpty is true for a blank block', blockIsEmpty(EMPTY_BLOCK) === true);
    check('and false when there is content', blockIsEmpty(BLOCK) === false);
    const d = describeBlock(EMPTY_BLOCK);
    check('the prompt SAYS the block is empty', /EMPTY/.test(d));
    check('and that it has no assigned purpose', /no assigned purpose/i.test(d));
    check('and that the instruction is the only context', /only thing that says what belongs here/i.test(d));
    check('and tells the model not to assume a subject', /do not assume a subject/i.test(d));
    const withContent = describeBlock(BLOCK);
    check('a non-empty block quotes what it currently says', withContent.includes(BLOCK.current));
    check('and says the draft REPLACES it', /REPLACE/.test(withContent));
    check('the two descriptions are genuinely different', d !== withContent);
  }

  console.log('\n-- 2. The refusal contract: all or nothing --');
  {
    const rule = refusalRule();
    check('the prompt names the refusal sentinel', rule.includes(FREEFORM_REFUSAL_MARKER));
    check('it forbids a PARTIAL answer outright', /Do NOT answer partially/i.test(rule));
    check('it forbids hedging the gap with a caveat', /do not hedge the gap/i.test(rule));
    check('it says a half-grounded paragraph is worse than a refusal', /worse than a refusal/i.test(rule));
    check('it names market benchmarks as the obvious case', /market benchmarks/i.test(rule));
    check('and names comparables and industry averages too', /comparable/i.test(rule) && /industry averages/i.test(rule));

    const refused = parseFreeformOutput(`${FREEFORM_REFUSAL_MARKER} I would need market rent benchmarks, which are not in the supplied data.`);
    check('a refusal is detected', refused.refused === true);
    check('and carries NO draft', refused.text === '');
    check('and names what was missing', /market rent benchmarks/i.test(refused.refusalReason ?? ''));
    const drafted = parseFreeformOutput('The levered return sits above the unlevered one.');
    check('an ordinary draft is not mistaken for a refusal', drafted.refused === false && drafted.text.length > 0);
    // A draft that merely TALKS about being unable to source something must not
    // be swallowed as a refusal: only the literal sentinel counts.
    const mentions = parseFreeformOutput('The model carries no market benchmark, so the comparison is internal only.');
    check('a draft that MENTIONS missing data is still a draft', mentions.refused === false && mentions.text.length > 0);
    const trailing = parseFreeformOutput(`Here is the draft.\n${FREEFORM_REFUSAL_MARKER} and I could not do the rest.`);
    check('a sentinel AFTER a draft keeps the draft and drops the note',
      trailing.refused === false && trailing.text === 'Here is the draft.');
  }

  console.log('\n-- The refusal survives the whole service path --');
  {
    const r = await run({ text: `${FREEFORM_REFUSAL_MARKER} no market data is supplied.` });
    check('a refusal returns ok:true (it is an answer, not an error)', r.res.ok === true);
    check('with refused true', (r.res as any).refused === true);
    check('and an EMPTY draft, so nothing can be applied', (r.res as any).draft === '');
    check('and the reason travels with it', /market data/i.test((r.res as any).refusalReason ?? ''));
    // A refusal KEEPS its count: the call was made and the tokens were spent.
    // Refunding it would also make refusing free and answering expensive.
    check('a refusal does NOT refund the credit', r.calls.refund === 0);
    check('and it reports the meter reading', !!(r.res as any).meter);
  }

  console.log('\n-- 1. Grounding is UNCHANGED, measured not claimed --');
  {
    const r = await run();
    check('grounding was collected', r.calls.collect === 1);
    check('the requested types are exactly the feature definition\'s',
      JSON.stringify(r.seen.types) === JSON.stringify(IC_NARRATIVE_FEATURE.grounding),
      `${JSON.stringify(r.seen.types)} vs ${JSON.stringify(IC_NARRATIVE_FEATURE.grounding)}`);
    check('which is model grounding only, so no new source was added',
      JSON.stringify(IC_NARRATIVE_FEATURE.grounding) === JSON.stringify(['model']));
    // The standing figure rules must bracket the user's instruction. This is
    // what makes a user-authored task safe to send: the instruction sits INSIDE
    // rules it cannot reach around.
    const sent = String(r.seen.task ?? '');
    const system = String(r.seen.system ?? '');
    const firstRule = GROUNDING_RULES.split('\n').find((l) => l.startsWith('1. Use ONLY')) ?? '1. Use ONLY';
    check('the standing grounding rules are sent, in the SYSTEM prompt', system.includes(firstRule));
    check('the no-outside-data rule is among them', /Never introduce market data, benchmarks/i.test(system));
    check('the user instruction is in the user message, not the system prompt',
      sent.includes('Write this up.') && !system.includes('Write this up.'));
    check('the instruction is delimited as a request, not as a rule', /THE REQUEST FROM THE PERSON EDITING THIS DECK/.test(sent));
    // The figure reminder is repeated AFTER the task, so the instruction is
    // bracketed on both sides and cannot be the last word the model reads.
    check('the figure reminder is repeated after the instruction',
      sent.lastIndexOf('every figure you write must appear verbatim') > sent.indexOf('Write this up.'));
    check('the output ceiling is the free-form one', r.seen.maxTokens === FREEFORM_MAX_TOKENS);
  }

  console.log('\n-- 4. The money rules are the same ones --');
  {
    const denied = await run({ allowed: false });
    check('a denied meter produces NO ai call', denied.calls.run === 0);
    check('and no grounding is collected either', denied.calls.collect === 0);
    check('and it reports as a metering refusal', denied.res.ok === false && (denied.res as any).stage === 'metering');

    const ok = await run();
    check('the meter is consulted before the call', ok.calls.meter === 1 && ok.calls.run === 1);
    check('a success does NOT refund', ok.calls.refund === 0);

    const failed = await run({ runFails: true });
    check('a failed call REFUNDS the credit', failed.calls.refund === 1);
    check('and reports the failure', failed.res.ok === false && (failed.res as any).stage === 'ai');

    const empty = await run({ text: '   ' });
    check('an empty response refunds too', empty.calls.refund === 1);
    check('and reports as empty', empty.res.ok === false && (empty.res as any).stage === 'empty');

    // Availability before money, exactly as the fixed fields do it.
    const noModel = await generateIcFreeform({ userId: 'u1', instruction: 'Write this up.', block: BLOCK, model: null as any, deps: fakes().deps } as any);
    check('no model refuses BEFORE the meter', noModel.ok === false && (noModel as any).stage === 'availability');
    const noBlock = await generateIcFreeform({ userId: 'u1', instruction: 'Write this up.', block: null as any, model: MODEL, deps: fakes().deps } as any);
    check('no block refuses before the meter', noBlock.ok === false && (noBlock as any).stage === 'availability');
    const f = fakes();
    await generateIcFreeform({ userId: 'u1', instruction: 'Write this up.', block: BLOCK, model: MODEL, deps: { ...f.deps, configured: () => false } } as any);
    check('an unconfigured deployment costs nothing', f.calls.meter === 0 && f.calls.run === 0);
  }

  console.log('\n-- The same metered feature, not a second allowance --');
  {
    const svc = readFileSync('src/hubs/modeling/platforms/refm/lib/ai/icNarrativeService.ts', 'utf8');
    const block = svc.slice(svc.indexOf('export async function generateIcFreeform'));
    check('free-form meters against IC_NARRATIVE_FEATURE', /featureId: IC_NARRATIVE_FEATURE\.featureId/.test(block));
    check('and declares no cap of its own', !/cap:\s*\d/.test(block));
    check('and imports no persistence writer', !/saveReportInputs|updateObject|supabase/i.test(block));
  }

  console.log('\n-- The task composes in the documented order --');
  {
    const task = buildFreeformTask('Explain this IRR.', EMPTY_BLOCK);
    const iBlock = task.indexOf('THE BLOCK YOU ARE WRITING FOR');
    const iRule = task.indexOf('BEFORE YOU WRITE');
    const iReq = task.indexOf('THE REQUEST FROM THE PERSON');
    const iShape = task.indexOf('READS AS:');
    check('block, then rule, then request, then shape',
      iBlock >= 0 && iBlock < iRule && iRule < iReq && iReq < iShape,
      `${iBlock} ${iRule} ${iReq} ${iShape}`);
    check('the shape line is LAST', iShape === Math.max(iBlock, iRule, iReq, iShape));
    check('the instruction appears verbatim', task.includes('Explain this IRR.'));
  }

  console.log('\n-- House style --');
  for (const f of [
    'src/hubs/modeling/platforms/refm/lib/ai/icFreeform.ts',
    'src/hubs/modeling/platforms/refm/lib/ai/icNarrativeService.ts',
    'src/hubs/modeling/platforms/refm/components/modules/deck/NarrativeAi.tsx',
    'scripts/verify-ic-freeform.ts',
  ]) {
    check(`no em dash in ${f.split('/').pop()}`, !readFileSync(f, 'utf8').includes(String.fromCharCode(0x2014)));
  }
  {
    const ui = readFileSync('src/hubs/modeling/platforms/refm/components/modules/deck/NarrativeAi.tsx', 'utf8');
    check('the review offers NO Apply on a refusal', /\{d\.refused \? null : \(\s*<button style=\{panelBtn\('primary'\)\}/.test(ui));
    check('apply-all skips refusals', /live\.filter\(\(x\) => !x\.refused\)\.map\(withEdits\)/.test(ui));
    check('a draft is still never auto-applied', !/onApply\(\[.*\]\);\s*\/\/ auto/.test(ui));
  }

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  if (fail) { console.log('Failures:'); for (const x of failures) console.log(`  - ${x}`); process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); });
