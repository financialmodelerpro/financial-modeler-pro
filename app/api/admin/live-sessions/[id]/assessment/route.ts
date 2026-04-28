import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import {
  getAssessment,
  saveAssessment,
  deleteAssessment,
  type LiveSessionQuestion,
} from '@/src/hubs/training/lib/assessment/liveSessionAssessments';

export const dynamic = 'force-dynamic';

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as { role?: string }).role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return null;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const deny = await requireAdmin();
  if (deny) return deny;
  const { id } = await params;
  const assessment = await getAssessment(id);
  return NextResponse.json({ assessment });
}

interface SavePayload {
  enabled?: boolean;
  questions?: LiveSessionQuestion[];
  pass_threshold?: number;
  max_attempts?: number;
  timer_minutes?: number | null;
  require_watch_before_assessment?: boolean;
  watch_threshold?: number;
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const deny = await requireAdmin();
  if (deny) return deny;
  const { id } = await params;
  const body = (await req.json()) as SavePayload;

  try {
    const saved = await saveAssessment(id, body);
    return NextResponse.json({ assessment: saved });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export const POST = PUT;

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const deny = await requireAdmin();
  if (deny) return deny;
  const { id } = await params;
  await deleteAssessment(id);
  return NextResponse.json({ ok: true });
}
