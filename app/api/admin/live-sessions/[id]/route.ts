import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';
import { sendTemplatedEmail, buildSessionPlaceholders } from '@/src/shared/email/sendTemplatedEmail';
import { sendAutoNewsletter } from '@/src/shared/newsletter/autoNotify';
import { updateMeetingOrEvent, deleteMeetingOrEvent, isTeamsConfigured } from '@/src/lib/integrations/teamsMeetings';

const LEARN_URL = process.env.NEXT_PUBLIC_LEARN_URL ?? 'https://learn.financialmodelerpro.com';
const AUTO_DELETE_TEAMS_MEETING_ON_SESSION_DELETE = true;

async function checkAdmin() {
  const session = await getServerSession(authOptions);
  return !!(session?.user && (session.user as { role?: string }).role === 'admin');
}

/** PATCH - update session */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { id } = await params;
  const body = await req.json() as Record<string, unknown>;
  const sb = getServerClient();

  const { data: before } = await sb
    .from('live_sessions')
    .select('is_published, session_type, scheduled_datetime, recording_email_sent, teams_meeting_id, meeting_provider, title, duration_minutes, description, timezone')
    .eq('id', id)
    .single();

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  const allowed = [
    'title', 'description', 'youtube_url', 'live_url', 'session_type', 'scheduled_datetime',
    'timezone', 'category', 'playlist_id', 'is_published', 'display_order', 'banner_url',
    'duration_minutes', 'max_attendees', 'difficulty_level', 'prerequisites', 'instructor_name',
    'tags', 'is_featured', 'live_password', 'registration_url',
    'youtube_embed', 'instructor_title', 'instructor_id',
    'meeting_provider',
  ];
  for (const k of allowed) {
    if (body[k] !== undefined) {
      if ((k === 'playlist_id' || k === 'instructor_id') && body[k] === '') {
        updates[k] = null;
      } else {
        updates[k] = body[k];
      }
    }
  }

  if (updates.instructor_id) {
    const { data: inst } = await sb
      .from('instructors')
      .select('name, title')
      .eq('id', updates.instructor_id as string)
      .maybeSingle();
    if (inst) {
      updates.instructor_name = inst.name;
      updates.instructor_title = inst.title;
    }
  }

  const { error } = await sb.from('live_sessions').update(updates).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Sync the linked Teams calendar event when the schedule changes (or
  // title / description did). Best-effort: a failure doesn't roll back
  // the session save, the admin can retry via re-edit. The
  // updateMeetingOrEvent wrapper tries the new /events endpoint first
  // and falls back to the legacy /onlineMeetings endpoint on 404 so
  // pre-migration sessions remain editable. Outlook auto-sends an
  // updated meeting email to the host on every successful PATCH.
  if (
    before?.teams_meeting_id &&
    before.meeting_provider === 'teams' &&
    isTeamsConfigured()
  ) {
    const titleChanged    = updates.title !== undefined && updates.title !== before.title;
    const scheduleChanged = updates.scheduled_datetime !== undefined && updates.scheduled_datetime !== before.scheduled_datetime;
    const durationChanged = updates.duration_minutes !== undefined && updates.duration_minutes !== before.duration_minutes;
    const descChanged     = updates.description !== undefined && updates.description !== before.description;
    if (titleChanged || scheduleChanged || durationChanged || descChanged) {
      const start = (updates.scheduled_datetime as string | null) ?? before.scheduled_datetime;
      const dur   = (updates.duration_minutes as number | null) ?? before.duration_minutes ?? 90;
      if (start) {
        try {
          const end = new Date(new Date(start).getTime() + dur * 60 * 1000).toISOString();
          await updateMeetingOrEvent(before.teams_meeting_id, {
            subject:       (updates.title as string | undefined) ?? before.title ?? undefined,
            startDateTime: start,
            endDateTime:   end,
            timezone:      ((updates.timezone as string | undefined) ?? before.timezone ?? '').trim() || 'Asia/Karachi',
            description:   (updates.description as string | undefined) ?? before.description ?? '',
          });
        } catch (err) {
          console.error('[live-sessions PATCH] Teams update failed:', err);
        }
      }
    }
  }

  // ── Trigger: recording available email (kept — fires once when a past
  // session gets marked recorded, targets only those who didn't attend) ───
  if (
    before &&
    before.session_type !== 'recorded' &&
    body.session_type === 'recorded' &&
    !before.recording_email_sent
  ) {
    const { data: session } = await sb.from('live_sessions').select('*').eq('id', id).single();
    if (session) {
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

  // ── Newsletter auto-notifications (opt-in subscribers, not training roster)
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

  return NextResponse.json({ ok: true });
}

/** DELETE - delete session + attachments + optionally the linked Teams meeting */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { id } = await params;
  const sb = getServerClient();

  if (AUTO_DELETE_TEAMS_MEETING_ON_SESSION_DELETE && isTeamsConfigured()) {
    const { data: row } = await sb
      .from('live_sessions')
      .select('teams_meeting_id, meeting_provider')
      .eq('id', id)
      .maybeSingle();
    if (row?.teams_meeting_id && row.meeting_provider === 'teams') {
      // deleteMeetingOrEvent tries the calendar /events endpoint first
      // (sends a cancellation email to the host automatically) and
      // falls back to /onlineMeetings on 404 for pre-migration ids.
      try { await deleteMeetingOrEvent(row.teams_meeting_id); }
      catch (err) { console.error('[live-sessions DELETE] Teams delete failed:', err); }
    }
  }

  await sb.from('course_attachments').delete().eq('tab_key', `LIVE_${id}`);
  const { error } = await sb.from('live_sessions').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
