/**
 * /api/refm/projects/[id]/ai/ic-narrative (Module 7, AI foundation Unit 7)
 *
 * POST -> draft ONE IC narrative field from the project's computed figures and
 * return it as an editable draft.
 *
 * This is the first REFM endpoint that spends against the Anthropic key, so what
 * it does NOT do matters as much as what it does:
 *
 *   - It NEVER writes. No report input, no deck, no version. It returns text.
 *     Saving stays the existing user-confirmed PUT on report-inputs, which is
 *     what makes "editable draft, never auto-saved" true at the server rather
 *     than only in the UI.
 *   - It NEVER recomputes. The client posts the ICReportModel it already
 *     assembled and rendered, exactly the contract the deck export route uses,
 *     so a narrative figure cannot drift from the slide beside it and the engine
 *     stays off the AI path.
 *   - It NEVER decides the cap. Metering reads ai_feature_caps, the rows
 *     /admin/ai-features writes. There is no cap value in this file, and the
 *     feature toggle is enforced by the same call.
 *
 * ONE FIELD PER REQUEST, so one generation is one counted call. A "generate all"
 * in Unit 8 is a loop of counted calls, which keeps the count honest whatever
 * the button says.
 *
 * Auth: NextAuth session, then project ownership. A read-only GRACE user and a
 * LAPSED user are blocked by the same gate that blocks saving, because a draft
 * they cannot save is spend with no outcome.
 *
 * Runs on Node: the AI client is server-only and the key never reaches a client
 * bundle.
 *
 * No em dashes in this file.
 */

import { NextRequest, NextResponse } from 'next/server';

import { getProject } from '@/src/hubs/modeling/platforms/refm/lib/persistence/server';
import { getRefmUserContext } from '@/src/hubs/modeling/platforms/refm/lib/persistence/auth';
import { resolveUserGate } from '@/src/shared/entitlements/resolveUser';
import { writeBlockReason } from '@/src/shared/entitlements/gate';
import { generateIcNarrative, generateIcFreeform } from '@/src/hubs/modeling/platforms/refm/lib/ai/icNarrativeService';
import { IC_NARRATIVE_FIELDS, IC_NARRATIVE_FIELD_KEYS, coerceNarrativeFieldKey } from '@/src/hubs/modeling/platforms/refm/lib/ai/icNarrative';
import { IC_NARRATIVE_FEATURE } from '@/src/hubs/modeling/platforms/refm/lib/ai/refmAiFeatures';
import { ensureAiFeature } from '@/src/shared/ai/features';
import { getAiFeature } from '@/src/shared/ai/registry';
import { resolveAiCap } from '@/src/shared/ai/registryTypes';
import { currentPeriodStart, resolveUserPlanKey } from '@/src/shared/ai/metering';
import { readAiUsed } from '@/src/shared/ai/usage';
import { aiConfigured } from '@/src/shared/ai/client';
import type { ICReportModel } from '@/src/hubs/modeling/platforms/refm/lib/reports/icReport';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET -> whether generation is available to this user, and how much of their
 * monthly allowance is left.
 *
 * Read-only and free: it spends no credit and makes no AI call, so the UI can
 * render six buttons in their correct state (enabled, disabled with a reason,
 * or hidden entirely because the feature is switched off) without anyone paying
 * to discover that.
 *
 * This is a MIRROR of the server's decision, never a substitute for it. The
 * authoritative check is checkAndConsume inside the POST; if this endpoint said
 * "3 left" and the true answer were zero, the POST would still refuse. That is
 * the point of computing it separately rather than trusting a number the client
 * holds.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { userId, isAdmin } = await getRefmUserContext();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id: projectId } = await ctx.params;

  const { row: project, error: projErr } = await getProject(userId, projectId);
  if (projErr) return NextResponse.json({ error: projErr }, { status: 500 });
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Register first, so a fresh deployment reports the real toggle state rather
  // than "not registered" until someone happens to press Generate.
  await ensureAiFeature(IC_NARRATIVE_FEATURE);

  const gate = await resolveUserGate(userId, { sessionIsAdmin: isAdmin });
  const readOnly = writeBlockReason(gate);

  const feature = await getAiFeature(IC_NARRATIVE_FEATURE.featureId, IC_NARRATIVE_FEATURE.platformSlug);
  const planKey = await resolveUserPlanKey(userId);
  const cap = feature && planKey ? resolveAiCap(feature, planKey) : null;
  const periodStart = currentPeriodStart();
  const used = feature ? await readAiUsed(userId, feature.id, periodStart) : null;

  const enabled = !!feature?.enabled;
  const remaining = cap !== null && used !== null ? Math.max(0, cap - used) : null;

  // One reason string, resolved in the order the server would refuse in, so the
  // UI never has to reimplement that precedence.
  const blockedReason =
    !aiConfigured() ? 'AI is not configured on this deployment.'
    : !feature ? 'The IC narrative feature is not registered.'
    : !enabled ? 'IC narrative generation is switched off for this platform.'
    : readOnly ? (readOnly === 'LAPSED'
        ? 'Your subscription has lapsed. Renew your plan to generate drafts.'
        : 'Your subscription has expired. Access is read-only during the grace period.')
    : !planKey ? 'No plan could be resolved for this account.'
    : cap === null ? 'No monthly AI allowance is configured for your plan.'
    : remaining !== null && remaining <= 0 ? `You have used all ${cap} AI generations included in your plan this month.`
    : null;

  return NextResponse.json({
    available: blockedReason === null,
    blockedReason,
    enabled,
    configured: aiConfigured(),
    readOnly: readOnly ?? null,
    planKey,
    cap,
    used,
    remaining,
    periodStart,
    fields: IC_NARRATIVE_FIELD_KEYS.map((k) => ({
      field: k,
      label: IC_NARRATIVE_FIELDS[k].label,
      section: IC_NARRATIVE_FIELDS[k].section,
      targetField: String(IC_NARRATIVE_FIELDS[k].targetField),
    })),
  });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { userId, isAdmin } = await getRefmUserContext();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id: projectId } = await ctx.params;

  // Lapse gate first, before any project read or any spend. Generating a draft
  // that cannot be saved would burn a metered credit for nothing.
  const gate = await resolveUserGate(userId, { sessionIsAdmin: isAdmin });
  const writeBlock = writeBlockReason(gate);
  if (writeBlock) {
    return NextResponse.json({
      error: writeBlock === 'LAPSED'
        ? 'Your subscription has lapsed. Renew your plan to generate narrative drafts.'
        : 'Your subscription has expired. Access is read-only during the grace period, so drafts cannot be generated or saved.',
      code: writeBlock,
      accessExpiresAt: gate.accessExpiresAt,
      graceEndsAt: gate.graceEndsAt,
      planKey: gate.planKey,
    }, { status: 403 });
  }

  const { row: project, error: projErr } = await getProject(userId, projectId);
  if (projErr) return NextResponse.json({ error: projErr }, { status: 500 });
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json().catch(() => null) as {
    mode?: unknown;
    field?: unknown;
    instruction?: unknown;
    block?: unknown;
    model?: unknown;
    scale?: unknown;
    currency?: unknown;
    includeSeries?: unknown;
  } | null;
  if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 });

  const model = body.model as ICReportModel | undefined;
  if (!model || typeof model !== 'object' || !('headline' in model) || !('overview' in model)) {
    return NextResponse.json({ error: 'An assembled report model is required.' }, { status: 400 });
  }

  // FREE-FORM: any block, any instruction. Opted into by an explicit mode, so
  // the existing field-keyed contract is untouched and a client that knows
  // nothing about free-form behaves exactly as before.
  //
  // It is the SAME metered feature: same cap, same toggle, same allowance. A
  // free instruction is a different way to ask, not a second product.
  if (body.mode === 'freeform') {
    const block = body.block as Record<string, unknown> | undefined;
    if (!block || typeof block !== 'object' || typeof block.kind !== 'string' || !block.kind) {
      return NextResponse.json({ error: 'A selected block is required for a free-form draft.' }, { status: 400 });
    }
    const result = await generateIcFreeform({
      userId,
      instruction: typeof body.instruction === 'string' ? body.instruction : '',
      block: {
        kind: String(block.kind),
        slideTitle: typeof block.slideTitle === 'string' ? block.slideTitle : '',
        current: typeof block.current === 'string' ? block.current : '',
        ...(typeof block.name === 'string' && block.name ? { name: block.name } : {}),
      },
      model,
      scale: body.scale === 'thousands' ? 'thousands' : 'millions',
      currency: typeof body.currency === 'string' && body.currency ? body.currency : 'SAR',
      includeSeries: body.includeSeries === true,
      asOf: new Date().toISOString().slice(0, 10),
    });

    if (!result.ok) {
      return NextResponse.json({
        error: result.message,
        stage: result.stage,
        reason: result.reason,
        ...(result.stage === 'metering' ? { cap: result.cap, planKey: result.planKey } : {}),
        ...(result.stage === 'ai' ? { retryable: result.retryable } : {}),
        ...((result.stage === 'ai' || result.stage === 'empty') && result.refund ? { refund: result.refund } : {}),
      }, { status: result.status });
    }

    // A REFUSAL comes back 200 with `refused: true` and an EMPTY draft. It is a
    // real answer, not an error: the model was asked for something the figures
    // cannot support and said so, which is the outcome this feature wants. The
    // empty draft is what stops a client presenting it as text to apply.
    return NextResponse.json({
      applied: false,
      kind: 'freeform',
      label: result.label,
      instruction: result.instruction,
      draft: result.draft,
      refused: result.refused,
      ...(result.refusalReason ? { refusalReason: result.refusalReason } : {}),
      audit: result.audit,
      meter: result.meter,
      usage: result.usage,
      model: result.model,
      elapsedMs: result.elapsedMs,
    });
  }

  const field = coerceNarrativeFieldKey(body.field);
  if (!field) {
    return NextResponse.json({ error: 'field must be one of the IC narrative fields.' }, { status: 400 });
  }

  const result = await generateIcNarrative({
    userId,
    field,
    model,
    scale: body.scale === 'thousands' ? 'thousands' : 'millions',
    currency: typeof body.currency === 'string' && body.currency ? body.currency : 'SAR',
    includeSeries: body.includeSeries === true,
    asOf: new Date().toISOString().slice(0, 10),
  });

  if (!result.ok) {
    return NextResponse.json({
      error: result.message,
      stage: result.stage,
      reason: result.reason,
      ...(result.stage === 'metering' ? { cap: result.cap, planKey: result.planKey } : {}),
      ...(result.stage === 'ai' ? { retryable: result.retryable } : {}),
      // The refund report travels with the failure so the quota display can
      // show the RESTORED number instead of assuming either way.
      ...((result.stage === 'ai' || result.stage === 'empty') && result.refund ? { refund: result.refund } : {}),
    }, { status: result.status });
  }

  // The draft is returned, never stored. `applied: false` states that contract
  // in the payload itself, so a client cannot mistake this for a saved value.
  return NextResponse.json({
    applied: false,
    field: result.field,
    label: result.label,
    targetField: result.targetField,
    draft: result.draft,
    ...(result.risks ? { risks: result.risks } : {}),
    audit: result.audit,
    meter: result.meter,
    usage: result.usage,
    model: result.model,
    elapsedMs: result.elapsedMs,
  });
}
