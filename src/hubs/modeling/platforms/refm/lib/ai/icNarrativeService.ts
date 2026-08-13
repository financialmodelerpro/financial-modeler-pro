/**
 * refm/lib/ai/icNarrativeService.ts (SERVER ONLY)
 *
 * IC narrative generation (AI foundation Unit 7). This is the first thing in
 * REFM that spends against the Anthropic key, and the order of operations below
 * is the whole point of the unit.
 *
 * THE ORDER, AND WHY IT IS THAT ORDER:
 *
 *   1. Resolve the field. An unknown field never reaches anything else.
 *   2. AVAILABILITY, before money. A scenario takeaway on a single-case model
 *      can only produce a paragraph saying the data is not available. Charging a
 *      generation for that would be charging for a known non-answer, so the
 *      refusal happens here, before the meter.
 *   3. METER, before the call. checkAndConsume reads the cap from the database
 *      (the rows the admin panel writes), claims one credit atomically, and
 *      denies on every uncertain path. It also enforces the feature TOGGLE: a
 *      disabled feature denies here, which is what makes the admin switch real
 *      rather than cosmetic. No API call can fire past this point without a
 *      credit having been claimed.
 *   4. GROUND. Collect the model facts through the shared abstraction. No
 *      recompute: the caller hands over an ICReportModel it already built, the
 *      same contract the deck export route uses, so the engine is never on the
 *      AI path.
 *   5. GENERATE through runAi, the single call path.
 *   6. SHAPE, then AUDIT. Every figure in the draft is checked against the facts
 *      that were actually supplied.
 *   7. REFUND on failure. The credit is consumed at step 3, before the call,
 *      because consuming after success would let concurrent requests all pass
 *      the check first. The cost of that order is that a call which produced
 *      nothing would still charge the user, so every failure after step 3 gives
 *      the credit back (migration 206). The concurrency guarantee is untouched:
 *      the decision to allow is still made once, atomically, up front.
 *
 *      A flagged draft is NOT a failure. The user received usable text, and the
 *      audit warning is information about it, so that generation keeps its
 *      count.
 *
 * AUDIT POLICY, decided here because Unit 4 deliberately left it open.
 * A draft carrying an unsupported figure is RETURNED, with the finding attached,
 * not discarded. Three reasons: the credit is already spent, so discarding
 * leaves the user with nothing to show for it; the audit is conservative by
 * design and flags derived figures and prose digits, so auto-rejection would
 * throw away sound drafts; and the whole premise of this feature is that a human
 * reviews an editable draft before it enters a pack. What is NOT acceptable is
 * silence, so the finding travels with the draft and Unit 8 surfaces it.
 *
 * THIS SERVICE NEVER WRITES. It returns a draft. Persisting it is the existing
 * user-confirmed PUT on report-inputs. Nothing here imports a persistence path,
 * and the verifier asserts that structurally.
 *
 * No em dashes in this file.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { aiConfigured, runAi } from '@/src/shared/ai/client';
import { checkAndConsume, meterDenyStatus, refundAiUsage, type MeterDenyReason } from '@/src/shared/ai/metering';
import { ensureAiFeature } from '@/src/shared/ai/features';
import { collectGrounding } from '@/src/shared/ai/grounding/providers';
import { buildGroundedRequest } from '@/src/shared/ai/grounding/render';
import { auditGroundedText, auditSummary, type AuditFigure } from '@/src/shared/ai/grounding/audit';
import type { GroundingBundle } from '@/src/shared/ai/grounding/types';
import type { AiResult } from '@/src/shared/ai/types';

import type { ICMoneyScale } from '../reportInputs';
import type { RiskItem } from '../reportInputs';
import type { ICReportModel } from '../reports/icReport';
import { registerRefmGroundingProviders } from './icModelGrounding';
import { IC_NARRATIVE_FEATURE } from './refmAiFeatures';
import {
  IC_NARRATIVE_FIELDS,
  IC_NARRATIVE_VOICE,
  narrativeTaskFor,
  shapeNarrativeOutput,
  type IcNarrativeFieldKey,
} from './icNarrative';
import {
  buildFreeformTask, parseFreeformOutput, validateInstruction,
  FREEFORM_MAX_TOKENS, type FreeformBlockContext,
} from './icFreeform';

/** Why a generation did not produce a draft. Callers map these to copy and to
 *  an HTTP status; the service does not know about HTTP. */
export type IcNarrativeFailure =
  /** The requested field is not one this feature drafts. */
  | { stage: 'field'; reason: 'unknown_field'; message: string; status: 400 }
  /** The model does not carry the data this field needs. No credit was spent. */
  | { stage: 'availability'; reason: 'not_applicable'; message: string; status: 409 }
  /** Metering refused: disabled, capped, no plan, or storage unreachable. */
  | { stage: 'metering'; reason: MeterDenyReason; message: string; status: number; cap: number | null; planKey: string | null }
  /** The AI call itself failed. The credit is refunded, see `refund`. */
  | { stage: 'ai'; reason: string; message: string; status: number; retryable: boolean; refund?: RefundReport }
  /** The call succeeded but returned nothing usable. The credit is refunded. */
  | { stage: 'empty'; reason: 'empty_response'; message: string; status: 502; refund?: RefundReport };

/**
 * What happened to the credit after a failed generation.
 *
 * Reported to the caller so the quota UI can show the RESTORED number rather
 * than assuming one way or the other, and so a refund that could not happen
 * (migration 206 not applied yet) is visible instead of silently leaving the
 * user short.
 */
export interface RefundReport {
  refunded: boolean;
  /** The count after the refund. Present only when one actually happened. */
  used?: number;
  remaining?: number;
  cap?: number;
  planKey?: string;
  /** Why nothing was given back. */
  reason?: string;
}

export interface IcNarrativeAuditReport {
  ok: boolean;
  checked: number;
  supported: number;
  rounded: number;
  /** The figures with no supporting fact. Carried in full so a reviewer can be
   *  pointed at the exact text, not just told a count. */
  unsupported: AuditFigure[];
  summary: string;
}

export interface IcNarrativeDraft {
  field: IcNarrativeFieldKey;
  label: string;
  /** The ReportInputs key this draft targets. The CLIENT decides whether to
   *  apply it, after the user confirms. */
  targetField: string;
  /** The editable draft. */
  draft: string;
  /** Structured rows, for the risks field only. */
  risks?: RiskItem[];
  audit: IcNarrativeAuditReport;
  meter: { used: number; cap: number; remaining: number; planKey: string; periodStart: string };
  model: string;
  usage: { inputTokens: number | null; outputTokens: number | null };
  elapsedMs: number;
}

export type IcNarrativeResult =
  | ({ ok: true } & IcNarrativeDraft)
  | ({ ok: false } & IcNarrativeFailure);

/**
 * Test seam. The verifier substitutes these to prove properties that must hold
 * without an API key or a database, above all the load-bearing one: that a
 * denied meter decision results in ZERO AI calls.
 */
export interface IcNarrativeDeps {
  meter: typeof checkAndConsume;
  run: typeof runAi;
  collect: typeof collectGrounding;
  ensure: typeof ensureAiFeature;
  /** Whether an API key is present. Injected so the verifier can prove that an
   *  unconfigured deployment costs the user nothing. */
  configured: typeof aiConfigured;
  /** Gives a consumed generation back when the call it paid for failed. */
  refund: typeof refundAiUsage;
}

const DEFAULT_DEPS: IcNarrativeDeps = { meter: checkAndConsume, run: runAi, collect: collectGrounding, ensure: ensureAiFeature, configured: aiConfigured, refund: refundAiUsage };

export interface GenerateIcNarrativeInput {
  userId: string;
  field: IcNarrativeFieldKey;
  /** ALREADY ASSEMBLED by the caller. Never rebuilt here: no recompute on the
   *  AI path, exactly as the deck export route does it. */
  model: ICReportModel;
  /** Money scale, matching the deck setting so a narrative figure reads the same
   *  as the slide beside it. */
  scale?: ICMoneyScale;
  currency?: string;
  /** Include the full year-by-year schedules in the grounding. Off by default:
   *  prompt size is metered spend, and the summary fact set is what these fields
   *  actually interpret. */
  includeSeries?: boolean;
  asOf?: string;
  sb?: SupabaseClient;
  deps?: Partial<IcNarrativeDeps>;
}

/**
 * Draft one narrative field.
 *
 * Never throws: every outcome is a typed result, matching the convention the
 * central client set, so a route branches on a union instead of catching.
 */
export async function generateIcNarrative(input: GenerateIcNarrativeInput): Promise<IcNarrativeResult> {
  const deps = { ...DEFAULT_DEPS, ...(input.deps ?? {}) };

  // 1. The field.
  const spec = IC_NARRATIVE_FIELDS[input.field];
  if (!spec) {
    return { ok: false, stage: 'field', reason: 'unknown_field', status: 400, message: `"${String(input.field)}" is not a narrative field this feature drafts.` };
  }

  // 2. Availability, BEFORE the meter. Never charge for a known non-answer.
  if (!input.model || typeof input.model !== 'object') {
    return { ok: false, stage: 'availability', reason: 'not_applicable', status: 409, message: 'No assembled report model was supplied, so there is nothing to interpret.' };
  }
  const availability = spec.available(input.model);
  if (!availability.ok) {
    return { ok: false, stage: 'availability', reason: 'not_applicable', status: 409, message: availability.reason };
  }

  // 2b. Is a generation even possible? Checked BEFORE the meter, for the same
  //     reason availability is: metering consumes the credit up front, so a
  //     call that cannot possibly succeed would cost the user one of their
  //     monthly generations and return an error. With no API key configured,
  //     the outcome is known in advance and costs nothing to check.
  //
  //     This cannot cover every deployment failure (an account out of credit is
  //     only discoverable by calling), but it removes the one case that is
  //     knowable for free.
  if (!deps.configured()) {
    return {
      ok: false,
      stage: 'ai',
      reason: 'not_configured',
      status: 503,
      retryable: false,
      message: 'AI is not configured on this deployment, so no draft can be generated. No AI allowance was used.',
    };
  }

  // 3. Metering. Registration first so the feature exists to be toggled and
  //    capped; a registration failure is not fatal because metering denies an
  //    unregistered feature, which fails closed rather than opening the gate.
  await deps.ensure(IC_NARRATIVE_FEATURE, input.sb);

  const decision = await deps.meter({
    userId: input.userId,
    featureId: IC_NARRATIVE_FEATURE.featureId,
    platformSlug: IC_NARRATIVE_FEATURE.platformSlug,
    sb: input.sb,
  });

  if (!decision.allowed) {
    console.warn('[ic-narrative] denied by metering:', { field: input.field, reason: decision.reason, cap: decision.cap, plan: decision.planKey });
    return {
      ok: false,
      stage: 'metering',
      reason: decision.reason,
      message: decision.message,
      status: meterDenyStatus(decision.reason),
      cap: decision.cap,
      planKey: decision.planKey,
    };
  }

  // 4. Grounding.
  //
  // The types come from the feature DEFINITION in code, not from the database
  // row. That is not a shortcut: grounding is contract, not config, and the
  // admin panel deliberately cannot edit it (it is refreshed from code on every
  // registration). Reading it from code keeps this call honest even if a row
  // were edited out of band, and saves a query on a metered path.
  registerRefmGroundingProviders();
  const bundle: GroundingBundle = await deps.collect({
    types: IC_NARRATIVE_FEATURE.grounding,
    input: {
      platformSlug: IC_NARRATIVE_FEATURE.platformSlug,
      featureId: IC_NARRATIVE_FEATURE.featureId,
      asOf: input.asOf,
      payload: {
        model: input.model,
        options: {
          scale: input.scale ?? 'millions',
          currencyCode: input.currency ?? 'SAR',
          includeSeries: input.includeSeries === true,
        },
      },
    },
  });

  // 5. Generate. The figure rules come from the shared render layer and bracket
  //    the payload; the field task and the house voice sit inside them.
  const request = buildGroundedRequest({
    bundle,
    task: narrativeTaskFor(spec),
    voice: IC_NARRATIVE_VOICE,
    maxTokens: spec.maxTokens,
  });

  /**
   * Give the credit back. Called on EVERY path after a successful consume that
   * did not end with a usable draft in the user's hands.
   *
   * It refunds the exact counter that was charged: the feature row id and the
   * period come from the decision, not from a fresh lookup, so a generation
   * that straddles a month boundary is credited back to the month it was
   * charged to.
   *
   * A refund that itself fails is reported, never thrown: this runs on a path
   * that is already handling a failure, and a second error in front of the user
   * would be worse than a lost credit.
   */
  const giveBack = async (): Promise<RefundReport> => {
    const out = await deps.refund({
      userId: input.userId,
      featureRowId: decision.featureRowId,
      periodStart: decision.periodStart,
      sb: input.sb,
    });
    if (!out.refunded) {
      console.error('[ic-narrative] the credit could NOT be refunded:', { field: input.field, reason: out.reason });
      return { refunded: false, reason: out.reason };
    }
    return {
      refunded: true,
      used: out.used,
      cap: decision.cap,
      remaining: Math.max(0, decision.cap - out.used),
      planKey: decision.planKey,
    };
  };

  const result: AiResult = await deps.run(request);

  if (!result.ok) {
    // The credit was consumed before the call, which is the right order for
    // concurrency, so it is given back here. Every AI failure lands in this
    // branch: an out-of-credit account, a rate limit, a timeout, a network
    // drop, a refusal, an unknown error. The user asked for a draft and did not
    // get one, so it must not cost them a generation.
    console.error('[ic-narrative] AI call failed:', { field: input.field, kind: result.kind, status: result.status, detail: result.message });
    const refund = await giveBack();
    return {
      ok: false,
      stage: 'ai',
      reason: result.kind,
      refund,
      // Both of these are DEPLOYMENT problems, not user problems, and both are
      // stated as such: a user who reads "the draft could not be generated"
      // will retry, spending another credit on a call that cannot succeed.
      message: result.kind === 'not_configured'
        ? 'AI is not configured on this deployment. No generation is possible until an API key is set.'
        : result.kind === 'insufficient_credit'
          ? 'AI generation is unavailable: the platform\'s AI account is out of credit. This is a billing issue on our side, not a problem with your project or your plan. Please contact support.'
          : `The draft could not be generated: ${result.message}`,
      status: result.status && result.status >= 400 && result.status < 600 ? result.status : 502,
      retryable: result.retryable,
    };
  }

  // 6. Shape, then audit the SHAPED text, which is what a reviewer will read.
  const shaped = shapeNarrativeOutput(spec, result.text);
  if (!shaped.text.trim()) {
    // A 200 with nothing usable in it. The call technically succeeded, but the
    // user has no draft, so by the rule above the credit goes back.
    const refund = await giveBack();
    return { ok: false, stage: 'empty', reason: 'empty_response', status: 502, refund, message: 'The model returned an empty draft, so nothing was generated. Your AI allowance has not been used.' };
  }

  const audit = auditGroundedText(shaped.text, bundle);
  if (!audit.ok) {
    // Logged, always. A quiet unsupported figure is the exact failure this whole
    // layer exists to prevent, so it is on the server record whether or not the
    // UI surfaces it.
    console.warn('[ic-narrative] unsupported figures in draft:', { field: input.field, summary: auditSummary(audit) });
  }

  return {
    ok: true,
    field: spec.key,
    label: spec.label,
    targetField: String(spec.targetField),
    draft: shaped.text,
    ...(shaped.risks ? { risks: shaped.risks } : {}),
    audit: {
      ok: audit.ok,
      checked: audit.checked,
      supported: audit.supported.length,
      rounded: audit.rounded.length,
      unsupported: audit.unsupported,
      summary: auditSummary(audit),
    },
    meter: {
      used: decision.used,
      cap: decision.cap,
      remaining: decision.remaining,
      planKey: decision.planKey,
      periodStart: decision.periodStart,
    },
    model: result.model,
    usage: result.usage,
    elapsedMs: result.elapsedMs,
  };
}

// ---------------------------------------------------------------------------
//  Free-form drafting
// ---------------------------------------------------------------------------

/**
 * Draft any block from a free instruction.
 *
 * SAME PIPELINE, SAME ORDER, SAME MONEY RULES as the six fixed fields above:
 * configured check before the meter, meter before the call, ground through the
 * same abstraction with the same whitelisted facts, audit the output, refund
 * every failure. It deliberately reuses `generateIcNarrative`'s dependencies and
 * its refund helper rather than restating them, because a second copy of
 * "consume before, refund after" is a second chance to get it wrong.
 *
 * TWO THINGS ARE DIFFERENT, AND ONLY TWO.
 *
 * 1. THE TASK IS THE USER'S. It is validated and bounded (see icFreeform), then
 *    placed in the task slot, which `buildGroundedRequest` brackets with the
 *    figure rules on both sides. Grounding is untouched: same provider, same
 *    model facts, no new source. A free instruction cannot introduce one.
 *
 * 2. A REFUSAL IS A FIRST-CLASS OUTCOME. The instruction can ask for something
 *    the model has no facts for, so the prompt requires all-or-nothing and the
 *    response is parsed for the refusal sentinel. A refusal is returned as
 *    `refused: true` with NO draft, so the UI cannot present it as text to
 *    apply. It KEEPS its counted generation: the call was made, the tokens were
 *    spent, and the user got a true and useful answer. Refunding it would also
 *    make refusing free and drafting expensive, which is the wrong incentive to
 *    build into a no-fabrication feature.
 */
export interface GenerateIcFreeformInput extends Omit<GenerateIcNarrativeInput, 'field'> {
  instruction: string;
  block: FreeformBlockContext;
}

export interface IcFreeformDraft extends Omit<IcNarrativeDraft, 'field' | 'targetField' | 'risks'> {
  /** Discriminates a free-form draft from one of the six fixed fields. */
  kind: 'freeform';
  instruction: string;
  /** True when the model declined because the supplied data cannot support the
   *  instruction. `draft` is empty in that case, by construction. */
  refused: boolean;
  refusalReason?: string;
}

export type IcFreeformResult =
  | ({ ok: true } & IcFreeformDraft)
  | ({ ok: false } & IcNarrativeFailure);

export async function generateIcFreeform(input: GenerateIcFreeformInput): Promise<IcFreeformResult> {
  const deps = { ...DEFAULT_DEPS, ...(input.deps ?? {}) };

  // 1. The instruction. Validated BEFORE anything else, and before the meter:
  //    an empty or oversized instruction is a known non-answer, and charging a
  //    generation for one would be charging for a request we already refused.
  const validated = validateInstruction(input.instruction);
  if (!validated.ok) {
    return { ok: false, stage: 'field', reason: 'unknown_field', status: 400, message: validated.reason };
  }

  // 2. Availability, before money. There is no per-field predicate here, but
  //    the same two facts still have to hold: a model to ground against, and a
  //    block to write into.
  if (!input.model || typeof input.model !== 'object') {
    return { ok: false, stage: 'availability', reason: 'not_applicable', status: 409, message: 'No assembled report model was supplied, so there is nothing to interpret.' };
  }
  if (!input.block || typeof input.block !== 'object' || !input.block.kind) {
    return { ok: false, stage: 'availability', reason: 'not_applicable', status: 409, message: 'No block was selected, so there is nowhere for the draft to go.' };
  }

  if (!deps.configured()) {
    return { ok: false, stage: 'ai', reason: 'not_configured', status: 503, retryable: false, message: 'AI is not configured on this deployment, so no draft can be generated. No AI allowance was used.' };
  }

  // 3. Metering. Same feature, same caps, same toggle: a free instruction is
  //    not a second product and does not get a second allowance.
  await deps.ensure(IC_NARRATIVE_FEATURE, input.sb);
  const decision = await deps.meter({
    userId: input.userId,
    featureId: IC_NARRATIVE_FEATURE.featureId,
    platformSlug: IC_NARRATIVE_FEATURE.platformSlug,
    sb: input.sb,
  });
  if (!decision.allowed) {
    console.warn('[ic-freeform] denied by metering:', { reason: decision.reason, cap: decision.cap, plan: decision.planKey });
    return {
      ok: false, stage: 'metering', reason: decision.reason, message: decision.message,
      status: meterDenyStatus(decision.reason), cap: decision.cap, planKey: decision.planKey,
    };
  }

  // 4. Grounding. IDENTICAL to the fixed fields: the same provider, the same
  //    model facts, the same types read from the code definition.
  registerRefmGroundingProviders();
  const bundle: GroundingBundle = await deps.collect({
    types: IC_NARRATIVE_FEATURE.grounding,
    input: {
      platformSlug: IC_NARRATIVE_FEATURE.platformSlug,
      featureId: IC_NARRATIVE_FEATURE.featureId,
      asOf: input.asOf,
      payload: {
        model: input.model,
        options: {
          scale: input.scale ?? 'millions',
          currencyCode: input.currency ?? 'SAR',
          includeSeries: input.includeSeries === true,
        },
      },
    },
  });

  const request = buildGroundedRequest({
    bundle,
    task: buildFreeformTask(validated.instruction, input.block),
    voice: IC_NARRATIVE_VOICE,
    maxTokens: FREEFORM_MAX_TOKENS,
  });

  const giveBack = async (): Promise<RefundReport> => {
    const out = await deps.refund({
      userId: input.userId,
      featureRowId: decision.featureRowId,
      periodStart: decision.periodStart,
      sb: input.sb,
    });
    if (!out.refunded) {
      console.error('[ic-freeform] the credit could NOT be refunded:', { reason: out.reason });
      return { refunded: false, reason: out.reason };
    }
    return { refunded: true, used: out.used, cap: decision.cap, remaining: Math.max(0, decision.cap - out.used), planKey: decision.planKey };
  };

  const result: AiResult = await deps.run(request);

  if (!result.ok) {
    console.error('[ic-freeform] AI call failed:', { kind: result.kind, status: result.status, detail: result.message });
    const refund = await giveBack();
    return {
      ok: false, stage: 'ai', reason: result.kind, refund,
      message: result.kind === 'not_configured'
        ? 'AI is not configured on this deployment. No generation is possible until an API key is set.'
        : result.kind === 'insufficient_credit'
          ? 'AI generation is unavailable: the platform\'s AI account is out of credit. This is a billing issue on our side, not a problem with your project or your plan. Please contact support.'
          : `The draft could not be generated: ${result.message}`,
      status: result.status && result.status >= 400 && result.status < 600 ? result.status : 502,
      retryable: result.retryable,
    };
  }

  const parsed = parseFreeformOutput(result.text);

  // A REFUSAL is a successful outcome with no draft. It is not routed through
  // the empty-response branch below, which exists for a call that returned
  // nothing usable: here the model returned something useful, namely a clear
  // statement that the data cannot support the request.
  const meter = {
    used: decision.used, cap: decision.cap, remaining: decision.remaining,
    planKey: decision.planKey, periodStart: decision.periodStart,
  };
  const common = { label: 'Free-form draft', kind: 'freeform' as const, instruction: validated.instruction, meter, model: result.model, usage: result.usage, elapsedMs: result.elapsedMs };

  if (parsed.refused) {
    console.warn('[ic-freeform] refused for lack of grounded data:', { reason: parsed.refusalReason });
    return {
      ok: true, ...common,
      draft: '',
      refused: true,
      refusalReason: parsed.refusalReason,
      // Nothing was drafted, so there is nothing to audit. Reported as a clean
      // zero-figure audit rather than omitted, so the UI has one shape to read.
      audit: { ok: true, checked: 0, supported: 0, rounded: 0, unsupported: [], summary: 'No draft was produced, so no figures were checked.' },
    };
  }

  if (!parsed.text.trim()) {
    const refund = await giveBack();
    return { ok: false, stage: 'empty', reason: 'empty_response', status: 502, refund, message: 'The model returned an empty draft, so nothing was generated. Your AI allowance has not been used.' };
  }

  const audit = auditGroundedText(parsed.text, bundle);
  if (!audit.ok) {
    console.warn('[ic-freeform] unsupported figures in draft:', { summary: auditSummary(audit) });
  }

  return {
    ok: true, ...common,
    draft: parsed.text,
    refused: false,
    audit: {
      ok: audit.ok,
      checked: audit.checked,
      supported: audit.supported.length,
      rounded: audit.rounded.length,
      unsupported: audit.unsupported,
      summary: auditSummary(audit),
    },
  };
}

/**
 * Which fields this project can currently draft, and why not for the rest.
 *
 * Pure over the supplied model and free: it costs no credit and makes no call,
 * so Unit 8 can render six buttons with three of them explained-and-disabled
 * rather than letting a user spend a generation to be told there was no data.
 */
export function icNarrativeAvailability(model: ICReportModel): Array<{
  field: IcNarrativeFieldKey;
  label: string;
  available: boolean;
  reason?: string;
}> {
  return (Object.keys(IC_NARRATIVE_FIELDS) as IcNarrativeFieldKey[]).map((key) => {
    const spec = IC_NARRATIVE_FIELDS[key];
    const a = model ? spec.available(model) : { ok: false as const, reason: 'No report model is loaded.' };
    return { field: key, label: spec.label, available: a.ok, ...(a.ok ? {} : { reason: a.reason }) };
  });
}
