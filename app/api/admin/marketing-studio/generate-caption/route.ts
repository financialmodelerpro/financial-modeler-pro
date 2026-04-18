import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/shared/auth';
import Anthropic from '@anthropic-ai/sdk';
import type { CanvasElement } from '@/src/lib/marketing/types';

export const runtime = 'nodejs';

type Platform = 'youtube' | 'linkedin' | 'instagram' | 'twitter';

const PLATFORM_GUIDE: Record<Platform, string> = {
  youtube:
    'Write a YouTube video description. Start with a 1-sentence hook. Then 2-3 short paragraphs explaining what viewers will learn. Include 3-5 relevant hashtags at the end. Keep it under 300 words. No emojis at the start of lines.',
  linkedin:
    'Write a LinkedIn post. Start with a strong hook line (1 short sentence). Then 3-5 short paragraphs (1-2 lines each, with blank lines between). Professional but conversational tone. End with a question to drive comments. Include 3-5 relevant hashtags on the last line. Under 1200 characters.',
  instagram:
    'Write an Instagram caption. Start with a 1-line hook. Then 2-3 short paragraphs with visual line breaks. Light emoji use is fine. End with a call-to-action. Add 15-20 niche hashtags on a separate last line. Under 2000 characters.',
  twitter:
    'Write a Twitter/X thread-opener (tweet 1 of a short thread). Hook in the first line under 240 chars. Second line previews the thread. End with "A thread ↓". Under 280 characters total.',
};

/**
 * POST /api/admin/marketing-studio/generate-caption
 * body: { template_type, elements, platform } — uses text content from canvas elements.
 * Returns: { caption: string }
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if ((session?.user as { role?: string } | undefined)?.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { template_type?: string; elements?: CanvasElement[]; platform?: Platform };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const platform = (body.platform || 'linkedin') as Platform;
  if (!PLATFORM_GUIDE[platform]) return NextResponse.json({ error: `Unsupported platform: ${platform}` }, { status: 400 });

  // Extract all text content from the canvas, sorted by reading order (top → bottom, left → right).
  const texts = (body.elements ?? [])
    .filter((el): el is CanvasElement & { text: NonNullable<CanvasElement['text']> } => el.type === 'text' && !!el.text)
    .sort((a, b) => (a.y - b.y) || (a.x - b.x))
    .map(el => el.text.content.trim())
    .filter(Boolean);

  if (texts.length === 0) {
    return NextResponse.json({ error: 'Add at least one text element to generate a caption' }, { status: 400 });
  }

  const [headline, ...rest] = texts;
  const context = rest.join('\n');

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'AI not configured' }, { status: 500 });

  try {
    const client = new Anthropic({ apiKey });
    const msg = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      messages: [{
        role: 'user',
        content: `You are writing social copy for Financial Modeler Pro — a professional financial modeling training and tools brand. The visual asset has this text content:\n\nHeadline: ${headline}\n${context ? `Supporting text:\n${context}\n` : ''}\nTemplate: ${body.template_type || 'custom'}\n\nTask: ${PLATFORM_GUIDE[platform]}\n\nReturn ONLY the caption text, no explanation, no surrounding quotes.`,
      }],
    });

    const caption = msg.content[0].type === 'text' ? msg.content[0].text.trim() : '';
    if (!caption) return NextResponse.json({ error: 'No caption generated' }, { status: 500 });

    return NextResponse.json({ caption, platform });
  } catch (err) {
    console.error('[marketing-studio/generate-caption] error:', err);
    return NextResponse.json({ error: 'Caption generation failed' }, { status: 500 });
  }
}
