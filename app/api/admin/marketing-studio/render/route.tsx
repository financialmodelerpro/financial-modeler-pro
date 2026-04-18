import { NextRequest, NextResponse } from 'next/server';
import { ImageResponse } from 'next/og';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/shared/auth';
import { loadOgFonts } from '@/src/lib/shared/ogFonts';
import { getTemplate } from '@/src/lib/marketing/templates';
import { loadBrandKit } from '@/src/lib/marketing/brandKit';
import { imageToDataUri } from '@/src/lib/marketing/imageToDataUri';

export const runtime = 'nodejs';

/**
 * POST /api/admin/marketing-studio/render
 * body: { template_type: string; content: Record<string,string> }
 * Returns: PNG image (ImageResponse)
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if ((session?.user as { role?: string } | undefined)?.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { template_type?: string; content?: Record<string, string> };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const templateId = body.template_type || '';
  const template = getTemplate(templateId);
  if (!template) return NextResponse.json({ error: `Unknown template: ${templateId}` }, { status: 400 });

  const data: Record<string, string> = { ...template.defaults, ...(body.content || {}) };

  const [brandKit, fonts] = await Promise.all([
    loadBrandKit().catch(() => null),
    loadOgFonts().catch(() => []),
  ]);
  if (!brandKit) return NextResponse.json({ error: 'Failed to load brand kit' }, { status: 500 });

  const [logoDataUri, photoDataUri] = await Promise.all([
    imageToDataUri(brandKit.logo_url).catch(() => ''),
    imageToDataUri(brandKit.founder_photo_url).catch(() => ''),
  ]);

  try {
    return new ImageResponse(
      template.render(data, brandKit, logoDataUri || undefined, photoDataUri || undefined),
      { width: template.dimensions.width, height: template.dimensions.height, fonts },
    );
  } catch (err) {
    console.error('[marketing-studio/render] error:', err);
    return NextResponse.json({ error: 'Render failed' }, { status: 500 });
  }
}
