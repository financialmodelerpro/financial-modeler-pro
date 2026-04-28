import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';
import { sendAutoNewsletter } from '@/src/shared/newsletter/autoNotify';
import { createCalendarEventWithMeeting, isTeamsConfigured, TeamsIntegrationError } from '@/src/integrations/teams/teamsMeetings';

const LEARN_URL = process.env.NEXT_PUBLIC_LEARN_URL ?? 'https://learn.financialmodelerpro.com';
const DEFAULT_SESSION_DURATION_MINUTES = 90;

async function checkAdmin() {
  const session = await getServerSession(authOptions);
  return !!(session?.user && (session.user as { role?: string }).role === 'admin');
}

/** GET - list all sessions (admin sees unpublished too) */
export async function GET() {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const sb = getServerClient();
  const { data } = await sb.from('live_sessions').select('*, live_playlists(id, name)').order('display_order').order('created_at', { ascending: false });
  return NextResponse.json({ sessions: data ?? [] });
}

/** PUT - upload banner image */
export async function PUT(req: NextRequest) {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  try {
    const form = await req.formData();
    const file = form.get('file') as File | null;
    const sessionId = (form.get('sessionId') as string ?? '').trim();
    if (!file || !sessionId) return NextResponse.json({ error: 'file and sessionId required' }, { status: 400 });
    const sb = getServerClient();
    const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg';
    const path = `banners/${sessionId}.${ext}`;
    const bytes = Buffer.from(await file.arrayBuffer());
    await sb.storage.from('live-session-banners').upload(path, bytes, { contentType: file.type, upsert: true });
    const { data: { publicUrl } } = sb.storage.from('live-session-banners').getPublicUrl(path);
    await sb.from('live_sessions').update({ banner_url: publicUrl, updated_at: new Date().toISOString() }).eq('id', sessionId);
    return NextResponse.json({ success: true, url: publicUrl });
  } catch (e) { return NextResponse.json({ error: String(e) }, { status: 500 }); }
}

/** POST - create session */
export async function POST(req: NextRequest) {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const body = await req.json() as Record<string, unknown>;
  const sb = getServerClient();

  // Resolve instructor: prefer explicit instructor_id, else fall back to the
  // default instructor (if configured). Denormalize name/title so legacy
  // readers still work.
  let instructorId = (body.instructor_id as string | undefined) || null;
  let instructorName = (body.instructor_name as string | undefined) ?? '';
  let instructorTitle = (body.instructor_title as string | undefined) ?? '';
  if (!instructorId) {
    const { data: def } = await sb.from('instructors').select('id, name, title').eq('is_default', true).maybeSingle();
    if (def) {
      instructorId = def.id;
      if (!instructorName) instructorName = def.name;
      if (!instructorTitle) instructorTitle = def.title;
    }
  } else {
    const { data: inst } = await sb.from('instructors').select('name, title').eq('id', instructorId).maybeSingle();
    if (inst) { instructorName = inst.name; instructorTitle = inst.title; }
  }
  if (!instructorName) instructorName = 'Ahmad Din';

  // Auto-generate a Teams meeting when the admin toggled it on, we're making
  // an upcoming session, no manual URL was supplied, and credentials exist.
  // Teams failures return a warning but never block the save — the admin
  // can still paste a URL manually after the fact.
  const sessionType         = (body.session_type as string | undefined) ?? 'recorded';
  const scheduledDatetime   = (body.scheduled_datetime as string | null | undefined) ?? null;
  const durationMinutes     = (body.duration_minutes as number | null | undefined) ?? null;
  const wantsTeams          = body.meeting_provider === 'teams' || body.auto_generate_teams === true;
  const manualLiveUrl       = ((body.live_url as string | undefined) ?? '').trim();

  let teamsMeetingId: string | null = null;
  let teamsDialIn:    unknown | null = null;
  let liveUrl         = manualLiveUrl;
  let meetingProvider = (body.meeting_provider as string | undefined) ?? 'manual';
  let teamsWarning: string | null = null;

  if (wantsTeams && sessionType === 'upcoming' && scheduledDatetime && !manualLiveUrl) {
    if (!isTeamsConfigured()) {
      teamsWarning = 'Teams integration not configured. Session saved without an auto-generated meeting link.';
      meetingProvider = 'manual';
    } else {
      try {
        const dur = durationMinutes && durationMinutes > 0 ? durationMinutes : DEFAULT_SESSION_DURATION_MINUTES;
        const end = new Date(new Date(scheduledDatetime).getTime() + dur * 60 * 1000).toISOString();
        // Switched from /onlineMeetings (URL only) to /events with
        // isOnlineMeeting:true so Outlook also creates a calendar entry
        // on the host (Ahmad) and emails him the standard meeting invite.
        const mtg = await createCalendarEventWithMeeting({
          subject:       (body.title as string | undefined) ?? 'Live Session',
          startDateTime: scheduledDatetime,
          endDateTime:   end,
          timezone:      ((body.timezone as string | undefined) ?? '').trim() || 'Asia/Karachi',
          description:   (body.description as string | undefined) ?? '',
        });
        teamsMeetingId = mtg.meetingId;   // Outlook event id from the new flow
        teamsDialIn    = mtg.dialIn;
        liveUrl        = mtg.joinUrl;
        meetingProvider = 'teams';
      } catch (err) {
        const detail = err instanceof TeamsIntegrationError ? `${err.message}: ${err.detail ?? ''}`.trim() : String(err);
        console.error('[live-sessions POST] Teams create failed:', detail);
        // Friendlier message for the most likely first-time-setup error
        // (Calendars.ReadWrite consent still propagating across Microsoft's
        // edge; typically resolves within ~30 minutes of grant).
        const status = err instanceof TeamsIntegrationError ? err.status : undefined;
        const isPermErr = status === 403 || /(ErrorAccessDenied|Authorization_RequestDenied|forbidden)/i.test(detail);
        teamsWarning = isPermErr
          ? 'Teams calendar permission not fully granted yet. Try again in a few minutes (admin consent for Calendars.ReadWrite can take up to 30 minutes to propagate). Session saved without a meeting link.'
          : `Teams meeting auto-generation failed (${detail}). Session saved without a meeting link.`;
        meetingProvider = 'manual';
      }
    }
  }

  const { data, error } = await sb.from('live_sessions').insert({
    title:              body.title ?? '',
    description:        body.description ?? '',
    youtube_url:        body.youtube_url ?? '',
    live_url:           liveUrl,
    session_type:       sessionType,
    scheduled_datetime: scheduledDatetime,
    timezone:           body.timezone ?? 'Asia/Riyadh',
    category:           body.category ?? '',
    playlist_id:        body.playlist_id || null,
    is_published:       body.is_published ?? false,
    display_order:      body.display_order ?? 0,
    banner_url:         body.banner_url ?? null,
    duration_minutes:   durationMinutes,
    max_attendees:      body.max_attendees ?? null,
    difficulty_level:   body.difficulty_level ?? 'All Levels',
    prerequisites:      body.prerequisites ?? '',
    instructor_id:      instructorId,
    instructor_name:    instructorName,
    instructor_title:   instructorTitle,
    tags:               body.tags ?? [],
    is_featured:        body.is_featured ?? false,
    live_password:      body.live_password ?? '',
    registration_url:   body.registration_url ?? '',
    teams_meeting_id:   teamsMeetingId,
    teams_dial_in:      teamsDialIn,
    meeting_provider:   meetingProvider,
  }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Creating a published upcoming session no longer auto-blasts the student
  // roster. Announcements are now triggered exclusively by the admin via the
  // "Send Announcement" button, which hits /api/admin/live-sessions/[id]/notify
  // (has maxDuration=300 so mass Resend batches don't get killed mid-flight).
  //
  // The newsletter auto-notify still fires because it targets opt-in
  // subscribers, not the training roster, and has its own duplicate-prevention.
  if (data && data.is_published) {
    const dt = data.scheduled_datetime ? new Date(data.scheduled_datetime) : null;
    void sendAutoNewsletter('live_session_scheduled', data.id, {
      title: data.title, description: data.description ?? '',
      url: data.live_url || `${LEARN_URL}/training/dashboard?tab=live-sessions`,
      date: dt?.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) ?? '',
      extra: {
        time: dt?.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }) ?? '',
        platform: 'YouTube',
      },
    });
  }
  return NextResponse.json({ session: data, teamsWarning });
}
