import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/core/db/supabase';
import { adminEmail } from '@/src/hubs/training/lib/liveCourse/adminGuard';
import { getLiveCourseSettings, isLiveCourseRow } from '@/src/hubs/training/lib/liveCourse/courseSettings';
import { STORAGE_CACHE_REPLACEABLE } from '@/src/shared/storage/cacheControl';
import { invalidateLiveCourseCache } from '@/src/hubs/training/lib/liveCourse/cachedReads';

export const dynamic = 'force-dynamic';

const KINDS = { banner: { url: 'banner_url', alt: 'banner_alt' }, card: { url: 'card_image_url', alt: 'card_image_alt' } } as const;
const TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_BYTES = 5 * 1024 * 1024;

/**
 * POST /api/admin/live-course/[code]/image   FormData: kind (banner | card), file, alt
 * Stores the image in the public `live-session-banners` bucket (the bucket the
 * session banners already use) under courses/<code>/, with a timestamp in the
 * name so a replacement is never served from a stale cache.
 * DELETE ?kind=banner|card clears it.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  if (!await adminEmail()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { code } = await params;
  const sb = getServerClient();
  const course = await getLiveCourseSettings(sb, code);
  if (!isLiveCourseRow(course)) return NextResponse.json({ error: 'Not a live course' }, { status: 404 });

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: 'Invalid form data' }, { status: 400 });
  const kind = String(form.get('kind') ?? '') as keyof typeof KINDS;
  if (!KINDS[kind]) return NextResponse.json({ error: 'kind must be banner or card' }, { status: 400 });
  const alt = String(form.get('alt') ?? '').trim().slice(0, 300);
  const file = form.get('file');

  const update: Record<string, unknown> = { [KINDS[kind].alt]: alt || null, updated_at: new Date().toISOString() };
  if (file instanceof File && file.size > 0) {
    if (!TYPES.has(file.type)) return NextResponse.json({ error: 'Use a JPG, PNG or WebP image.' }, { status: 400 });
    if (file.size > MAX_BYTES) return NextResponse.json({ error: 'The image must be 5 MB or smaller.' }, { status: 400 });
    const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
    const path = `courses/${course.courseCode}/${kind}-${Date.now()}.${ext}`;
    const { error: upErr } = await sb.storage.from('live-session-banners')
      .upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: true, cacheControl: STORAGE_CACHE_REPLACEABLE });
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
    update[KINDS[kind].url] = sb.storage.from('live-session-banners').getPublicUrl(path).data.publicUrl;
  }
  const { error } = await sb.from('training_course_settings').update(update).eq('course_code', course.courseCode);
  if (error) return NextResponse.json({ error: `${error.message}${/does not exist|schema cache/i.test(error.message) ? ' (apply migration 249)' : ''}` }, { status: 500 });
  invalidateLiveCourseCache();
  return NextResponse.json({ ok: true, url: update[KINDS[kind].url] ?? null });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  if (!await adminEmail()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { code } = await params;
  const kind = (req.nextUrl.searchParams.get('kind') ?? '') as keyof typeof KINDS;
  if (!KINDS[kind]) return NextResponse.json({ error: 'kind must be banner or card' }, { status: 400 });
  const sb = getServerClient();
  const { error } = await sb.from('training_course_settings')
    .update({ [KINDS[kind].url]: null, [KINDS[kind].alt]: null }).eq('course_code', code.toUpperCase());
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  invalidateLiveCourseCache();
  return NextResponse.json({ ok: true });
}
