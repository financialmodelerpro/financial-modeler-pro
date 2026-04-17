import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/shared/auth';
import { getServerClient } from '@/src/lib/shared/supabase';
import { sendTemplatedEmail, buildSessionPlaceholders } from '@/src/lib/email/sendTemplatedEmail';
import { sendAutoNewsletter } from '@/src/lib/newsletter/autoNotify';

const LEARN_URL = process.env.NEXT_PUBLIC_LEARN_URL ?? 'https://learn.financialmodelerpro.com';

async function checkAdmin() {
  const session = await getServerSession(authOptions);
  return !!(session?.user && (session.user as { role?: string }).role === 'admin');
}

/** Fetch all confirmed training students */
async function getAllConfirmedStudents(sb: ReturnType<typeof getServerClient>) {
  const { data } = await sb
    .from('training_registrations_meta')
    .select('email, name')
    .or('email_confirmed.eq.true,email_confirmed.is.null'); // null = pre-migration, treat as confirmed
  return (data ?? []).map(r => ({ email: r.email, name: r.name ?? '' }));
}

/** PATCH — update session */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { id } = await params;
  const body = await req.json() as Record<string, unknown>;
  const sb = getServerClient();

  // Fetch current state before update (for detecting transitions)
  const { data: before } = await sb.from('live_sessions').select('is_published, session_type, announcement_sent, announcement_send_mode, recording_email_sent').eq('id', id).single();

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  const allowed = [
    'title', 'description', 'youtube_url', 'live_url', 'session_type', 'scheduled_datetime',
    'timezone', 'category', 'playlist_id', 'is_published', 'display_order', 'banner_url',
    'duration_minutes', 'max_attendees', 'difficulty_level', 'prerequisites', 'instructor_name',
    'tags', 'is_featured', 'live_password', 'registration_url',
    'announcement_send_mode', 'youtube_embed', 'instructor_title',
  ];
  for (const k of allowed) {
    if (body[k] !== undefined) updates[k] = body[k] === '' && k === 'playlist_id' ? null : body[k];
  }

  const { error } = await sb.from('live_sessions').update(updates).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let emailResult: { sent?: number } | undefined;

  // ── Trigger: auto-announcement on publish ────────────────────────────────
  if (
    before &&
    !before.is_published &&
    body.is_published === true &&
    !before.announcement_sent
  ) {
    const mode = (body.announcement_send_mode as string) ?? before.announcement_send_mode ?? 'auto';
    if (mode === 'auto') {
      // Fetch updated session for placeholders
      const { data: session } = await sb.from('live_sessions').select('*').eq('id', id).single();
      if (session) {
        const students = await getAllConfirmedStudents(sb);
        const placeholders = buildSessionPlaceholders(session);
        emailResult = await sendTemplatedEmail({
          templateKey: 'session_announcement',
          recipients: students,
          placeholders,
        });
        await sb.from('live_sessions').update({ announcement_sent: true }).eq('id', id);
      }
    }
  }

  // ── Trigger: recording available email ───────────────────────────────────
  if (
    before &&
    before.session_type !== 'recorded' &&
    body.session_type === 'recorded' &&
    !before.recording_email_sent
  ) {
    const { data: session } = await sb.from('live_sessions').select('*').eq('id', id).single();
    if (session) {
      // Get registered students who did NOT attend
      const { data: regs } = await sb
        .from('session_registrations')
        .select('student_email, student_name')
        .eq('session_id', id)
        .or('attended.eq.false,attended.is.null');

      if (regs && regs.length > 0) {
        const placeholders = buildSessionPlaceholders(session);
        await sendTemplatedEmail({
          templateKey: 'session_recording_available',
          recipients: regs.map(r => ({ email: r.student_email, name: r.student_name ?? '' })),
          placeholders,
        });
      }
      await sb.from('live_sessions').update({ recording_email_sent: true }).eq('id', id);
    }
  }

  // ── Newsletter auto-notifications ─────────────────────────────────────────
  if (before && !before.is_published && body.is_published === true) {
    const { data: sess } = await sb.from('live_sessions').select('*').eq('id', id).single();
    if (sess) {
      const dt = sess.scheduled_datetime ? new Date(sess.scheduled_datetime) : null;
      void sendAutoNewsletter('live_session_scheduled', id, {
        title: sess.title, description: sess.description ?? '',
        url: sess.live_url || `${LEARN_URL}/training/dashboard?tab=live-sessions`,
        date: dt?.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) ?? '',
        extra: { time: dt?.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }) ?? '', platform: 'YouTube' },
      });
    }
  }
  if (before && before.session_type !== 'recorded' && body.session_type === 'recorded') {
    const { data: sess } = await sb.from('live_sessions').select('title, youtube_url').eq('id', id).single();
    if (sess) {
      void sendAutoNewsletter('live_session_recording', id, {
        title: sess.title, url: sess.youtube_url ?? '',
      });
    }
  }

  return NextResponse.json({ ok: true, emailResult });
}

/** DELETE — delete session + attachments */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { id } = await params;
  const sb = getServerClient();
  await sb.from('course_attachments').delete().eq('tab_key', `LIVE_${id}`);
  const { error } = await sb.from('live_sessions').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
