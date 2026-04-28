import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';

export const revalidate = 0;

// POST is now a no-op. Certificates live in Supabase `student_certificates`
// as the source of truth (migration 109). There's nothing to sync from
// Apps Script anymore. Endpoint is retained so the admin UI can still
// click the Sync button without a 404; it just refreshes the timestamp.
export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as { role?: string }).role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const sb = getServerClient();
  const { count } = await sb
    .from('student_certificates')
    .select('*', { count: 'exact', head: true })
    .eq('cert_status', 'Issued');

  await sb
    .from('training_settings')
    .upsert({ key: 'cert_last_synced', value: new Date().toISOString() }, { onConflict: 'key' });

  return NextResponse.json({ ok: true, synced: count ?? 0, skipped: 0, note: 'Apps Script sync deprecated; certificates live in Supabase.' });
}

// GET - return list of certificates from Supabase
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as { role?: string }).role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const sb = getServerClient();

  const [certsRes, settingRes] = await Promise.all([
    sb.from('student_certificates').select('*').order('issued_date', { ascending: false }),
    sb.from('training_settings').select('value').eq('key', 'cert_last_synced').single(),
  ]);

  return NextResponse.json({
    certs:      certsRes.data ?? [],
    lastSynced: settingRes.data?.value ?? null,
  });
}
