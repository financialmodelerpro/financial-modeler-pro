import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/core/db/supabase';
import { getTrainingCookieSession } from '@/src/hubs/training/lib/session/trainingSessionCookie';
import { STORAGE_CACHE_IMMUTABLE } from '@/src/shared/storage/cacheControl';

const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const MAX_BYTES = 2 * 1024 * 1024; // 2 MB

export async function POST(req: NextRequest) {
  // Only a signed-in student may upload, and the file is named for THEM (2026-09-26:
  // anyone could upload, named for any regId or "anon").
  const sess = await getTrainingCookieSession();
  if (!sess) return NextResponse.json({ error: 'Please sign in again.' }, { status: 401 });
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const regId = sess.registrationId;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }
    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json({ error: 'Invalid file type. Use JPG, PNG, or WebP.' }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: 'File too large. Maximum size is 2 MB.' }, { status: 400 });
    }

    const sb = getServerClient();
    const ext = file.type === 'image/jpeg' || file.type === 'image/jpg' ? 'jpg'
      : file.type === 'image/png' ? 'png' : 'webp';
    const filename = `${regId}_${Date.now()}.${ext}`;
    const buffer = Buffer.from(await file.arrayBuffer());

    // Try upload; if bucket missing, create it then retry
    const { error: uploadErr } = await sb.storage
      .from('avatars')
      // filename carries Date.now(), so a replaced avatar is a new URL.
      .upload(filename, buffer, { contentType: file.type, upsert: true, cacheControl: STORAGE_CACHE_IMMUTABLE });

    if (uploadErr) {
      if (uploadErr.message.toLowerCase().includes('bucket') || uploadErr.message.toLowerCase().includes('not found')) {
        await sb.storage.createBucket('avatars', { public: true });
        const { error: retryErr } = await sb.storage
          .from('avatars')
          .upload(filename, buffer, { contentType: file.type, upsert: true, cacheControl: STORAGE_CACHE_IMMUTABLE });
        if (retryErr) return NextResponse.json({ error: retryErr.message }, { status: 500 });
      } else {
        return NextResponse.json({ error: uploadErr.message }, { status: 500 });
      }
    }

    const { data } = sb.storage.from('avatars').getPublicUrl(filename);
    return NextResponse.json({ url: data.publicUrl });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Upload failed' }, { status: 500 });
  }
}
