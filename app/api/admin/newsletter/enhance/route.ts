import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import Anthropic from '@anthropic-ai/sdk';

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

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'AI not configured' }, { status: 500 });
    }

    const client = new Anthropic({ apiKey });
    const msg = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      messages: [{
        role: 'user',
        content: `Rewrite this newsletter email HTML to be more engaging, professional, and concise. Keep all the key information and links. Use clean HTML formatting (h2, p, strong, a tags). Do not add subject lines or unsubscribe text - just the body content. Brand: Financial Modeler Pro - professional financial modeling training and tools platform.\n\nCurrent content:\n${content}\n\nReturn ONLY the enhanced HTML, no explanation.`,
      }],
    });

    const enhanced = msg.content[0].type === 'text' ? msg.content[0].text : content;
    return NextResponse.json({ enhanced });
  } catch (err) {
    console.error('[newsletter-enhance] AI error:', err);
    return NextResponse.json({ error: 'AI enhancement failed' }, { status: 500 });
  }
}
