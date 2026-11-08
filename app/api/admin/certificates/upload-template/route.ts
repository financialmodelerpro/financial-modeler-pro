/**
 * POST /api/admin/certificates/upload-template
 * Uploads a certificate template (PDF) or badge template (PNG) to Supabase storage.
 * Body: FormData - file, type ('3sfm-cert' | 'bvm-cert' | '3sfm-badge' | 'bvm-badge')
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';
import { getLiveCourseSettings, isLiveCourseRow } from '@/src/hubs/training/lib/liveCourse/courseSettings';

const TYPE_MAP: Record<string, { bucket: string; path: string; mime: string }> = {
  '3sfm-cert':  { bucket: 'certificates', path: 'templates/3sfm-template.pdf', mime: 'application/pdf' },
  'bvm-cert':   { bucket: 'certificates', path: 'templates/bvm-template.pdf',  mime: 'application/pdf' },
  '3sfm-badge': { bucket: 'badges',       path: 'templates/3sfm-badge.png',    mime: 'image/png'       },
  'bvm-badge':  { bucket: 'badges',       path: 'templates/bvm-badge.png',     mime: 'image/png'       },
  // The REFM live course (mig 247): the engine reads templates/<course>-template.pdf.
  'refm-cert':  { bucket: 'certificates', path: 'templates/refm-template.pdf', mime: 'application/pdf' },
  'refm-badge': { bucket: 'badges',       path: 'templates/refm-badge.png',    mime: 'image/png'       },
};

/**
 * The storage target for a template type: the fixed exam-course slots, or
 * `<code>-cert` / `<code>-badge` for any live course (the engine reads
 * templates/<code>-template.pdf and templates/<code>-badge.png).
 */
async function targetFor(type: string): Promise<{ bucket: string; path: string; mime: string } | null> {
  if (TYPE_MAP[type]) return TYPE_MAP[type];
  const m = /^([a-z0-9]{2,12})-(cert|badge)$/.exec(type);
  if (!m) return null;
  const live = await getLiveCourseSettings(getServerClient(), m[1]);
  if (!isLiveCourseRow(live)) return null;
  return m[2] === 'cert'
    ? { bucket: 'certificates', path: `templates/${m[1]}-template.pdf`, mime: 'application/pdf' }
    : { bucket: 'badges', path: `templates/${m[1]}-badge.png`, mime: 'image/png' };
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as { role?: string }).role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const form = await req.formData();
    const file = form.get('file') as File | null;
    const type = form.get('type') as string | null;

    if (!file || !type) {
      return NextResponse.json({ error: 'file and type are required' }, { status: 400 });
    }

    const target = await targetFor(type);
    if (!target) {
      return NextResponse.json({ error: `Unknown type: ${type}` }, { status: 400 });
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const sb    = getServerClient();

    const { error } = await sb.storage
      .from(target.bucket)
      .upload(target.path, bytes, {
        contentType: target.mime,
        upsert: true,
      });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const { data: { publicUrl } } = sb.storage.from(target.bucket).getPublicUrl(target.path);
    return NextResponse.json({ success: true, url: publicUrl });
  } catch (e) {
    console.error('[upload-template]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as { role?: string }).role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const { type } = (await req.json()) as { type?: string };
    if (!type) return NextResponse.json({ error: 'type is required' }, { status: 400 });

    const target = await targetFor(type);
    if (!target) return NextResponse.json({ error: `Unknown type: ${type}` }, { status: 400 });

    const sb = getServerClient();
    const { error } = await sb.storage.from(target.bucket).remove([target.path]);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('[delete-template]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
