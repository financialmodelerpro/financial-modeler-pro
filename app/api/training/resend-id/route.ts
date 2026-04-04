import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/lib/shared/supabase';
import { sendEmail, FROM } from '@/src/lib/email/sendEmail';
import { resendRegistrationIdTemplate } from '@/src/lib/email/templates/resendRegistrationId';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { email?: string };
    const email = body.email?.trim().toLowerCase();

    if (!email) {
      return NextResponse.json(
        { success: false, error: 'email is required' },
        { status: 400 },
      );
    }

    const sb = getServerClient();

    // Look up registration ID from Supabase
    const { data } = await sb
      .from('training_registrations_meta')
      .select('registration_id')
      .eq('email', email)
      .maybeSingle();

    if (!data?.registration_id) {
      return NextResponse.json({ success: false, notFound: true }, { status: 400 });
    }

    const { subject, html, text } = resendRegistrationIdTemplate({
      registrationId: data.registration_id,
    });
    await sendEmail({ to: email, subject, html, text, from: FROM.training });

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { success: false, error: 'An unexpected error occurred.' },
      { status: 500 },
    );
  }
}
