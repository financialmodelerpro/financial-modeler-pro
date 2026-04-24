import { ImageResponse } from 'next/og';
import { NextResponse, type NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/shared/auth';
import { loadBrandPack, loadInstructorsByIds } from '@/src/lib/marketing-studio/brand';
import { fetchAsBase64 } from '@/src/lib/marketing-studio/image-utils';
import { loadOgFonts } from '@/src/lib/shared/ogFonts';
import { DIMENSIONS, resolveInstructors, type RenderRequest, type Instructor } from '@/src/lib/marketing-studio/types';
import { LinkedInProfileTemplate, LinkedInPostTemplate, LinkedInQuoteTemplate } from '@/src/lib/marketing-studio/templates/linkedin-banner';
import { LiveSessionTemplate } from '@/src/lib/marketing-studio/templates/live-session';
import { YouTubeThumbnailTemplate } from '@/src/lib/marketing-studio/templates/youtube-thumbnail';
import { ArticleBannerTemplate } from '@/src/lib/marketing-studio/templates/article-banner';

export const runtime = 'nodejs';

async function loadInstructorPhotos(instructors: Instructor[]): Promise<Record<string, string>> {
  const entries = await Promise.all(
    instructors.map(async ins => [ins.id, await fetchAsBase64(ins.photoUrl)] as const),
  );
  const out: Record<string, string> = {};
  for (const [id, dataUri] of entries) out[id] = dataUri;
  return out;
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if ((session?.user as { role?: string } | undefined)?.role !== 'admin') {
    return NextResponse.json({ error: 'Admin only' }, { status: 401 });
  }

  let payload: RenderRequest;
  try { payload = await req.json() as RenderRequest; }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const dims = DIMENSIONS[payload.content.template];
  if (!dims) return NextResponse.json({ error: `Unknown template: ${payload.content.template}` }, { status: 400 });

  const [brand, fonts, pickedInstructors] = await Promise.all([
    loadBrandPack(),
    loadOgFonts().catch(() => []),
    loadInstructorsByIds(payload.content.instructorIds ?? []),
  ]);

  const instructors = resolveInstructors(brand, pickedInstructors);

  const [logoDataUri, instructorPhotos, backgroundDataUri] = await Promise.all([
    fetchAsBase64(brand.logoUrl),
    loadInstructorPhotos(instructors),
    fetchAsBase64(payload.content.backgroundUrl ?? ''),
  ]);

  const args = { brand, instructors, logoDataUri, instructorPhotos, backgroundDataUri };

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
