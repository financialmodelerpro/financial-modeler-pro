import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getStudentProgress } from '@/src/lib/sheets';

function emptyProgress(email: string, registrationId: string) {
  return {
    student: {
      name: registrationId,
      email,
      registrationId,
      course: '3sfm',
      registeredAt: '',
    },
    sessions: [],
    finalPassed: false,
    certificateIssued: false,
  };
}

export async function GET(req: NextRequest) {
  // ── Resolve credentials (cookie first, query param fallback) ─────────────────
  let email = '';
  let registrationId = '';

  try {
    const cookieStore = await cookies();
    const raw = cookieStore.get('training_session')?.value;
    if (raw) {
      const parsed = JSON.parse(raw) as { email?: string; registrationId?: string };
      email = parsed.email ?? '';
      registrationId = parsed.registrationId ?? '';
    }
  } catch { /* ignore */ }

  if (!email || !registrationId) {
    email          = req.nextUrl.searchParams.get('email')          ?? '';
    registrationId = req.nextUrl.searchParams.get('registrationId') ?? '';
  }

  if (!email || !registrationId) {
    return NextResponse.json(
      { success: false, error: 'Not authenticated.' },
      { status: 401 },
    );
  }

  const cleanEmail = email.trim().toLowerCase();
  const cleanRegId = registrationId.trim();

  // ── Fetch progress — always return 200, never hard-error ────────────────────
  try {
    const result = await getStudentProgress(cleanEmail, cleanRegId);

    if (result.success && result.data) {
      return NextResponse.json({ success: true, data: result.data });
    }

    // Apps Script returned success:false or data was empty — serve empty progress
    console.warn('[training/progress] Apps Script returned:', result.success, result.error);
    return NextResponse.json({
      success: true,
      fallback: true,
      data: emptyProgress(cleanEmail, cleanRegId),
    });
  } catch (err) {
    console.error('[training/progress] Unexpected error:', err);
    return NextResponse.json({
      success: true,
      fallback: true,
      data: emptyProgress(cleanEmail, cleanRegId),
    });
  }
}
