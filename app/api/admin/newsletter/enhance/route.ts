import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { runAi } from '@/src/shared/ai/client';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if ((session?.user as { role?: string } | undefined)?.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { content } = await req.json() as { content: string };
    if (!content?.trim()) {
      return NextResponse.json({ error: 'No content to enhance' }, { status: 400 });
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
