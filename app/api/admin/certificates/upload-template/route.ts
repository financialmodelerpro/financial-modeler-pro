/**
 * POST /api/admin/certificates/upload-template
 * Uploads a certificate template (PDF) or badge template (PNG) to Supabase storage.
 * Body: FormData - file, type ('3sfm-cert' | 'bvm-cert' | '3sfm-badge' | 'bvm-badge')
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/shared/auth';
import { getServerClient } from '@/src/lib/shared/supabase';

const TYPE_MAP: Record<string, { bucket: string; path: string; mime: string }> = {
  '3sfm-cert':  { bucket: 'certificates', path: 'templates/3sfm-template.pdf', mime: 'application/pdf' },
  'bvm-cert':   { bucket: 'certificates', path: 'templates/bvm-template.pdf',  mime: 'application/pdf' },
  '3sfm-badge': { bucket: 'badges',       path: 'templates/3sfm-badge.png',    mime: 'image/png'       },
  'bvm-badge':  { bucket: 'badges',       path: 'templates/bvm-badge.png',     mime: 'image/png'       },
};

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

    const target = TYPE_MAP[type];
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

    const target = TYPE_MAP[type];
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
