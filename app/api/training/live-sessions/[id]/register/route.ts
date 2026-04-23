import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/lib/shared/supabase';
import { sendEmail, FROM } from '@/src/lib/email/sendEmail';
import { registrationConfirmationTemplate } from '@/src/lib/email/templates/liveSessionNotification';

export const dynamic = 'force-dynamic';

/**
 * POST - register a student for a live session.
 *
 * Returns `{ success, registered, emailSent, registrationId }` so the
 * client can surface an accurate post-register message instead of
 * optimistically flipping the button when nothing was actually written.
 *
 * The previous implementation called .upsert() without .select() and
 * only returned `error`. If the upsert silently no-op'd (e.g. a stale
 * onConflict target or a permissions edge case) the route still
 * returned 200 success and the UI flipped to "Registered" without a
 * row ever landing in the table. We now SELECT the row back from the
 * upsert and refuse to claim success unless we can read its id.
 *
 * Email failures are reported via `emailSent: false` rather than
 * silently swallowed - registration still succeeds (the row is the
 * source of truth), but the client can warn the student to check
 * spam or contact support.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json() as { regId?: string; name?: string; email?: string };

  // Trim + validate explicitly so empty-string values (the most common
  // failure mode when the cookie/session isn't loaded yet) get a clear
  // error message instead of a silent 400.
  const regId = (body.regId ?? '').trim();
  const email = (body.email ?? '').trim().toLowerCase();
  const name  = (body.name  ?? '').trim();

  if (!regId) {
    console.warn('[live-sessions/register POST] missing regId', { sessionId: id, email });
    return NextResponse.json({ error: 'Registration ID is missing. Please sign out and back in, then try again.' }, { status: 400 });
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.warn('[live-sessions/register POST] missing/invalid email', { sessionId: id, regId });
    return NextResponse.json({ error: 'A valid email is required to register.' }, { status: 400 });
  }

  const sb = getServerClient();

  // Check session exists
  const { data: session } = await sb.from('live_sessions').select('title, scheduled_datetime, timezone, live_url').eq('id', id).maybeSingle();
  if (!session) {
    console.warn('[live-sessions/register POST] session not found', { sessionId: id });
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  // Upsert registration (idempotent on UNIQUE(session_id, student_email)).
  // .select() so we can confirm the row actually landed - SELECT-then-
  // returns is the only way to be certain the upsert produced a row
  // (previously we only checked .error which can be null on a no-op).
  const { data: upserted, error: upsertErr } = await sb
    .from('session_registrations')
    .upsert({
      session_id:     id,
      student_reg_id: regId,
      student_name:   name || regId,
      student_email:  email,
    }, { onConflict: 'session_id,student_email' })
    .select('id, registered_at')
    .maybeSingle();

  if (upsertErr) {
    console.error('[live-sessions/register POST] upsert failed', {
      sessionId: id, email, regId, error: upsertErr.message,
    });
    return NextResponse.json({ error: upsertErr.message }, { status: 500 });
  }

  // Defence-in-depth: if .select() returned nothing the upsert silently
  // failed despite no error. Verify the row exists with an explicit
  // SELECT before claiming success.
  let registrationId = upserted?.id ?? null;
  if (!registrationId) {
    const { data: confirmRow } = await sb
      .from('session_registrations')
      .select('id')
      .eq('session_id', id)
      .eq('student_email', email)
      .maybeSingle();
    registrationId = confirmRow?.id ?? null;
  }
  if (!registrationId) {
    console.error('[live-sessions/register POST] upsert claimed success but no row exists', {
      sessionId: id, email, regId,
    });
    return NextResponse.json({ error: 'Registration could not be persisted. Please try again or contact support.' }, { status: 500 });
  }

  // Send confirmation email. Surface the outcome instead of swallowing.
  let emailSent = false;
  let emailError: string | null = null;
  try {
    const dt = session.scheduled_datetime ? new Date(session.scheduled_datetime) : null;
    const { subject, html } = await registrationConfirmationTemplate({
      name: name || regId,
      sessionTitle: session.title,
      sessionDate: dt ? dt.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : '',
      sessionTime: dt ? dt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }) : '',
      timezone: session.timezone ?? 'Asia/Riyadh',
      sessionUrl: `${process.env.NEXT_PUBLIC_LEARN_URL ?? 'https://learn.financialmodelerpro.com'}/training/live-sessions/${id}`,
      liveUrl: session.live_url ?? undefined,
    });
    await sendEmail({ to: email, subject, html, from: FROM.training });
    emailSent = true;
  } catch (e) {
    emailError = e instanceof Error ? e.message : String(e);
    console.error('[live-sessions/register POST] confirmation email failed', {
      sessionId: id, email, error: emailError,
    });
  }

  console.log('[live-sessions/register POST] success', {
    sessionId: id, email, registrationId, emailSent,
  });

  return NextResponse.json({
    success:        true,
    registered:     true,
    registrationId,
    emailSent,
    emailError,
  });
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
    sb.from('live_sessions').select('scheduled_datetime, registration_required').eq('id', id).maybeSingle(),
    sb.from('session_registrations').select('*', { count: 'exact', head: true }).eq('session_id', id),
  ]);

  // CHANGE 1 (2026-04-23): Join link is available immediately upon
  // registration. The previous behaviour gated it behind a 30-min-
  // before-start window which left students wondering where the join
  // button was after registering. Surfacing the join URL early lets
  // students drop it into their calendar / pre-test their mic, while
  // the UI still shows the scheduled date/time prominently so nobody
  // is confused about WHEN the session actually starts.
  const registered = !!reg;
  const joinLinkAvailable = registered && !!session?.scheduled_datetime;

  return NextResponse.json({
    registered,
    joinLinkAvailable,
    registrationRequired: session?.registration_required ?? true,
    registrationCount: count ?? 0,
  });
}
