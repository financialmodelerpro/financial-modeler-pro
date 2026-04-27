import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/shared/auth';
import { countSegment, SEGMENTS, type SegmentKey } from '@/src/lib/newsletter/segments';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if ((session?.user as { role?: string } | undefined)?.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const segment = (req.nextUrl.searchParams.get('segment') ?? 'all_active') as SegmentKey;
  const targetHub = (req.nextUrl.searchParams.get('targetHub') ?? 'all') as 'training' | 'modeling' | 'all';

  if (!SEGMENTS.find(s => s.key === segment)) {
    return NextResponse.json({ error: 'Invalid segment' }, { status: 400 });
  }
  if (!['training', 'modeling', 'all'].includes(targetHub)) {
    return NextResponse.json({ error: 'Invalid targetHub' }, { status: 400 });
  }

  const count = await countSegment(segment, targetHub);
  return NextResponse.json({ count, segments: SEGMENTS });
}
