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

    // Routed through the central AI client (Unit 1): the key, timeout, retry
    // policy, and error mapping all live there now. This route no longer
    // constructs an Anthropic client or reads the key from the environment.
    //
    // Behaviour preserved exactly: same prompt, same max_tokens, same model
    // string, same 'AI not configured' 500 on a missing key, same fallback to
    // the original content when no text block comes back. The model is pinned
    // here rather than taking the client default because this is a refactor;
    // see the Unit 1 report for why that pin needs a separate decision.
    const result = await runAi({
      model: 'claude-sonnet-4-20250514',
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
