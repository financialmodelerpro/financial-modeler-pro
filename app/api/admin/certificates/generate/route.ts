import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/shared/auth';
import { getServerClient } from '@/src/lib/shared/supabase';
import { processPendingCertificates } from '@/src/lib/training/certificateEngine';

export const runtime    = 'nodejs';
export const maxDuration = 300;

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as { role?: string }).role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const result = await processPendingCertificates();

    // Record last generated timestamp
    const sb  = getServerClient();
    const now = new Date().toISOString();
    await sb.from('training_settings')
      .upsert({ key: 'cert_last_generated', value: now }, { onConflict: 'key' });

    return NextResponse.json({ ok: true, ...result, generatedAt: now });
  } catch (e) {
    console.error('[admin/certificates/generate]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
