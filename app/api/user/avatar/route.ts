/**
 * /api/user/avatar
 * POST - upload the signed-in user's profile image to the 'avatars' storage
 *        bucket and persist the public URL on users.avatar_url.
 *
 * Authenticated (NextAuth session). Mirrors the existing training upload-avatar
 * pattern (public bucket, created on demand) but scoped to the current user and
 * writes the reference onto the user record. No em dashes in this file.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';

const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const MAX_BYTES = 2 * 1024 * 1024; // 2 MB

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;

    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json({ error: 'Invalid file type. Use JPG, PNG, or WebP.' }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: 'File too large. Maximum size is 2 MB.' }, { status: 400 });
    }

    const sb = getServerClient();
    const userId = session.user.id;
    const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
    const filename = `user_${userId}_${Date.now()}.${ext}`;
    const buffer = Buffer.from(await file.arrayBuffer());

    // Try upload; if the bucket is missing, create it (public) then retry.
    const { error: uploadErr } = await sb.storage
      .from('avatars')
      .upload(filename, buffer, { contentType: file.type, upsert: true });

    if (uploadErr) {
      if (uploadErr.message.toLowerCase().includes('bucket') || uploadErr.message.toLowerCase().includes('not found')) {
        await sb.storage.createBucket('avatars', { public: true });
        const { error: retryErr } = await sb.storage
          .from('avatars')
          .upload(filename, buffer, { contentType: file.type, upsert: true });
        if (retryErr) return NextResponse.json({ error: retryErr.message }, { status: 500 });
      } else {
        return NextResponse.json({ error: uploadErr.message }, { status: 500 });
      }
    }

    const { data } = sb.storage.from('avatars').getPublicUrl(filename);
    const publicUrl = data.publicUrl;

    const { error: dbErr } = await sb.from('users').update({ avatar_url: publicUrl }).eq('id', userId);
    if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 });

    return NextResponse.json({ url: publicUrl });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Upload failed' }, { status: 500 });
  }
}
