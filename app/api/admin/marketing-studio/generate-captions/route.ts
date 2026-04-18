import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/shared/auth';
import Anthropic from '@anthropic-ai/sdk';
import type { CanvasElement } from '@/src/lib/marketing/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

export type CaptionPlatform = 'linkedin' | 'instagram' | 'facebook' | 'whatsapp' | 'twitter' | 'youtube';
export type CaptionTone = 'professional' | 'casual' | 'thought-leader' | 'educational';

const PLATFORM_PROMPTS: Record<CaptionPlatform, string> = {
  linkedin: `Write a LinkedIn post caption.
- 150-200 words
- Professional tone
- Start with a hook question or bold statement
- Use short paragraphs (2-3 lines each) separated by blank lines
- Include 3-5 relevant hashtags at the end
- End with a question/CTA to drive engagement`,

  instagram: `Write an Instagram caption.
- 80-120 words of body copy
- Casual but professional tone
- Start with an attention-grabbing first line
- Use line breaks for readability
- End with 15-20 relevant niche hashtags on separate lines at the bottom`,

  facebook: `Write a Facebook post.
- 80-120 words
- Conversational and engaging
- Start with a question or bold statement
- End with a clear CTA`,

  whatsapp: `Write a WhatsApp broadcast/status message.
- 30-60 words max
- Direct and concise
- Include a clear CTA or URL placeholder
- No hashtags, no emojis at line starts`,

  twitter: `Write a single Twitter/X post.
- 250-280 characters max (total, hashtags included)
- Punchy and direct
- Hook in the first line
- Include 1-2 relevant hashtags`,

  youtube: `Write a YouTube video description.
- 200-300 words
- First 100 characters are critical (shown in search) — front-load the keyword
- After the hook: 1 short paragraph summary
- Then 4-6 bullet "What you'll learn" items
- 5-10 relevant hashtags at the end
- Leave a "TIMESTAMPS:" placeholder line for the user to fill in`,
};

const TONE_MODIFIERS: Record<CaptionTone, string> = {
  professional: 'Keep the tone strictly professional and credible — like a senior practitioner writing to peers.',
  casual:       'Keep the tone warm and conversational — like talking to a friend over coffee. Light humor is fine.',
  'thought-leader': 'Take a strong point of view. Name the contrarian insight. Be confident, not hedging.',
  educational:  'Lean into teaching. Break concepts down step by step. Assume the reader is a motivated learner.',
};

interface Body {
  template_type?: string;
  elements?: CanvasElement[];
  platforms?: CaptionPlatform[];
  tone?: CaptionTone;
}

/** POST /api/admin/marketing-studio/generate-captions — parallel multi-platform */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if ((session?.user as { role?: string } | undefined)?.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: Body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const platforms = (body.platforms ?? ['linkedin', 'instagram', 'facebook']) as CaptionPlatform[];
  const invalid = platforms.filter(p => !PLATFORM_PROMPTS[p]);
  if (invalid.length) return NextResponse.json({ error: `Unsupported platforms: ${invalid.join(', ')}` }, { status: 400 });

  const tone: CaptionTone = body.tone && TONE_MODIFIERS[body.tone] ? body.tone : 'professional';

  // Pull text content from canvas in reading order (top → bottom, left → right)
  const texts = (body.elements ?? [])
    .filter((el): el is CanvasElement & { text: NonNullable<CanvasElement['text']> } => el.type === 'text' && !!el.text)
    .sort((a, b) => (a.y - b.y) || (a.x - b.x))
    .map(el => el.text.content.trim())
    .filter(Boolean);

  if (texts.length === 0) {
    return NextResponse.json({ error: 'Add at least one text element to generate captions' }, { status: 400 });
  }

  const [headline, ...rest] = texts;
  const context = rest.join('\n');
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'AI not configured' }, { status: 500 });
  const client = new Anthropic({ apiKey });

  async function generateOne(platform: CaptionPlatform): Promise<string> {
    try {
      const msg = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1800,
        messages: [{
          role: 'user',
          content: `You are writing social copy for Financial Modeler Pro — a professional financial modeling training and tools brand. The visual asset has this text content:\n\nHeadline: ${headline}\n${context ? `Supporting text:\n${context}\n` : ''}\nTemplate: ${body.template_type || 'custom'}\nTone directive: ${TONE_MODIFIERS[tone]}\n\nTask: ${PLATFORM_PROMPTS[platform]}\n\nReturn ONLY the caption text, no preamble, no surrounding quotes.`,
        }],
      });
      return msg.content[0]?.type === 'text' ? msg.content[0].text.trim() : '';
    } catch (err) {
      console.error(`[generate-captions] ${platform} failed:`, err);
      return '';
    }
  }

  // All platforms run in parallel
  const results = await Promise.all(platforms.map(p => generateOne(p).then(caption => [p, caption] as const)));
  const captions: Partial<Record<CaptionPlatform, string>> = {};
  for (const [p, c] of results) captions[p] = c;

  return NextResponse.json({ captions, tone });
}
