import { getServerClient } from '../src/core/db/supabase';
(async () => {
  const sb = getServerClient();
  const { data } = await sb.from('live_sessions').select('id, course_session_no, title, scheduled_datetime, live_url, teams_meeting_id, is_published, announcement_sent, banner_url').eq('course_code', 'REFM').order('course_session_no');
  for (const s of data ?? []) console.log(s.course_session_no, s.id, s.scheduled_datetime, s.is_published ? 'pub' : 'draft', s.live_url ? 'teams' : 'NO-TEAMS', s.announcement_sent ? 'ANNOUNCED' : 'quiet', s.banner_url ? 'img' : 'no-img');
  console.log('count', data?.length);
})();
