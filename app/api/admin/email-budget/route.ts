import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/core/db/supabase';
import { adminEmail } from '@/src/hubs/training/lib/liveCourse/adminGuard';
import { todayUsage, announcementAllowance, EMAIL_SETTING_KEYS } from '@/src/shared/email/emailBudget';
import { activeStudentCounts } from '@/src/hubs/training/lib/announcements/audience';
import { listJobs } from '@/src/hubs/training/lib/announcements/queue';

export const dynamic = 'force-dynamic';

/**
 * GET   today's email usage against the daily limit (system / announcement),
 *       the announcement allowance left, active and inactive students, and the
 *       announcement queue's progress.
 * PATCH { dailyLimit?, announcementCap?, activeDays? } the settings (training_settings).
 */
export async function GET() {
  if (!await adminEmail()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const sb = getServerClient();
  const usage = await todayUsage(sb);
  const [students, jobs] = await Promise.all([activeStudentCounts(sb, usage.activeDays), listJobs(sb)]);
  return NextResponse.json({ usage, allowance: announcementAllowance(usage), students, jobs });
}

export async function PATCH(req: NextRequest) {
  if (!await adminEmail()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const rows: { key: string; value: string }[] = [];
  const add = (field: string, key: string, min: number, max: number) => {
    if (body[field] === undefined) return;
    const n = Math.round(Number(body[field]));
    if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${field} must be a whole number from ${min} to ${max}.`);
    rows.push({ key, value: String(n) });
  };
  try {
    add('dailyLimit', EMAIL_SETTING_KEYS.dailyLimit, 1, 100000);
    add('announcementCap', EMAIL_SETTING_KEYS.announcementCap, 0, 100000);
    add('activeDays', EMAIL_SETTING_KEYS.activeDays, 1, 3650);
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }
  if (!rows.length) return NextResponse.json({ ok: true });
  const { error } = await getServerClient().from('training_settings').upsert(rows, { onConflict: 'key' });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
