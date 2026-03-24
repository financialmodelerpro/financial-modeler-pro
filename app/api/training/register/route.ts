import { NextRequest, NextResponse } from 'next/server';
import { registerStudent } from '@/src/lib/sheets';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { name?: string; email?: string; course?: string };
    const { name, email, course } = body;

    if (!name || !email || !course) {
      return NextResponse.json(
        { success: false, error: 'name, email, and course are required' },
        { status: 400 },
      );
    }

    const result = await registerStudent(name.trim(), email.trim().toLowerCase(), course.trim());

    if (!result.success) {
      // Detect duplicate: Apps Script may return duplicate:true, or mention it in the error message
      const errorLower = (result.error ?? '').toLowerCase();
      const isDuplicate =
        result.duplicate === true ||
        errorLower.includes('already') ||
        errorLower.includes('duplicate') ||
        errorLower.includes('exists') ||
        errorLower.includes('registered');
      return NextResponse.json(
        { success: false, duplicate: isDuplicate },
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
