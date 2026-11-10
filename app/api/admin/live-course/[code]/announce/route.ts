import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/core/db/supabase';
import { adminEmail } from '@/src/hubs/training/lib/liveCourse/adminGuard';
import { getLiveCourseSettings, isLiveCourseRow, isPubliclyVisible, listCourseSessions } from '@/src/hubs/training/lib/liveCourse/courseSettings';
import { coursePagePath } from '@/src/hubs/training/lib/liveCourse/paths';
import { courseTimeLabel, KSA_TZ } from '@/src/hubs/training/lib/liveCourse/time';
import { audienceFrom, resolveAudience } from '@/src/hubs/training/lib/announcements/audience';
import { dispatchAnnouncement, NAME_TOKEN } from '@/src/hubs/training/lib/announcements/queue';
import { realQueueDeps } from '@/src/hubs/training/lib/announcements/realDeps';
import { todayUsage, announcementAllowance } from '@/src/shared/email/emailBudget';
import { liveCourseAnnouncementTemplate } from '@/src/shared/email/templates/liveCourseAnnouncement';
import { FROM } from '@/src/shared/email/sendEmail';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const LEARN_URL = process.env.NEXT_PUBLIC_LEARN_URL ?? 'https://learn.financialmodelerpro.com';

/**
 * ONE announcement for a whole live course (2026-11-10, founder): title,
 * tagline, start date, the full schedule in KSA and the Enrol link to the
 * course page. Course sessions never announce themselves.
 *
 * GET  ?audience=&courseCode=&days=   the recipient count (after unsubscribed
 *                                      and bounced are excluded) and today's budget
 * POST { audience, courseCode?, days? } sends: today's allowance now, the rest
 *                                      queued for the next days (announcements/queue.ts)
 */
async function load(code: string) {
  const sb = getServerClient();
  const course = await getLiveCourseSettings(sb, code);
  if (!isLiveCourseRow(course)) return null;
  return { sb, course, sessions: await listCourseSessions(sb, course.courseCode) };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  if (!await adminEmail()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const d = await load((await params).code);
  if (!d) return NextResponse.json({ error: 'Not a live course' }, { status: 404 });
  const sp = req.nextUrl.searchParams;
  const usage = await todayUsage(d.sb);
  const spec = audienceFrom({ audience: sp.get('audience'), courseCode: sp.get('courseCode') ?? d.course.courseCode, days: sp.get('days') });
  const aud = await resolveAudience(d.sb, spec, usage.activeDays);
  return NextResponse.json({ spec, counts: aud.counts, usage, allowance: announcementAllowance(usage), published: isPubliclyVisible(d.course) });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const by = await adminEmail();
  if (!by) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const d = await load((await params).code);
  if (!d) return NextResponse.json({ error: 'Not a live course' }, { status: 404 });
  if (!isPubliclyVisible(d.course)) return NextResponse.json({ error: 'Publish the course before announcing it.' }, { status: 400 });
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const usage = await todayUsage(d.sb);
  const spec = audienceFrom({ audience: body.audience, courseCode: body.courseCode ?? d.course.courseCode, days: body.days });
  const aud = await resolveAudience(d.sb, spec, usage.activeDays);
  if (!aud.recipients.length) return NextResponse.json({ error: 'No recipients for this audience.' }, { status: 400 });

  const dated = d.sessions.filter((s) => s.scheduled_datetime);
  const first = dated[0]?.scheduled_datetime ?? null;
  const { subject, html } = await liveCourseAnnouncementTemplate({
    courseTitle: d.course.title,
    tagline: d.course.tagline,
    startDate: first ? new Date(first).toLocaleDateString('en-GB', { timeZone: KSA_TZ, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).replace(',', '') : '',
    sessions: d.sessions.map((s, i) => ({ label: `Session ${s.course_session_no ?? i + 1}`, title: s.title, when: courseTimeLabel(s.scheduled_datetime, { year: true }) })),
    courseUrl: `${LEARN_URL}${coursePagePath(d.course.courseCode)}`,
    cta: 'Enrol in the course',
  });
  if (!html.includes(NAME_TOKEN)) return NextResponse.json({ error: 'Template error: no name token.' }, { status: 500 });
  const result = await dispatchAnnouncement(d.sb, realQueueDeps(d.sb), {
    kind: 'course', ref: d.course.courseCode, label: `${d.course.courseCode} course announcement`, audience: spec, subject, html, from: FROM.training, createdBy: by,
  }, aud.recipients);
  return NextResponse.json({ ok: true, counts: aud.counts, ...result });
}
