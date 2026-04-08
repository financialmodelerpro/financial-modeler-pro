import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/shared/auth';
import { getServerClient } from '@/src/lib/shared/supabase';

async function checkAdmin() {
  const session = await getServerSession(authOptions);
  return !!(session?.user && (session.user as { role?: string }).role === 'admin');
}

/**
 * GET /api/admin/attachments?tabKey=3SFM_S1
 * Returns ALL attachments (including hidden) for admin view.
 */
export async function GET(req: NextRequest) {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const tabKey = req.nextUrl.searchParams.get('tabKey');
  const course = req.nextUrl.searchParams.get('course');

  const sb = getServerClient();
  let query = sb.from('course_attachments').select('*').order('uploaded_at', { ascending: false });

  if (tabKey) query = query.eq('tab_key', tabKey);
  else if (course) query = query.eq('course', course.toLowerCase());

  const { data } = await query;
  return NextResponse.json({ attachments: data ?? [] });
}

/**
 * POST /api/admin/attachments — upload a file
 * Body: FormData with file, tabKey, course
 */
export async function POST(req: NextRequest) {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const form    = await req.formData();
    const file    = form.get('file') as File | null;
    const tabKey  = (form.get('tabKey') as string ?? '').trim();
    const course  = (form.get('course') as string ?? '').trim().toLowerCase();

    if (!file || !tabKey || !course) {
      return NextResponse.json({ error: 'file, tabKey, and course required' }, { status: 400 });
    }

    const sb = getServerClient();

    // Upload to Supabase Storage
    const ext      = file.name.split('.').pop()?.toLowerCase() ?? '';
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path     = `${course}/${tabKey}/${Date.now()}_${safeName}`;

    const bytes = Buffer.from(await file.arrayBuffer());
    const { error: uploadError } = await sb.storage
      .from('course-materials')
      .upload(path, bytes, { contentType: file.type, upsert: false });

    if (uploadError) {
      return NextResponse.json({ error: `Upload failed: ${uploadError.message}` }, { status: 500 });
    }

    const { data: { publicUrl } } = sb.storage.from('course-materials').getPublicUrl(path);

    // Save metadata
    const { data: row, error: dbError } = await sb
      .from('course_attachments')
      .insert({
        tab_key:   tabKey,
        course,
        file_name: file.name,
        file_url:  publicUrl,
        file_type: ext,
        file_size: file.size,
      })
      .select()
      .single();

    if (dbError) {
      return NextResponse.json({ error: dbError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, attachment: row });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/**
 * PATCH /api/admin/attachments — toggle visibility
 * Body: { id, is_visible }
 */
export async function PATCH(req: NextRequest) {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json() as { id?: string; is_visible?: boolean };
  if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const sb = getServerClient();
  const { error } = await sb
    .from('course_attachments')
    .update({ is_visible: body.is_visible ?? true })
    .eq('id', body.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

/**
 * DELETE /api/admin/attachments — delete attachment
 * Body: { id }
 */
export async function DELETE(req: NextRequest) {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json() as { id?: string };
  if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const sb = getServerClient();

  // Get file URL to delete from storage
  const { data: row } = await sb
    .from('course_attachments')
    .select('file_url')
    .eq('id', body.id)
    .maybeSingle();

  // Delete DB record
  const { error } = await sb.from('course_attachments').delete().eq('id', body.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Best-effort delete from storage
  if (row?.file_url) {
    try {
      const urlPath = new URL(row.file_url).pathname;
      const storagePath = urlPath.split('/course-materials/')[1];
      if (storagePath) {
        await sb.storage.from('course-materials').remove([decodeURIComponent(storagePath)]);
      }
    } catch { /* non-fatal */ }
  }

  return NextResponse.json({ ok: true });
}
