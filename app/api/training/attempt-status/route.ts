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
  return NextResponse.json(result);
}
