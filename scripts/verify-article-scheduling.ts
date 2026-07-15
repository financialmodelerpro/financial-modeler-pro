/**
 * verify-article-scheduling.ts
 *
 * Proves scheduled article publishing (migration 198): the shared resolve rule,
 * the wiring that makes it fire, and the two hazards it exists to prevent (the
 * auto-save un-publish race, and publish-date drift).
 *
 * Pure + source-assertion tests; no DB and no network.
 *
 * Run: npx tsx scripts/verify-article-scheduling.ts
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  resolveSchedule,
  parseScheduledAt,
  nextPublishCheckAfter,
  PUBLISH_CHECK_UTC_HOUR,
  SCHEDULE_TIME_REQUIRED_MSG,
  SCHEDULE_TIME_INVALID_MSG,
} from '../src/shared/cms/scheduling';

let pass = 0, fail = 0; const fails: string[] = [];
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { pass++; console.log(`  [PASS] ${name}`); }
  else { fail++; fails.push(name); console.log(`  [FAIL] ${name}${detail ? ` :: ${detail}` : ''}`); }
};
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

const NOW = Date.parse('2026-07-15T12:00:00Z');
const FUTURE = '2026-07-20T09:00:00.000Z';
const PAST   = '2026-07-14T09:00:00.000Z';

console.log('=== 1. parseScheduledAt ===');
check('parses a valid ISO string', parseScheduledAt(FUTURE)?.toISOString() === FUTURE);
check('null for undefined', parseScheduledAt(undefined) === null);
check('null for empty string', parseScheduledAt('') === null);
check('null for whitespace', parseScheduledAt('   ') === null);
check('null for garbage', parseScheduledAt('not-a-date') === null);
check('null for a non-string', parseScheduledAt(12345) === null);

console.log('\n=== 2. resolveSchedule: the core rule ===');
const future = resolveSchedule('scheduled', FUTURE, NOW);
check('future schedule stays scheduled', future?.status === 'scheduled');
check('future schedule stores the UTC time', future?.scheduledAt === FUTURE);
check('future schedule does not fire now', future?.firedNow === false);
check('future schedule has no error', !future?.error);

const past = resolveSchedule('scheduled', PAST, NOW);
check('PAST schedule collapses to published', past?.status === 'published');
check('PAST schedule clears the timer', past?.scheduledAt === null);
check('PAST schedule reports firedNow', past?.firedNow === true);

// The boundary: exactly-now is due, because the cron would take it on this tick.
const exactly = resolveSchedule('scheduled', new Date(NOW).toISOString(), NOW);
check('schedule at exactly now is due -> published', exactly?.status === 'published');

console.log('\n=== 3. resolveSchedule: rejections ===');
const noTime = resolveSchedule('scheduled', null, NOW);
check('scheduled with no time errors', noTime?.error === SCHEDULE_TIME_REQUIRED_MSG);
check('scheduled with no time does not silently publish', noTime?.status !== 'published');
const badTime = resolveSchedule('scheduled', 'tuesday-ish', NOW);
check('scheduled with garbage time errors', badTime?.error === SCHEDULE_TIME_INVALID_MSG);
check('a missing time and an unparseable one are told apart', noTime?.error !== badTime?.error);

console.log('\n=== 4. resolveSchedule: other statuses clear the timer ===');
const pub = resolveSchedule('published', FUTURE, NOW);
check('published stays published', pub?.status === 'published');
check('published CLEARS a pending timer', pub?.scheduledAt === null);
const draft = resolveSchedule('draft', FUTURE, NOW);
check('draft stays draft', draft?.status === 'draft');
check('draft CLEARS a pending timer (no zombie schedule)', draft?.scheduledAt === null);
check('draft does not fire', draft?.firedNow === false);

console.log('\n=== 5. resolveSchedule: absent status leaves everything alone ===');
check('undefined status -> null (caller must not touch status)', resolveSchedule(undefined, FUTURE, NOW) === null);
check('unknown status -> null', resolveSchedule('archived', FUTURE, NOW) === null);
check('null status -> null', resolveSchedule(null, undefined, NOW) === null);

console.log('\n=== 6. The auto-save un-publish race ===');
// The editor auto-saves every 60s carrying its LOCAL status. Once the cron has
// published a scheduled article, that stale tab PATCHes status='scheduled' with the
// now-past time. If that were stored verbatim the article would leave the site.
const staleAutoSave = resolveSchedule('scheduled', PAST, NOW);
check('stale auto-save after the schedule fired resolves to published, NOT scheduled',
  staleAutoSave?.status === 'published', `got ${staleAutoSave?.status}`);
check('stale auto-save clears the spent timer', staleAutoSave?.scheduledAt === null);

console.log('\n=== 7. Wiring: admin API ===');
const api = read('app/api/admin/articles/route.ts');
check('API imports the shared rule', /import \{ resolveSchedule \} from '@\/src\/shared\/cms\/scheduling'/.test(api));
check('scheduled_at is schema-tolerant (in ADDITIVE_KEYS)', /ADDITIVE_KEYS = \[[^\]]*'scheduled_at'/.test(api));
check('POST resolves the schedule', /const sched = resolveSchedule\(status, scheduled_at\)/.test(api));
check('POST rejects a bad schedule with 400', /if \(sched\?\.error\) return NextResponse\.json\(\{ error: sched\.error \}, \{ status: 400 \}\)/.test(api));
check('POST stores the resolved status, not the raw one', /status: effectiveStatus/.test(api));
check('POST announces on the RESOLVED status', /if \(data && effectiveStatus === 'published'\)/.test(api));
check('PATCH resolves the schedule', /const sched = resolveSchedule\(fields\.status, fields\.scheduled_at\)/.test(api));
check('PATCH writes the resolved status + timer', /update\.status = sched\.status; update\.scheduled_at = sched\.scheduledAt;/.test(api));
check('PATCH leaves the timer alone when no status is sent', /else delete update\.scheduled_at/.test(api));
check('PATCH announces on the RESOLVED status', /if \(sched\?\.status === 'published'\)/.test(api));
check('PATCH echoes resolved state back for editor re-sync', /status: sched\?\.status, scheduled_at: sched\?\.scheduledAt/.test(api));
check('the old raw-status publish branch is gone', !/if \(fields\.status === 'published'\) \{/.test(api));

console.log('\n=== 8. Publish-date drift (published_at stamped once) ===');
check('PATCH reads the existing published_at before stamping', /select\('published_at'\)\.eq\('id', id\)/.test(api));
check('PATCH stamps published_at only when absent', /if \(!\(cur as \{ published_at\?: string \| null \} \| null\)\?\.published_at\)/.test(api));
check('the old unconditional re-stamp is gone',
  !/fields\.status === 'published' && !fields\.published_at/.test(api));

console.log('\n=== 9. Wiring: the cron ===');
const cron = read('app/api/cron/publish-scheduled-articles/route.ts');
check('cron is CRON_SECRET protected', /authHeader !== `Bearer \$\{process\.env\.CRON_SECRET\}`/.test(cron));
check('cron 401s an unauthorized call', /return Response\.json\(\{ error: 'Unauthorized' \}, \{ status: 401 \}\)/.test(cron));
check('cron runs on node', /export const runtime = 'nodejs'/.test(cron));
check('cron selects only due scheduled rows', /\.eq\('status', 'scheduled'\)[\s\S]{0,80}\.lte\('scheduled_at', now\)/.test(cron));
check('cron claim-guards the flip against a re-entrant tick', /\.eq\('id', a\.id\)[\s\S]{0,40}\.eq\('status', 'scheduled'\)/.test(cron));
check('cron skips a row it did not claim', /if \(!claimed\) \{[^\n]*continue/.test(cron));
check('cron publishes at the time the admin ASKED for', /published_at: a\.scheduled_at \?\? now/.test(cron));
check('cron clears the spent timer', /scheduled_at: null/.test(cron));
check('cron announces the article', /sendAutoNewsletter\('article_published'/.test(cron));
check('one failure does not abort the batch (per-row try/catch)', /for \(const a of due\) \{[\s\S]*try \{/.test(cron));

console.log('\n=== 10. Wiring: vercel.json cron entry ===');
const vercel = JSON.parse(read('vercel.json')) as { crons: Array<{ path: string; schedule: string }> };
const entry = vercel.crons.find(c => c.path === '/api/cron/publish-scheduled-articles');
check('cron is registered in vercel.json', !!entry);
check('the pre-existing crons are untouched', vercel.crons.length === 6
  && !!vercel.crons.find(c => c.path === '/api/cron/subscription-reminders' && c.schedule === '0 10 * * *')
  && !!vercel.crons.find(c => c.path === '/api/cron/newsletter-scheduled' && c.schedule === '0 7 * * *'));

// THE OUTAGE GUARD. This file used to assert schedule === '* * * * *', which
// locked in the exact expression that took production down: the account is on
// Vercel HOBBY, which rejects any cron running more than once a day, and the
// rejection fails the WHOLE DEPLOYMENT (no deployment record is even created,
// so nothing appears in the dashboard to notice). Every push from f9f9506f
// onward silently never reached prod. Assert the CONSTRAINT, not the value.
const runsMoreThanOncePerDay = (schedule: string): boolean => {
  const [minute, hour] = schedule.trim().split(/\s+/);
  // A field that is not a single fixed value (*, */n, a,b, a-b) fires repeatedly.
  const repeats = (f: string) => !/^\d+$/.test(f ?? '');
  return repeats(minute) || repeats(hour);
};
check('publish cron runs at most once per day (Hobby rejects sub-daily, failing the whole deploy)',
  !!entry && !runsMoreThanOncePerDay(entry.schedule), entry?.schedule);
for (const c of vercel.crons) {
  check(`cron "${c.path}" (${c.schedule}) is deployable on Hobby`, !runsMoreThanOncePerDay(c.schedule));
}
// Sanity-check the guard itself, so it cannot rot into always-passing.
check('the guard flags every-minute', runsMoreThanOncePerDay('* * * * *'));
check('the guard flags every-30-minutes', runsMoreThanOncePerDay('*/30 * * * *'));
check('the guard flags hourly', runsMoreThanOncePerDay('0 * * * *'));
check('the guard accepts a daily expression', !runsMoreThanOncePerDay('0 5 * * *'));

console.log('\n=== 10b. The cron hour and the UI cannot drift apart ===');
check('scheduling.ts publish-check hour matches the vercel.json cron hour',
  entry?.schedule === `0 ${PUBLISH_CHECK_UTC_HOUR} * * *`, `${entry?.schedule} vs hour ${PUBLISH_CHECK_UTC_HOUR}`);
{
  const at = (iso: string) => nextPublishCheckAfter(Date.parse(iso)).toISOString();
  // Before the daily check: publishes the same day.
  check('a time before the daily check publishes at that same day check',
    at('2026-07-20T03:00:00Z') === '2026-07-20T05:00:00.000Z', at('2026-07-20T03:00:00Z'));
  // After it: slips to TOMORROW. This is the whole reason the UI must warn.
  check('a time after the daily check slips to the NEXT day',
    at('2026-07-20T09:00:00Z') === '2026-07-21T05:00:00.000Z', at('2026-07-20T09:00:00Z'));
  check('a time exactly at the check publishes then, not a day later',
    at('2026-07-20T05:00:00Z') === '2026-07-20T05:00:00.000Z', at('2026-07-20T05:00:00Z'));
  check('the returned check is never before the requested time',
    nextPublishCheckAfter(Date.parse('2026-07-20T23:59:00Z')).getTime() >= Date.parse('2026-07-20T23:59:00Z'));
  check('month/year rollover is handled',
    at('2026-12-31T09:00:00Z') === '2027-01-01T05:00:00.000Z', at('2026-12-31T09:00:00Z'));
}
{
  const FIELD = read('src/components/admin/ArticleScheduleField.tsx');
  check('the picker shows the REAL go-live, not the requested time', FIELD.includes('nextPublishCheckAfter'));
  check('the picker says plainly when it is not the time typed in', FIELD.includes('not at the time above'));
  check('the picker explains the once-a-day check', /only checks for due articles once a day/.test(FIELD));
  check('the warning is visual (amber block), not a tooltip', FIELD.includes("data-testid=\"article-schedule-golive\""));
}

console.log('\n=== 11. Wiring: migration 198 ===');
const mig = read('supabase/migrations/198_article_scheduled_publish.sql');
check('adds scheduled_at idempotently', /ALTER TABLE articles ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ/.test(mig));
check('indexes the cron predicate', /CREATE INDEX IF NOT EXISTS idx_articles_scheduled/.test(mig));
check('the index is PARTIAL on status=scheduled', /WHERE status = 'scheduled'/.test(mig));
check('migration is additive only (no DROP/DELETE)', !/\b(DROP|DELETE|TRUNCATE)\b/i.test(mig));

console.log('\n=== 12. Wiring: admin editor UI ===');
const editPage = read('app/admin/articles/[id]/page.tsx');
const newPage  = read('app/admin/articles/new/page.tsx');
const field    = read('src/components/admin/ArticleScheduleField.tsx');
for (const [label, src] of [['edit', editPage], ['new', newPage]] as const) {
  check(`${label} page renders the picker only when scheduled`, /status === 'scheduled' && \(\s*<ArticleScheduleField/.test(src));
  check(`${label} page converts local -> UTC on save`, /scheduled_at: status === 'scheduled' \? toUtcIso\(scheduledAt\) : null/.test(src));
  check(`${label} page blocks scheduling with no time`, /status === 'scheduled' && !scheduledAt/.test(src));
  check(`${label} page offers the Scheduled option`, /<option value="scheduled">Scheduled<\/option>/.test(src));
  check(`${label} page requires a writer to schedule`, /status === 'published' \|\| status === 'scheduled'\) && !writerId/.test(src));
}
check('edit page loads the stored time into the picker', /setScheduledAt\(toLocalInputValue\(a\.scheduled_at\)\)/.test(editPage));
check('edit page re-syncs status from the save response', /if \(saved\?\.status && saved\.status !== status\)/.test(editPage));
check('edit page auto-save carries scheduledAt in its deps', /body, status, scheduledAt, featured/.test(editPage));
check('picker round-trips UTC -> local input text', /export function toLocalInputValue/.test(field));
check('picker converts local input text -> UTC', /export function toUtcIso/.test(field));
check('picker names the timezone (09:00 is ambiguous otherwise)', /resolvedOptions\(\)\.timeZone/.test(field));
check('picker warns when the chosen time is already past', /That time has already passed/.test(field));

console.log('\n=== 13. Local-vs-UTC display in the admin list ===');
const listPage = read('app/admin/articles/page.tsx');
check('list selects scheduled_at', /scheduled_at/.test(listPage));
check('list tolerates the column being absent (pre-migration)', /if \(error\) \(\{ data \} = await sel\(BASE\)\)/.test(listPage));
check('list shows the scheduled time for scheduled rows', /a\.status === 'scheduled' && a\.scheduled_at/.test(listPage));
check('list renders that time in the VIEWER zone, not the server zone', /<LocalDateTime iso=\{a\.scheduled_at\}/.test(listPage));

console.log('\n=== 14. Public exposure is unchanged (only published is public) ===');
const cms = read('src/shared/cms/index.ts');
check('getPublishedArticles still gates on published', /getPublishedArticles[\s\S]{0,400}\.eq\('status', 'published'\)/.test(cms));
check('getArticleBySlug still gates on published', /getArticleBySlug\(slug: string\)[\s\S]{0,400}\.eq\('status', 'published'\)/.test(cms));
check('Article type carries scheduled_at', /scheduled_at\?: string \| null/.test(cms));
const sitemap = read('app/sitemap.ts');
check('sitemap still lists published only', /\.eq\('status', 'published'\)/.test(sitemap));

console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
if (fail) { console.log('Failures: ' + fails.join(' | ')); process.exit(1); }
