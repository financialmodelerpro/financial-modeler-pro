import { NextRequest, NextResponse } from 'next/server';
import { resendRegistrationId } from '@/src/lib/sheets';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { email?: string };
    const { email } = body;

    if (!email) {
      return NextResponse.json(
        { success: false, error: 'email is required' },
        { status: 400 },
      );
    }

    const result = await resendRegistrationId(email.trim().toLowerCase());

    if (!result.success) {
      // Detect "not found": Apps Script may return notFound:true, or mention it in the error message
      const errorLower = (result.error ?? '').toLowerCase();
      const isNotFound =
        result.notFound === true ||
        errorLower.includes('not found') ||
        errorLower.includes('no account') ||
        errorLower.includes('not registered') ||
        errorLower.includes('does not exist');
      return NextResponse.json(
        { success: false, notFound: isNotFound },
        { status: 400 },
      );
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { success: false, error: 'An unexpected error occurred.' },
      { status: 500 },
    );
  }
}
