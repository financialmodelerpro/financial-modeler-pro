import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/shared/auth';
import { getStudentRoster } from '@/src/lib/training/studentRoster';
import { getServerClient } from '@/src/lib/shared/supabase';

export const revalidate = 0;

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as { role?: string }).role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const range = req.nextUrl.searchParams.get('range') ?? '90'; // days

  const [allStudents, profilesRes, activeRes] = await Promise.all([
    getStudentRoster(),
    getServerClient().from('student_profiles').select('registration_id,location,last_active_at,streak_days,total_points'),
    getServerClient().from('student_profiles')
      .select('registration_id')
      .gte('last_active_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()),
  ]);

  const profiles     = profilesRes.data ?? [];
  const activeIds    = new Set((activeRes.data ?? []).map((r: { registration_id: string }) => r.registration_id));

  // ── Overview stats ────────────────────────────────────────────────────────
  const total = allStudents.length;
  const activeWeek = activeIds.size;
  const certified = allStudents.filter(s => s.finalPassed || s.certificateIssued).length;
  const completionRate = total > 0 ? Math.round((certified / total) * 100) : 0;
  const courseCodes = (s: { course: string }) => s.course.split(',').map(c => c.trim());
  const sfm = allStudents.filter(s => courseCodes(s).includes('3SFM'));
  const bvm = allStudents.filter(s => courseCodes(s).includes('BVM'));

  // ── Registration trends (last 12 weeks) ───────────────────────────────────
  const now = new Date();
  const cutoffDays = parseInt(range) || 90;
  const cutoff = new Date(now.getTime() - cutoffDays * 86400000);
  const rangeStudents = allStudents.filter(s => s.registeredAt && new Date(s.registeredAt) >= cutoff);

  // Group by week
  const weeklyMap: Record<string, { sfm: number; bvm: number }> = {};
  for (const s of rangeStudents) {
    const d = new Date(s.registeredAt);
    // Round to nearest Monday
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(d); monday.setDate(diff); monday.setHours(0,0,0,0);
    const key = monday.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
    if (!weeklyMap[key]) weeklyMap[key] = { sfm: 0, bvm: 0 };
    if (s.course === '3SFM') weeklyMap[key].sfm++;
    else if (s.course === 'BVM') weeklyMap[key].bvm++;
  }
  const trends = Object.entries(weeklyMap)
    .sort(([a], [b]) => new Date('1 ' + a).getTime() - new Date('1 ' + b).getTime())
    .map(([week, v]) => ({ week, sfm: v.sfm, bvm: v.bvm, total: v.sfm + v.bvm }));

  // ── Session completion rates (approximate from sessionsPassedCount) ────────
  const SFM_SESSIONS = 17;
  const sessionCompletion = Array.from({ length: SFM_SESSIONS + 1 }, (_, i) => {
    const n = i + 1;
    const label = n > SFM_SESSIONS ? 'Final' : `S${n}`;
    const base = sfm.length;
    const passed = n <= SFM_SESSIONS
      ? sfm.filter(s => (s.sessionsPassedCount ?? 0) >= n).length
      : sfm.filter(s => s.finalPassed).length;
    const pct = base > 0 ? Math.round((passed / base) * 100) : 0;
    return { session: label, pct, passed, total: base };
  });

  // ── Geographic breakdown ───────────────────────────────────────────────────
  const geoMap: Record<string, number> = {};
  for (const p of profiles) {
    if (p.location) {
      const loc = (p.location as string).trim();
      geoMap[loc] = (geoMap[loc] ?? 0) + 1;
    }
  }
  const geo = Object.entries(geoMap)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 25)
    .map(([location, count]) => ({ location, count }));

  // ── Dropout funnel (3SFM) ─────────────────────────────────────────────────
  const funnelBase = sfm.length;
  const funnelSteps = [
    { label: 'Registered',       count: funnelBase },
    { label: 'Started S1',        count: sfm.filter(s => (s.sessionsPassedCount ?? 0) >= 1).length },
    { label: '25% (S4+)',          count: sfm.filter(s => (s.sessionsPassedCount ?? 0) >= 4).length },
    { label: '50% (S9+)',          count: sfm.filter(s => (s.sessionsPassedCount ?? 0) >= 9).length },
    { label: '75% (S13+)',         count: sfm.filter(s => (s.sessionsPassedCount ?? 0) >= 13).length },
    { label: 'All Sessions (S17)', count: sfm.filter(s => (s.sessionsPassedCount ?? 0) >= 17).length },
    { label: 'Certified',          count: sfm.filter(s => s.finalPassed || s.certificateIssued).length },
  ];
  const funnel = funnelSteps.map(f => ({
    ...f,
    pct: funnelBase > 0 ? Math.round((f.count / funnelBase) * 100) : 0,
  }));

  return NextResponse.json({
    overview: { total, activeWeek, completionRate, certified, sfmEnrolled: sfm.length, bvmEnrolled: bvm.length },
    trends,
    sessionCompletion,
    geo,
    funnel,
    dataAvailable: true,
  });
}
