import { NextRequest, NextResponse } from 'next/server';
import { getAttemptStatus } from '@/src/lib/sheets';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const tabKey = searchParams.get('tabKey');
  const email  = searchParams.get('email');
  const regId  = searchParams.get('regId');

  if (!tabKey || !email || !regId) {
    return NextResponse.json({ success: false, error: 'Missing tabKey, email, or regId' }, { status: 400 });
  }

  const result = await getAttemptStatus(tabKey, email, regId);

  if (!result.success) {
    return NextResponse.json({ success: false, error: result.error ?? 'Failed to load attempt status' });
  }

  // Apps Script may return fields at root level rather than nested under `data`
  if (!result.data) {
    const raw = result as unknown as Record<string, unknown>;
    const data = {
      tabKey:          raw.tabKey          ?? tabKey,
      attempts:        raw.attempts        ?? 0,
      maxAttempts:     raw.maxAttempts     ?? 3,
      passed:          raw.passed          ?? false,
      lastScore:       raw.lastScore,
      lastCompletedAt: raw.lastCompletedAt,
      canAttempt:      raw.canAttempt      ?? true,
    };
    return NextResponse.json({ success: true, data });
  }

  return NextResponse.json(result);
}
