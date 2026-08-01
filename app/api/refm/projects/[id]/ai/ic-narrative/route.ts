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
import { generateIcNarrative } from '@/src/hubs/modeling/platforms/refm/lib/ai/icNarrativeService';
import { coerceNarrativeFieldKey } from '@/src/hubs/modeling/platforms/refm/lib/ai/icNarrative';
import type { ICReportModel } from '@/src/hubs/modeling/platforms/refm/lib/reports/icReport';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
    field?: unknown;
    model?: unknown;
    scale?: unknown;
    currency?: unknown;
    includeSeries?: unknown;
  } | null;
  if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 });

  const field = coerceNarrativeFieldKey(body.field);
  if (!field) {
    return NextResponse.json({ error: 'field must be one of the IC narrative fields.' }, { status: 400 });
  }

  const model = body.model as ICReportModel | undefined;
  if (!model || typeof model !== 'object' || !('headline' in model) || !('overview' in model)) {
    return NextResponse.json({ error: 'An assembled report model is required.' }, { status: 400 });
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
