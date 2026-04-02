import { NextRequest, NextResponse } from 'next/server';
import { registerStudent } from '@/src/lib/sheets';
import { getServerClient } from '@/src/lib/supabase';
import bcrypt from 'bcryptjs';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      name?: string;
      email?: string;
      course?: string;
      phone?: string;
      password?: string;
    };
    const { name, email, course, phone, password } = body;

    if (!name || !email || !course) {
      return NextResponse.json(
        { success: false, error: 'name, email, and course are required' },
        { status: 400 },
      );
    }
    if (!password || password.length < 8) {
      return NextResponse.json(
        { success: false, error: 'Password must be at least 8 characters.' },
        { status: 400 },
      );
    }

    // Register via Apps Script (creates the Sheets row and sends the reg ID email)
    const result = await registerStudent(name.trim(), email.trim().toLowerCase(), course.trim());

    if (!result.success) {
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

    // Persist optional extras in Supabase (phone + password)
    // These tables may not exist yet — fail gracefully if they don't.
    try {
      const sb = getServerClient();
      const registrationId: string = (result.data as { registrationId?: string })?.registrationId ?? '';

      if (registrationId) {
        // Always save email + regId to lookup table (enables "login with email" later)
        await sb.from('training_registrations_meta').upsert({
          registration_id: registrationId,
          email: email.trim().toLowerCase(),
          ...(phone?.trim() ? { phone: phone.trim() } : {}),
        }, { onConflict: 'registration_id' });

        // Store hashed password (required at registration)
        const hash = await bcrypt.hash(password!, 10);
        await sb.from('training_passwords').upsert({
          registration_id: registrationId,
          password_hash: hash,
        }, { onConflict: 'registration_id' });
      }
    } catch {
      // Non-fatal — registration still succeeded in Sheets
    }

    return NextResponse.json({ success: true, data: result.data });
  } catch {
    return NextResponse.json(
      { success: false, error: 'An unexpected error occurred.' },
      { status: 500 },
    );
  }
}
