import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getAllAttemptsForSession } from '@/src/hubs/training/lib/assessment/liveSessionAssessments';

export const dynamic = 'force-dynamic';

interface PauseEntry { pausedAt: string; resumedAt: string; durationSeconds: number }

/**
 * Heuristic: flag attempts whose pause cadence looks suspicious. Triggers on
 * either an unusually short average pause duration (likely scripted toggling)
 * or two pauses bunched within 30 seconds of each other. Conservative by
 * design - the UI surfaces this for human review, it doesn't take action.
 */
function isPauseSuspicious(log: PauseEntry[]): boolean {
  if (!Array.isArray(log) || log.length < 2) return false;
  const avgDur = log.reduce((s, p) => s + (Number(p.durationSeconds) || 0), 0) / log.length;
  if (avgDur > 0 && avgDur < 5) return true;
  for (let i = 1; i < log.length; i++) {
    const prevResumed = new Date(log[i - 1].resumedAt).getTime();
    const thisPaused  = new Date(log[i].pausedAt).getTime();
    if (Number.isFinite(prevResumed) && Number.isFinite(thisPaused) && thisPaused - prevResumed < 30_000) {
      return true;
    }
  }
  return false;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as { role?: string }).role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  const attempts = await getAllAttemptsForSession(id);

  const enriched = attempts.map(a => ({
    ...a,
    pause_summary: a.pause_count > 0
      ? `${a.pause_count} pause${a.pause_count === 1 ? '' : 's'}, ${a.total_paused_seconds}s total`
      : null,
    pause_flagged: isPauseSuspicious(a.pause_log ?? []),
  }));

  return NextResponse.json({ attempts: enriched });
}
