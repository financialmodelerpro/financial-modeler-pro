import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/shared/auth';
import { getServerClient } from '@/src/lib/shared/supabase';
import { sendTemplatedEmail, buildSessionPlaceholders } from '@/src/lib/email/sendTemplatedEmail';

async function checkAdmin() {
  const session = await getServerSession(authOptions);
  return !!(session?.user && (session.user as { role?: string }).role === 'admin');
}

/** POST - manually send announcement for a session */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { id } = await params;
  const sb = getServerClient();

  // Check session exists and hasn't been announced
  const { data: session } = await sb.from('live_sessions').select('*').eq('id', id).single();
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  if (session.announcement_sent) return NextResponse.json({ error: 'Announcement already sent' }, { status: 400 });

  // Fetch all confirmed students
  const { data: students } = await sb
    .from('training_registrations_meta')
    .select('email, name')
    .or('email_confirmed.eq.true,email_confirmed.is.null');

  const recipients = (students ?? []).map(r => ({ email: r.email, name: r.name ?? '' }));
  const placeholders = buildSessionPlaceholders(session);

  const result = await sendTemplatedEmail({
    templateKey: 'session_announcement',
    recipients,
    placeholders,
  });

  await sb.from('live_sessions').update({ announcement_sent: true }).eq('id', id);

  return NextResponse.json({ ok: true, sent: result.sent, failed: result.failed });
}
