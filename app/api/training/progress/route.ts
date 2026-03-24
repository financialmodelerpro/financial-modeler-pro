import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getStudentProgress } from '@/src/lib/sheets';

export async function GET() {
  try {
    const cookieStore = await cookies();
    const raw = cookieStore.get('training_session')?.value;

    if (!raw) {
      return NextResponse.json(
        { success: false, error: 'Not authenticated.' },
        { status: 401 },
      );
    }

    let session: { email: string; registrationId: string };
    try {
      session = JSON.parse(raw) as { email: string; registrationId: string };
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid session.' },
        { status: 401 },
      );
    }

    if (!session.email || !session.registrationId) {
      return NextResponse.json(
        { success: false, error: 'Invalid session.' },
        { status: 401 },
      );
    }

    const result = await getStudentProgress(session.email, session.registrationId);

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: 'Failed to fetch progress.' },
        { status: 400 },
      );
    }

    return NextResponse.json({ success: true, data: result.data });
  } catch {
    return NextResponse.json(
      { success: false, error: 'An unexpected error occurred.' },
      { status: 500 },
    );
  }
}
