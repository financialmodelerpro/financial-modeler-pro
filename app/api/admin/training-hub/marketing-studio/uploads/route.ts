import { NextResponse, type NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/shared/auth';
import { getServerClient } from '@/src/lib/shared/supabase';
import sharp from 'sharp';

export const runtime = 'nodejs';

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp']);

interface AssetRow {
  id: string;
  name: string;
  storage_path: string;
  url: string;
  mime_type: string;
  file_size: number;
  width: number | null;
  height: number | null;
  created_at: string;
}

function rowToDto(r: AssetRow) {
  return {
    id: r.id,
    name: r.name,
    url: r.url,
    mimeType: r.mime_type,
    fileSize: r.file_size,
    width: r.width,
    height: r.height,
    createdAt: r.created_at,
  };
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if ((session?.user as { role?: string } | undefined)?.role !== 'admin') {
    return NextResponse.json({ error: 'Admin only' }, { status: 401 });
  }

  const sb = getServerClient();
  const { data, error } = await sb
    .from('marketing_uploaded_assets')
    .select('id, name, storage_path, url, mime_type, file_size, width, height, created_at')
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ assets: ((data ?? []) as AssetRow[]).map(rowToDto) });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if ((session?.user as { role?: string } | undefined)?.role !== 'admin') {
    return NextResponse.json({ error: 'Admin only' }, { status: 401 });
  }

  const form = await req.formData();
  const file = form.get('file');
  const nameRaw = form.get('name');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
  }
  if (!ALLOWED_MIME.has(file.type)) {
    return NextResponse.json({ error: `Unsupported type: ${file.type}` }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: `File exceeds ${MAX_BYTES / 1024 / 1024} MB` }, { status: 400 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  let width: number | null = null;
  let height: number | null = null;
  try {
    const meta = await sharp(buf).metadata();
    width = meta.width ?? null;
    height = meta.height ?? null;
  } catch { /* leave null */ }

  const ext = file.name.includes('.') ? file.name.split('.').pop() : (file.type.split('/')[1] ?? 'png');
  const slug = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}.${ext}`;
  const storagePath = `bg/${slug}`;
  const sb = getServerClient();

  const { error: upErr } = await sb.storage
    .from('marketing-assets')
    .upload(storagePath, buf, { contentType: file.type, upsert: false, cacheControl: '31536000' });
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  const { data: pub } = sb.storage.from('marketing-assets').getPublicUrl(storagePath);
  const url = pub.publicUrl;

  const adminEmail = (session?.user as { email?: string } | undefined)?.email ?? null;
  const displayName = (typeof nameRaw === 'string' && nameRaw.trim()) || file.name || 'Untitled';

  const { data: row, error: insErr } = await sb
    .from('marketing_uploaded_assets')
    .insert({
      name: displayName,
      storage_path: storagePath,
      url,
      mime_type: file.type,
      file_size: file.size,
      width,
      height,
      uploaded_by: adminEmail,
    })
    .select('id, name, storage_path, url, mime_type, file_size, width, height, created_at')
    .single();

  if (insErr || !row) {
    // Roll back the storage upload so we don't leak orphaned files.
    await sb.storage.from('marketing-assets').remove([storagePath]).catch(() => {});
    return NextResponse.json({ error: insErr?.message ?? 'Insert failed' }, { status: 500 });
  }

  return NextResponse.json({ asset: rowToDto(row as AssetRow) });
}
