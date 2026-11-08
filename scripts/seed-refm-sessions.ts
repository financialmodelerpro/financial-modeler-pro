/**
 * seed-refm-sessions.ts: creates (or refreshes the content of) the REFM live
 * course's eight sessions, straight into live_sessions.
 *
 * SENDS NOTHING. It writes rows directly, so none of the admin route's side
 * effects run: no newsletter auto-notify, no announcement, no email of any
 * kind (this file imports no email code; verify-live-course pins that). Teams
 * meetings are created afterwards from Admin > Live Training > REFM > Sessions >
 * "Create missing Teams meetings", which runs the existing integration on the
 * server where the Azure credentials live.
 *
 * Idempotent: a session that already exists (same course and number) gets its
 * title and content refreshed and KEEPS its time, so a reschedule is never
 * undone. `--reset-times` also restores the seeded times.
 *
 * Run: npx tsx --env-file=.env.local scripts/seed-refm-sessions.ts [--dry-run] [--reset-times]
 */
import { getServerClient } from '../src/core/db/supabase';
import { REFM_SESSIONS, REFM_COURSE_CODE, REFM_DURATION_MINUTES } from '../src/hubs/training/lib/liveCourse/seeds/refmSessions';
import { REFM_PAGE } from '../src/hubs/training/lib/liveCourse/seeds/refmPage';

/**
 * A stored page "has content" when any list section holds an item. A page
 * saved from the admin tab before any content existed holds only the empty
 * defaults, and counts as empty, so the REFM content still lands.
 */
function pageHasContent(stored: unknown): boolean {
  const s = ((stored ?? {}) as { sections?: Record<string, { items?: unknown[]; steps?: unknown[]; facts?: unknown[] }> }).sections ?? {};
  return Object.values(s).some((x) => (x?.items?.length ?? 0) > 0 || (x?.steps?.length ?? 0) > 0 || (x?.facts?.length ?? 0) > 0);
}

const KNOWN_FLAGS = ['--dry-run', '--reset-times'];
// A mistyped flag (e.g. --dry) must not run for real: refuse before writing anything.
const unknown = process.argv.slice(2).filter((a) => !KNOWN_FLAGS.includes(a));
if (unknown.length) { console.error(`Unknown flag(s): ${unknown.join(' ')}. Known: ${KNOWN_FLAGS.join(' ')}. Nothing was written.`); process.exit(1); }
const dry = process.argv.includes('--dry-run');
const resetTimes = process.argv.includes('--reset-times');

(async () => {
  const sb = getServerClient();
  const { data: course } = await sb.from('training_course_settings').select('course_code').eq('course_code', REFM_COURSE_CODE).maybeSingle();
  if (!course) throw new Error('REFM course row not found (mig 247).');
  const { data: def } = await sb.from('instructors').select('id, name, title').eq('is_default', true).maybeSingle();
  const { data: existing, error } = await sb.from('live_sessions').select('id, course_session_no, scheduled_datetime').eq('course_code', REFM_COURSE_CODE);
  if (error) throw new Error(error.message);
  const byNo = new Map((existing ?? []).map((r) => [r.course_session_no as number, r]));

  let created = 0, refreshed = 0;
  for (const s of REFM_SESSIONS) {
    const content = {
      title: s.title,
      description: s.overview,
      content_overview: s.overview,
      content_learn: s.learn,
      content_outcome: s.outcome,
      content_claude: s.claude,
      updated_at: new Date().toISOString(),
    };
    const row = byNo.get(s.no);
    if (row) {
      const update = resetTimes ? { ...content, scheduled_datetime: s.start, duration_minutes: REFM_DURATION_MINUTES } : content;
      console.log(`  refresh  Session ${s.no}: ${s.title}${resetTimes ? ` (time -> ${s.start})` : ` (time kept: ${row.scheduled_datetime})`}`);
      if (!dry) { const { error: e } = await sb.from('live_sessions').update(update).eq('id', row.id); if (e) throw new Error(e.message); }
      refreshed++;
      continue;
    }
    console.log(`  create   Session ${s.no}: ${s.title} at ${s.start}`);
    if (!dry) {
      const { error: e } = await sb.from('live_sessions').insert({
        ...content,
        course_code: REFM_COURSE_CODE,
        course_session_no: s.no,
        session_type: 'upcoming',
        scheduled_datetime: s.start,
        timezone: 'Asia/Riyadh',
        duration_minutes: REFM_DURATION_MINUTES,
        is_published: true,
        youtube_embed: true,
        youtube_url: '',
        live_url: '',
        banner_url: null,
        meeting_provider: 'manual',
        instructor_id: def?.id ?? null,
        instructor_name: def?.name ?? 'Ahmad Din',
        instructor_title: def?.title ?? null,
        // Explicitly not announced: announcements go out only when the admin sends them.
        announcement_sent: false,
        notification_sent: false,
      });
      if (e) throw new Error(`Session ${s.no}: ${e.message}`);
    }
    created++;
  }

  // The landing page content (mig 252), only when the course has none yet, so
  // edits made in Admin > Live Training > REFM > Page sections are never overwritten.
  const { data: pageRow, error: pageErr } = await sb.from('training_course_settings').select('page_sections').eq('course_code', REFM_COURSE_CODE).maybeSingle();
  if (pageErr) console.log(`  page     skipped (${pageErr.message}; apply migration 252)`);
  else if (pageRow && !pageHasContent(pageRow.page_sections)) {
    console.log('  page     REFM landing page content written');
    if (!dry) {
      const { error: e } = await sb.from('training_course_settings').update({ page_sections: REFM_PAGE }).eq('course_code', REFM_COURSE_CODE);
      if (e) throw new Error(e.message);
    }
  } else console.log('  page     kept (already has content)');

  console.log(`\n${dry ? '[dry run] ' : ''}${created} created, ${refreshed} refreshed. No email or newsletter was sent.`);
  console.log('Next: Admin > Live Training > REFM > Sessions > "Create missing Teams meetings".');
})().catch((e) => { console.error(e); process.exit(1); });
