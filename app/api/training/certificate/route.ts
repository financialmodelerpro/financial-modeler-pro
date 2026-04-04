import { NextRequest, NextResponse } from 'next/server';
import { getCertificatesByEmail, getCertificateByRegId } from '@/src/lib/training/sheets';

// Public endpoint — no auth required
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const email  = searchParams.get('email');
    const regId  = searchParams.get('regId');
    const course = searchParams.get('course');

    // Lookup by regId + course (public certificate page)
    if (regId && course) {
      const result = await getCertificateByRegId(regId.trim(), course.trim());
      if (!result.success || !result.data) {
        return NextResponse.json({ success: false, error: 'Certificate not found.' }, { status: 404 });
      }
      return NextResponse.json({ success: true, data: result.data });
    }

    // Lookup by email (dashboard use)
    if (!email) {
      return NextResponse.json(
        { success: false, error: 'Provide either email or regId+course.' },
        { status: 400 },
      );
    }

    const result = await getCertificatesByEmail(email.trim().toLowerCase());
    if (!result.success) {
      return NextResponse.json(
        { success: false, error: 'Failed to fetch certificates.' },
        { status: 400 },
      );
    }

    return NextResponse.json({ success: true, data: result.data ?? [] });
  } catch {
    return NextResponse.json(
      { success: false, error: 'An unexpected error occurred.' },
      { status: 500 },
    );
  }
}
