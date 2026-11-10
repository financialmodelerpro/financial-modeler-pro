/**
 * Who an announcement goes to (2026-11-10, founder). ONE resolver for the
 * session announcement and the course announcement, and ONE definition of an
 * "active student", which the admin counts read too.
 *
 * ACTIVE: signed up in the last N days, OR any activity in the last N days
 * (sign-in or any use of the dashboard, a recording watched, an assessment
 * taken, a course or live course enrolment, a live session joined, a model
 * submitted), OR holds at least one certificate. N is the setting
 * active_student_days (default 30, editable in admin). Everyone else is
 * inactive.
 *
 * AUDIENCES: active (default), all, enrolled in a course, not yet enrolled in
 * a course, active in the last N days (custom N).
 *
 * ALWAYS EXCLUDED: an address that unsubscribed (a newsletter row that is not
 * active, with no active row on any hub: an opt-out always wins) and an
 * address that bounced or complained on an earlier announcement or campaign.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export type AudienceKind = 'active' | 'all' | 'enrolled' | 'not_enrolled' | 'active_days';
export interface AudienceSpec { kind: AudienceKind; courseCode?: string | null; days?: number | null }

export const AUDIENCE_LABEL: Record<AudienceKind, string> = {
  active: 'Active students',
  all: 'All students',
  enrolled: 'Enrolled in a course',
  not_enrolled: 'Not yet enrolled in a course',
  active_days: 'Active in the last N days',
};

export interface StudentSignals {
  email: string;
  name: string;
  registrationId: string | null;
  /** Sign-up time (ms). */
  createdAt: number | null;
  /** The latest activity of any kind (ms), or null. */
  lastActivityAt: number | null;
  hasCertificate: boolean;
  /** Course codes enrolled in, upper case. */
  courses: Set<string>;
}

const DAY = 86_400_000;

/** THE active rule. Pure. */
export function isActiveStudent(s: Pick<StudentSignals, 'createdAt' | 'lastActivityAt' | 'hasCertificate'>, now: number, days: number): boolean {
  const since = now - Math.max(1, days) * DAY;
  return (s.createdAt != null && s.createdAt >= since) || (s.lastActivityAt != null && s.lastActivityAt >= since) || s.hasCertificate;
}

/** The audience a spec selects, before exclusions. Pure. */
export function selectAudience(students: StudentSignals[], spec: AudienceSpec, now: number, activeDays: number): StudentSignals[] {
  const code = (spec.courseCode ?? '').trim().toUpperCase();
  switch (spec.kind) {
    case 'all': return students;
    case 'enrolled': return code ? students.filter((s) => s.courses.has(code)) : [];
    case 'not_enrolled': return code ? students.filter((s) => !s.courses.has(code)) : [];
    case 'active_days': return students.filter((s) => isActiveStudent(s, now, spec.days && spec.days > 0 ? spec.days : activeDays));
    case 'active':
    default: return students.filter((s) => isActiveStudent(s, now, activeDays));
  }
}

/** Unsubscribed and bounced addresses drop out. Pure. */
export function applyExclusions<T extends { email: string }>(list: T[], ex: { unsubscribed: Set<string>; bounced: Set<string> }) {
  const kept: T[] = []; let excludedUnsubscribed = 0, excludedBounced = 0;
  for (const s of list) {
    const e = s.email.trim().toLowerCase();
    if (ex.unsubscribed.has(e)) { excludedUnsubscribed++; continue; }
    if (ex.bounced.has(e)) { excludedBounced++; continue; }
    kept.push(s);
  }
  return { kept, excludedUnsubscribed, excludedBounced };
}

/** Every row of a query, 1000 at a time (PostgREST stops at 1000). */
async function pageAll<R>(build: (from: number, to: number) => PromiseLike<{ data: R[] | null; error: unknown }>): Promise<R[]> {
  const out: R[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error || !data) break;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

const ms = (v: unknown): number | null => { const t = v ? new Date(String(v)).getTime() : NaN; return Number.isFinite(t) ? t : null; };

/**
 * Confirmed students with their signals. Activity is read only from `sinceIso`
 * on (the widest window any audience needs), so a large history costs nothing.
 */
export async function loadStudentSignals(sb: SupabaseClient, sinceIso: string): Promise<StudentSignals[]> {
  const metas = await pageAll<{ email: string | null; name: string | null; registration_id: string | null; created_at: string | null }>((a, b) =>
    sb.from('training_registrations_meta').select('email, name, registration_id, created_at').or('email_confirmed.eq.true,email_confirmed.is.null').order('registration_id').range(a, b));
  const byEmail = new Map<string, StudentSignals>();
  const byReg = new Map<string, StudentSignals>();
  for (const m of metas) {
    const email = (m.email ?? '').trim().toLowerCase();
    if (!email || byEmail.has(email)) continue;
    const s: StudentSignals = { email, name: (m.name ?? '').trim(), registrationId: m.registration_id, createdAt: ms(m.created_at), lastActivityAt: null, hasCertificate: false, courses: new Set() };
    byEmail.set(email, s);
    if (m.registration_id) byReg.set(m.registration_id, s);
  }
  const touch = (s: StudentSignals | undefined, at: unknown) => { const t = ms(at); if (s && t != null && (s.lastActivityAt == null || t > s.lastActivityAt)) s.lastActivityAt = t; };
  const byE = (e: unknown) => byEmail.get(String(e ?? '').trim().toLowerCase());

  const [enr, profiles, watch, assess, clicks, models, devices, certs] = await Promise.all([
    pageAll<{ registration_id: string; course_code: string; enrolled_at: string | null }>((a, b) => sb.from('training_enrollments').select('registration_id, course_code, enrolled_at').order('registration_id').range(a, b)),
    pageAll<{ registration_id: string; last_active_at: string | null }>((a, b) => sb.from('student_profiles').select('registration_id, last_active_at').gte('last_active_at', sinceIso).order('registration_id').range(a, b)),
    pageAll<{ student_email: string; updated_at: string | null }>((a, b) => sb.from('session_watch_history').select('student_email, updated_at').gte('updated_at', sinceIso).order('id').range(a, b)),
    pageAll<{ email: string; completed_at: string | null }>((a, b) => sb.from('training_assessment_results').select('email, completed_at').gte('completed_at', sinceIso).order('completed_at').range(a, b)),
    pageAll<{ student_email: string; clicked_at: string | null }>((a, b) => sb.from('live_session_join_clicks').select('student_email, clicked_at').gte('clicked_at', sinceIso).order('clicked_at').range(a, b)),
    pageAll<{ email: string; submitted_at: string | null }>((a, b) => sb.from('model_submissions').select('email, submitted_at').gte('submitted_at', sinceIso).order('submitted_at').range(a, b)),
    pageAll<{ identifier: string; created_at: string | null }>((a, b) => sb.from('trusted_devices').select('identifier, created_at').eq('hub', 'training').gte('created_at', sinceIso).order('created_at').range(a, b)),
    pageAll<{ email: string; cert_status: string | null }>((a, b) => sb.from('student_certificates').select('email, cert_status').in('cert_status', ['Issued', 'Forced']).order('email').range(a, b)),
  ]);
  const sinceMs = ms(sinceIso) ?? 0;
  for (const e of enr) {
    const s = byReg.get(e.registration_id);
    if (!s) continue;
    s.courses.add(String(e.course_code).toUpperCase());
    if ((ms(e.enrolled_at) ?? 0) >= sinceMs) touch(s, e.enrolled_at);
  }
  for (const p of profiles) touch(byReg.get(p.registration_id), p.last_active_at);
  for (const w of watch) touch(byE(w.student_email), w.updated_at);
  for (const x of assess) touch(byE(x.email), x.completed_at);
  for (const c of clicks) touch(byE(c.student_email), c.clicked_at);
  for (const m of models) touch(byE(m.email), m.submitted_at);
  for (const d of devices) touch(byE(d.identifier), d.created_at);
  for (const c of certs) { const s = byE(c.email); if (s) s.hasCertificate = true; }
  return [...byEmail.values()];
}

/** Unsubscribed (no active subscriber row left) and bounced or complained addresses. */
export async function loadExclusions(sb: SupabaseClient): Promise<{ unsubscribed: Set<string>; bounced: Set<string> }> {
  const subs = await pageAll<{ email: string; status: string }>((a, b) => sb.from('newsletter_subscribers').select('email, status').order('email').range(a, b));
  const active = new Set(subs.filter((r) => r.status === 'active').map((r) => r.email.trim().toLowerCase()));
  const unsubscribed = new Set(subs.filter((r) => r.status !== 'active').map((r) => r.email.trim().toLowerCase()).filter((e) => !active.has(e)));
  const [annBounced, nlBounced] = await Promise.all([
    pageAll<{ email: string }>((a, b) => sb.from('announcement_recipient_log').select('email').in('status', ['bounced', 'complained']).order('email').range(a, b)),
    pageAll<{ email: string }>((a, b) => sb.from('newsletter_recipient_log').select('email').in('status', ['bounced', 'complained']).order('email').range(a, b)),
  ]);
  const bounced = new Set([...annBounced, ...nlBounced].map((r) => String(r.email ?? '').trim().toLowerCase()).filter(Boolean));
  return { unsubscribed, bounced };
}

export interface ResolvedAudience {
  recipients: { email: string; name: string; registrationId: string | null }[];
  counts: { matched: number; excludedUnsubscribed: number; excludedBounced: number; total: number };
}

/** The recipients of an announcement, with the counts the admin sees before sending. */
export async function resolveAudience(sb: SupabaseClient, spec: AudienceSpec, activeDays: number, now: number = Date.now()): Promise<ResolvedAudience> {
  const window = spec.kind === 'active_days' && spec.days && spec.days > 0 ? spec.days : activeDays;
  const [students, ex] = await Promise.all([loadStudentSignals(sb, new Date(now - Math.max(window, activeDays) * DAY).toISOString()), loadExclusions(sb)]);
  const matched = selectAudience(students, spec, now, activeDays);
  const { kept, excludedUnsubscribed, excludedBounced } = applyExclusions(matched, ex);
  return {
    recipients: kept.map((s) => ({ email: s.email, name: s.name, registrationId: s.registrationId })),
    counts: { matched: matched.length, excludedUnsubscribed, excludedBounced, total: kept.length },
  };
}

/** Active and inactive students (the admin's counts), by the one rule. */
export async function activeStudentCounts(sb: SupabaseClient, activeDays: number, now: number = Date.now()): Promise<{ active: number; inactive: number; total: number }> {
  const students = await loadStudentSignals(sb, new Date(now - activeDays * DAY).toISOString());
  const active = students.filter((s) => isActiveStudent(s, now, activeDays)).length;
  return { active, inactive: students.length - active, total: students.length };
}

/** A spec from a request body or query, defaulting to active students. */
export function audienceFrom(raw: { audience?: unknown; courseCode?: unknown; days?: unknown } | null | undefined): AudienceSpec {
  const k = String(raw?.audience ?? 'active') as AudienceKind;
  const kind: AudienceKind = (['active', 'all', 'enrolled', 'not_enrolled', 'active_days'] as const).includes(k) ? k : 'active';
  const days = Number(raw?.days);
  return { kind, courseCode: raw?.courseCode ? String(raw.courseCode).toUpperCase() : null, days: Number.isFinite(days) && days > 0 ? Math.round(days) : null };
}
