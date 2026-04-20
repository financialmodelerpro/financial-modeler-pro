import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/lib/shared/supabase';
import { sendEmail, FROM } from '@/src/lib/email/sendEmail';
import { registrationConfirmationTemplate } from '@/src/lib/email/templates/liveSessionNotification';

export const dynamic = 'force-dynamic';

/** POST - register for session */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json() as { regId?: string; name?: string; email?: string };
  if (!body.regId || !body.email) {
    return NextResponse.json({ error: 'regId and email required' }, { status: 400 });
  }

  const sb = getServerClient();

  // Check session exists
  const { data: session } = await sb.from('live_sessions').select('title, scheduled_datetime, timezone, live_url').eq('id', id).maybeSingle();
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });

  // Upsert registration (idempotent)
  const { error } = await sb.from('session_registrations').upsert({
    session_id: id,
    student_reg_id: body.regId,
    student_name: body.name ?? body.regId,
    student_email: body.email.toLowerCase(),
  }, { onConflict: 'session_id,student_email' });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Send confirmation email
  try {
    const dt = session.scheduled_datetime ? new Date(session.scheduled_datetime) : null;
    const { subject, html } = await registrationConfirmationTemplate({
      name: body.name ?? body.regId,
      sessionTitle: session.title,
      sessionDate: dt ? dt.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : '',
      sessionTime: dt ? dt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }) : '',
      timezone: session.timezone ?? 'Asia/Riyadh',
      sessionUrl: `${process.env.NEXT_PUBLIC_LEARN_URL ?? 'https://learn.financialmodelerpro.com'}/training/live-sessions/${id}`,
      liveUrl: session.live_url ?? undefined,
    });
    await sendEmail({ to: body.email, subject, html, from: FROM.training });
  } catch { /* non-fatal */ }

  return NextResponse.json({ success: true, registered: true });
}

/** DELETE - cancel registration */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json() as { email?: string };
  if (!body.email) return NextResponse.json({ error: 'email required' }, { status: 400 });

  const sb = getServerClient();
  await sb.from('session_registrations').delete().eq('session_id', id).eq('student_email', body.email.toLowerCase());
  return NextResponse.json({ success: true });
}

/** GET - registration status for a student */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const email = req.nextUrl.searchParams.get('email');
  if (!email) return NextResponse.json({ registered: false, joinLinkAvailable: false });

  const sb = getServerClient();

  const [{ data: reg }, { data: session }, { count }] = await Promise.all([
    sb.from('session_registrations').select('id').eq('session_id', id).eq('student_email', email.toLowerCase()).maybeSingle(),
    sb.from('live_sessions').select('scheduled_datetime, show_join_link_minutes_before, registration_required').eq('id', id).maybeSingle(),
    sb.from('session_registrations').select('*', { count: 'exact', head: true }).eq('session_id', id),
  ]);

  const registered = !!reg;
  let joinLinkAvailable = false;

  if (registered && session?.scheduled_datetime) {
    const minBefore = session.show_join_link_minutes_before ?? 30;
    const sessionTime = new Date(session.scheduled_datetime).getTime();
    joinLinkAvailable = Date.now() >= sessionTime - minBefore * 60 * 1000;
  }

  return NextResponse.json({
    registered,
    joinLinkAvailable,
    registrationRequired: session?.registration_required ?? true,
    registrationCount: count ?? 0,
  });
}
