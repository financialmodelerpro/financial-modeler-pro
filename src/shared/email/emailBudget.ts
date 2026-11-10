/**
 * The daily email budget (2026-11-10, founder). The Brevo free plan sends 300
 * emails a day, shared by EVERY email the platform sends. Server only.
 *
 *   - Every send is counted per UTC day as `system` or `announcement`
 *     (`recordEmailSent`, called by the one send path in sendEmail.ts).
 *   - Announcements may use at most `announcement_daily_cap` a day (default
 *     200) AND never more than what is left of the daily limit, so system
 *     emails (enrolment, reminders, reschedule, certificates) always have room
 *     and always go first: they are never held back.
 *   - Settings live in training_settings (editable in admin):
 *       email_daily_limit        default 300
 *       announcement_daily_cap   default 200
 *       active_student_days      default 30 (the "active student" window)
 *
 * Schema tolerant: without mig 255 the counter reads 0 and recording is a
 * no-op, so nothing ever fails because of the budget.
 */
import { getServerClient } from '@/src/core/db/supabase';
import type { SupabaseClient } from '@supabase/supabase-js';

export type EmailKind = 'system' | 'announcement';

export const DEFAULT_DAILY_LIMIT = 300;
export const DEFAULT_ANNOUNCEMENT_CAP = 200;
export const DEFAULT_ACTIVE_DAYS = 30;

export const EMAIL_SETTING_KEYS = {
  dailyLimit: 'email_daily_limit',
  announcementCap: 'announcement_daily_cap',
  activeDays: 'active_student_days',
} as const;

/** The UTC day an email counts towards ("2026-11-10"). */
export function utcDay(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Count `n` sent emails of a kind against today. Never throws, never blocks a send. */
export async function recordEmailSent(kind: EmailKind, n: number = 1, now: Date = new Date(), sb?: SupabaseClient): Promise<void> {
  if (!(n > 0)) return;
  try {
    const { error } = await (sb ?? getServerClient()).rpc('increment_email_usage', { p_day: utcDay(now), p_kind: kind, p_n: Math.round(n) });
    if (error && !/does not exist|schema cache|Could not find/i.test(error.message)) console.warn('[emailBudget] record failed', error.message);
  } catch { /* the budget never blocks an email */ }
}

const positiveInt = (v: unknown, d: number) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= 0 ? n : d; };

export interface EmailSettings { dailyLimit: number; announcementCap: number; activeDays: number }

export async function readEmailSettings(sb: SupabaseClient = getServerClient()): Promise<EmailSettings> {
  const { data } = await sb.from('training_settings').select('key, value').in('key', Object.values(EMAIL_SETTING_KEYS));
  const m = new Map((data ?? []).map((r: { key: string; value: string }) => [r.key, r.value]));
  return {
    dailyLimit: positiveInt(m.get(EMAIL_SETTING_KEYS.dailyLimit), DEFAULT_DAILY_LIMIT),
    announcementCap: positiveInt(m.get(EMAIL_SETTING_KEYS.announcementCap), DEFAULT_ANNOUNCEMENT_CAP),
    activeDays: Math.max(1, positiveInt(m.get(EMAIL_SETTING_KEYS.activeDays), DEFAULT_ACTIVE_DAYS)),
  };
}

export interface EmailUsage extends EmailSettings {
  day: string;
  system: number;
  announcement: number;
  total: number;
  /** False until mig 255 is applied (the counter does not exist yet). */
  tracking: boolean;
}

export async function todayUsage(sb: SupabaseClient = getServerClient(), now: Date = new Date()): Promise<EmailUsage> {
  const settings = await readEmailSettings(sb);
  const day = utcDay(now);
  const { data, error } = await sb.from('email_usage_daily').select('kind, sent').eq('day', day);
  const get = (k: EmailKind) => Number((data ?? []).find((r: { kind: string }) => r.kind === k)?.sent ?? 0);
  const system = error ? 0 : get('system');
  const announcement = error ? 0 : get('announcement');
  return { ...settings, day, system, announcement, total: system + announcement, tracking: !error };
}

/**
 * How many announcement emails may go out right now: the announcement cap
 * left today, and never more than the daily limit left. Pure.
 */
export function announcementAllowance(u: Pick<EmailUsage, 'announcementCap' | 'announcement' | 'dailyLimit' | 'total'>): number {
  return Math.max(0, Math.min(u.announcementCap - u.announcement, u.dailyLimit - u.total));
}
