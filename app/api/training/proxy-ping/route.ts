import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/shared/auth';

/** Ping a Google Apps Script URL server-side (avoids CORS). Admin only. */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as any).role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const rawUrl = req.nextUrl.searchParams.get('url');
  if (!rawUrl) return NextResponse.json({ error: 'url required' }, { status: 400 });

  try {
    const res = await fetch(rawUrl, {
      method: 'GET',
      signal: AbortSignal.timeout(8000),
      cache: 'no-store',
    });
    // Apps Script returns 200 even for unknown actions - any 2xx means reachable
    if (res.ok) return NextResponse.json({ ok: true });
    return NextResponse.json({ ok: false, status: res.status }, { status: 502 });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'timeout' }, { status: 502 });
  }
}
