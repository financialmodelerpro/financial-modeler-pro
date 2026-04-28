import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getStudentRoster } from '@/src/hubs/training/lib/appsScript/studentRoster';
import { getServerClient } from '@/src/core/db/supabase';

export const revalidate = 0;

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as { role?: string }).role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const sb = getServerClient();

  const [students, feedbackRes] = await Promise.all([
    getStudentRoster(),
    sb.from('session_feedback').select('session_key,rating,comment,registration_id'),
  ]);

  // course is now a comma-joined list of enrolled course codes.
  const codes = (s: { course: string }) => s.course.split(',').map(c => c.trim());
  const sfm = students.filter(s => codes(s).includes('3SFM'));
  const bvm = students.filter(s => codes(s).includes('BVM'));
  const feedbacks = feedbackRes.data ?? [];

  // Aggregate feedback by session_key
  const fbMap: Record<string, { ratings: number[]; comments: string[]; respondents: number }> = {};
  for (const f of feedbacks) {
    if (!fbMap[f.session_key]) fbMap[f.session_key] = { ratings: [], comments: [], respondents: 0 };
    fbMap[f.session_key].ratings.push(f.rating);
    if (f.comment) fbMap[f.session_key].comments.push(f.comment as string);
    fbMap[f.session_key].respondents++;
  }

  // Build per-session stats for 3SFM (S1–S17 + Final)
  const sessions = Array.from({ length: 18 }, (_, i) => {
    const n = i + 1;
    const isFinal = n === 18;
    const sessionKey = `3SFM_S${n}`;
    const label = isFinal ? 'Final' : `S${n}`;

    // Approximate pass rate from sessionsPassedCount
    const base = sfm.length;
    const passed = isFinal
      ? sfm.filter(s => s.finalPassed).length
      : sfm.filter(s => (s.sessionsPassedCount ?? 0) >= n).length;
    const passRate = base > 0 ? Math.round((passed / base) * 100) : 0;

    const fb = fbMap[sessionKey];
    const avgFeedback = fb?.ratings.length
      ? Math.round((fb.ratings.reduce((a, b) => a + b, 0) / fb.ratings.length) * 10) / 10
      : null;

    return {
      sessionKey,
      label,
      isFinal,
      base,
      passed,
      passRate,
      avgFeedback,
      feedbackCount: fb?.respondents ?? 0,
      comments: fb?.comments ?? [],
    };
  });

  // BVM sessions (L1–L7)
  const bvmSessions = Array.from({ length: 7 }, (_, i) => {
    const n = i + 1;
    const isFinal = n === 7;
    const sessionKey = `BVM_L${n}`;
    const label = isFinal ? 'Final' : `L${n}`;
    const base = bvm.length;
    const passed = isFinal
      ? bvm.filter(s => s.finalPassed).length
      : bvm.filter(s => (s.sessionsPassedCount ?? 0) >= n).length;
    const passRate = base > 0 ? Math.round((passed / base) * 100) : 0;
    const fb = fbMap[sessionKey];
    const avgFeedback = fb?.ratings.length
      ? Math.round((fb.ratings.reduce((a, b) => a + b, 0) / fb.ratings.length) * 10) / 10
      : null;
    return { sessionKey, label, isFinal, base, passed, passRate, avgFeedback, feedbackCount: fb?.respondents ?? 0, comments: fb?.comments ?? [] };
  });

  const allSessions = [...sessions, ...bvmSessions];
  const problemSessions = allSessions.filter(s => s.passRate < 60 && s.base > 0);

  return NextResponse.json({ sessions, bvmSessions, problemSessions, dataAvailable: true });
}
