import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/core/db/supabase';
import { adminEmail } from '@/src/hubs/training/lib/liveCourse/adminGuard';
import { deleteMeetingOrEvent, isTeamsConfigured } from '@/src/integrations/teams/teamsMeetings';
import { invalidateLiveCourseCache } from '@/src/hubs/training/lib/liveCourse/cachedReads';

export const dynamic = 'force-dynamic';

/**
 * DELETE /api/admin/live-sessions/[id]/teams-meeting
 * Removes an UNPUBLISHED course session's Teams meeting from the host calendar
 * and clears its link, keeping the session row (and any attendance, e.g. a test
 * session's). A published course session is refused: its students may hold
 * the link. Sends no student email.
 */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!await adminEmail()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (!isTeamsConfigured()) return NextResponse.json({ error: 'Microsoft Teams is not configured on the server (AZURE_* env vars).' }, { status: 400 });
  const { id } = await params;
  const sb = getServerClient();
  const { data: s } = await sb.from('live_sessions').select('id, course_code, is_published, teams_meeting_id, meeting_provider').eq('id', id).maybeSingle();
  if (!s) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (s.is_published) return NextResponse.json({ error: 'Unpublish the session first: enrolled students may hold its link.' }, { status: 409 });
  if (!s.teams_meeting_id) return NextResponse.json({ error: 'This session has no Teams meeting.' }, { status: 400 });
  try { await deleteMeetingOrEvent(s.teams_meeting_id as string); }
  catch (e) { return NextResponse.json({ error: `Teams refused the delete: ${(e as Error).message}` }, { status: 502 }); }
  await sb.from('live_sessions').update({ teams_meeting_id: null, live_url: null, graph_online_meeting_id: null, updated_at: new Date().toISOString() }).eq('id', id);
  invalidateLiveCourseCache();
  return NextResponse.json({ ok: true });
}
