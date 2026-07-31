import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { runAi } from '@/src/shared/ai/client';
import { checkAndConsume, meterDenyStatus } from '@/src/shared/ai/metering';
import { ensureAiFeature, NEWSLETTER_ENHANCE_FEATURE } from '@/src/shared/ai/features';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const user = session?.user as { role?: string; id?: string } | undefined;
  if (user?.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { content } = await req.json() as { content: string };
    if (!content?.trim()) {
      return NextResponse.json({ error: 'No content to enhance' }, { status: 400 });
    }

    // ── Metering ────────────────────────────────────────────────────────────
    // The cap comes from ai_feature_caps, the same rows /admin/ai-features
    // edits, so lowering a cap there changes what this route enforces on the
    // very next request. There is no cap value in this file.
    //
    // Admins are metered like everyone else. The entitlement gate bypasses
    // admins so support cannot be locked out; a cap is a spend control, and the
    // admin is the account most able to run up a bill.
    if (!user.id) {
      return NextResponse.json({ error: 'No user id on the session; cannot meter this request.' }, { status: 401 });
    }

    // Self-register so the feature exists to be capped and toggled. A failure
    // here is not fatal: metering denies an unregistered feature, so this fails
    // closed rather than opening the gate.
    await ensureAiFeature(NEWSLETTER_ENHANCE_FEATURE);

    const decision = await checkAndConsume({
      userId: user.id,
      featureId: NEWSLETTER_ENHANCE_FEATURE.featureId,
      platformSlug: NEWSLETTER_ENHANCE_FEATURE.platformSlug,
    });

    if (!decision.allowed) {
      console.warn('[newsletter-enhance] denied by metering:', { reason: decision.reason, cap: decision.cap, plan: decision.planKey });
      return NextResponse.json(
        { error: decision.message, reason: decision.reason, cap: decision.cap },
        { status: meterDenyStatus(decision.reason) },
      );
    }

    // Routed through the central AI client (Unit 1): the key, model, timeout,
    // retry policy, and error mapping all live there now. This route no longer
    // constructs an Anthropic client or reads the key from the environment.
    //
    // No `model` here on purpose. It used to pin claude-sonnet-4-20250514,
    // whose published retirement date has passed, so the call was returning a
    // 404 from the API and surfacing as "AI enhancement failed". Taking the
    // client default (DEFAULT_AI_MODEL, overridable with ANTHROPIC_MODEL) means
    // this route cannot be stranded on a retired model again: the next model
    // change is one line in models.ts and every feature follows.
    const result = await runAi({
      maxTokens: 2048,
      messages: [{
        role: 'user',
        content: `Rewrite this newsletter email HTML to be more engaging, professional, and concise. Keep all the key information and links. Use clean HTML formatting (h2, p, strong, a tags). Do not add subject lines or unsubscribe text - just the body content. Brand: Financial Modeler Pro - professional financial modeling training and tools platform.\n\nCurrent content:\n${content}\n\nReturn ONLY the enhanced HTML, no explanation.`,
      }],
    });

    if (!result.ok) {
      console.error('[newsletter-enhance] AI error:', { kind: result.kind, status: result.status, detail: result.message });
      return NextResponse.json(
        { error: result.kind === 'not_configured' ? 'AI not configured' : 'AI enhancement failed' },
        { status: 500 },
      );
    }

    return NextResponse.json({ enhanced: result.text || content });
  } catch (err) {
    console.error('[newsletter-enhance] AI error:', err);
    return NextResponse.json({ error: 'AI enhancement failed' }, { status: 500 });
  }
}
