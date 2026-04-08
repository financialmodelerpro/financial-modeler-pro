import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/shared/auth';
import { getAppsScriptUrl } from '@/src/lib/training/sheets';

/**
 * POST /api/admin/reset-attempts
 * Calls Apps Script resetAttempts action to clear a student's
 * assessment score/attempts for a specific session or all sessions.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as { role?: string }).role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = await req.json() as { regId?: string; tabKey?: string; course?: string };
    const { regId, tabKey, course } = body;

    if (!regId || !tabKey) {
      return NextResponse.json({ success: false, error: 'regId and tabKey required' }, { status: 400 });
    }

    const url = await getAppsScriptUrl();
    if (!url) {
      return NextResponse.json({ success: false, error: 'Apps Script URL not configured' }, { status: 500 });
    }

    console.log('[reset-attempts] Calling Apps Script:', { regId, tabKey, course });

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'resetAttempts',
        regId,
        tabKey,
        course: course ?? '',
      }),
      cache: 'no-store',
    });

    const data = await res.json() as { success: boolean; error?: string; message?: string };
    console.log('[reset-attempts] Apps Script response:', data);

    if (!data.success) {
      return NextResponse.json({ success: false, error: data.error ?? 'Reset failed' });
    }

    return NextResponse.json({ success: true, message: data.message ?? 'Attempts reset successfully' });
  } catch (err) {
    console.error('[reset-attempts] Error:', err);
    return NextResponse.json({ success: false, error: 'An unexpected error occurred' }, { status: 500 });
  }
}
