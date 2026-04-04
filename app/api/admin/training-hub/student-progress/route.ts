import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/shared/auth';
import { getStudentProgress } from '@/src/lib/training/sheets';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as any).role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const email = req.nextUrl.searchParams.get('email');
  const regId  = req.nextUrl.searchParams.get('regId');
  if (!email || !regId) {
    return NextResponse.json({ error: 'email and regId required' }, { status: 400 });
  }
  const result = await getStudentProgress(email, regId);
  if (!result.success) {
    return NextResponse.json({ error: result.error ?? 'Failed to fetch progress' }, { status: 400 });
  }
  return NextResponse.json({ progress: result.data });
}
