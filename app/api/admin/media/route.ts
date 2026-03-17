import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { getServerClient } from '@/src/lib/supabase';

/* ── GET /api/admin/media?bucket=cms-assets ─── */
export async function GET(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if ((session.user as { role?: string }).role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const bucket = req.nextUrl.searchParams.get('bucket') ?? 'cms-assets';
  const sb = getServerClient();

  const { data, error } = await sb.storage.from(bucket).list('', {
    limit: 200,
    sortBy: { column: 'created_at', order: 'desc' },
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // Build public URLs for each file
  const files = (data ?? [])
    .filter((f) => f.name !== '.emptyFolderPlaceholder')
    .map((f) => {
      const { data: urlData } = sb.storage.from(bucket).getPublicUrl(f.name);
      return {
        name:       f.name,
        size:       f.metadata?.size ?? 0,
        mimetype:   f.metadata?.mimetype ?? '',
        created_at: f.created_at,
        url:        urlData.publicUrl,
        bucket,
      };
    });

  return NextResponse.json({ files });
}

/* ── DELETE /api/admin/media ─── body: { bucket, name } */
export async function DELETE(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if ((session.user as { role?: string }).role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { bucket, name } = await req.json();
  if (!bucket || !name) return NextResponse.json({ error: 'bucket and name required' }, { status: 400 });

  const sb = getServerClient();
  const { error } = await sb.storage.from(bucket).remove([name]);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true });
}

/* ── POST /api/admin/media — multipart upload ─── */
export async function POST(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if ((session.user as { role?: string }).role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const form = await req.formData();
  const file   = form.get('file')   as File | null;
  const bucket = (form.get('bucket') as string | null) ?? 'cms-assets';

  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });

  const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'File too large (max 10 MB)' }, { status: 413 });
  }

  const ALLOWED = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml', 'application/pdf'];
  if (!ALLOWED.includes(file.type)) {
    return NextResponse.json({ error: 'File type not allowed' }, { status: 415 });
  }

  // Unique filename: timestamp + original name
  const timestamp = Date.now();
  const safeName  = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path      = `${timestamp}_${safeName}`;

  const buffer = Buffer.from(await file.arrayBuffer());
  const sb = getServerClient();

  const { error } = await sb.storage
    .from(bucket)
    .upload(path, buffer, { contentType: file.type, upsert: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const { data: urlData } = sb.storage.from(bucket).getPublicUrl(path);
  return NextResponse.json({ url: urlData.publicUrl, name: path, bucket });
}
