import { ImageResponse } from 'next/og';
import { NextResponse, type NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/shared/auth';
import { loadBrandPack } from '@/src/lib/marketing-studio/brand';
import { fetchAsBase64 } from '@/src/lib/marketing-studio/image-utils';
import { loadOgFonts } from '@/src/lib/shared/ogFonts';
import { DIMENSIONS, type RenderRequest } from '@/src/lib/marketing-studio/types';
import { LinkedInProfileTemplate, LinkedInPostTemplate, LinkedInQuoteTemplate } from '@/src/lib/marketing-studio/templates/linkedin-banner';
import { LiveSessionTemplate } from '@/src/lib/marketing-studio/templates/live-session';
import { YouTubeThumbnailTemplate } from '@/src/lib/marketing-studio/templates/youtube-thumbnail';
import { ArticleBannerTemplate } from '@/src/lib/marketing-studio/templates/article-banner';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if ((session?.user as { role?: string } | undefined)?.role !== 'admin') {
    return NextResponse.json({ error: 'Admin only' }, { status: 401 });
  }

  let payload: RenderRequest;
  try {
    payload = await req.json() as RenderRequest;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const dims = DIMENSIONS[payload.content.template];
  if (!dims) {
    return NextResponse.json({ error: `Unknown template: ${payload.content.template}` }, { status: 400 });
  }

  const [brand, fonts] = await Promise.all([loadBrandPack(), loadOgFonts().catch(() => [])]);

  const [logoDataUri, trainerPhotoDataUri, backgroundDataUri] = await Promise.all([
    fetchAsBase64(brand.logoUrl),
    fetchAsBase64(brand.trainer.photoUrl),
    fetchAsBase64(payload.content.backgroundUrl ?? ''),
  ]);

  const args = { brand, logoDataUri, trainerPhotoDataUri, backgroundDataUri };

  let element: React.ReactElement;
  switch (payload.type) {
    case 'linkedin-banner': {
      const t = payload.content.template;
      if (t === 'profile-1584') element = LinkedInProfileTemplate({ ...args, content: payload.content });
      else if (t === 'post-1200') element = LinkedInPostTemplate({ ...args, content: payload.content });
      else if (t === 'quote-1200') element = LinkedInQuoteTemplate({ ...args, content: payload.content });
      else return NextResponse.json({ error: `Unknown linkedin template: ${t}` }, { status: 400 });
      break;
    }
    case 'live-session':
      element = LiveSessionTemplate({ ...args, content: payload.content });
      break;
    case 'youtube-thumbnail':
      element = YouTubeThumbnailTemplate({ ...args, content: payload.content });
      break;
    case 'article-banner':
      element = ArticleBannerTemplate({ ...args, content: payload.content });
      break;
    default:
      return NextResponse.json({ error: 'Unknown asset type' }, { status: 400 });
  }

  return new ImageResponse(element, { width: dims.width, height: dims.height, fonts });
}
