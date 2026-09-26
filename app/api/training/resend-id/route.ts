/**
 * POST /api/training/resend-id
 * Emails a student their Registration ID ("Forgot my Registration ID"; the
 * admin Students page uses it too).
 *
 * Body: { email: string }
 *
 * Rebuilt 2026-09-26 (studentLookup.ts has the measured reason): the email is
 * normalised; an email on MORE THAN ONE account gets every one of its IDs
 * (it used to read as "not found", because a single-row lookup returns
 * nothing when there are two); refusals are logged with their reason; sends
 * are rate limited per email and per address. The response shape the two
 * callers read is unchanged: { success } and, when nothing matches,
 * { success: false, notFound: true }.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/core/db/supabase';
import { sendEmail, FROM } from '@/src/shared/email/sendEmail';
import { resendRegistrationIdTemplate } from '@/src/shared/email/templates/resendRegistrationId';
import { rateLimited } from '@/src/shared/api/rateLimit';
import { accountsForEmail, normEmail, maskEmail } from '@/src/hubs/training/lib/auth/studentLookup';

function clientIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0].trim() || req.headers.get('x-real-ip') || 'unknown';
}

export async function POST(req: NextRequest) {
  let body: { email?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, error: 'Invalid request.' }, { status: 400 }); }
  const email = normEmail(body.email);
  if (!email) return NextResponse.json({ success: false, error: 'Enter the email address you registered with.' }, { status: 400 });

  if (rateLimited('training-resend-id-ip', clientIp(req), 20, 15 * 60_000)
    || rateLimited('training-resend-id-email', email, 5, 15 * 60_000)) {
    console.warn('[resend-id] refused: rate_limited');
    return NextResponse.json({ success: false, rateLimited: true, error: 'Several emails were sent in the last few minutes. Please check your inbox and spam folder, or wait 15 minutes.' }, { status: 429 });
  }

  try {
    const sb = getServerClient();
    const accounts = await accountsForEmail(sb, email);
    if (accounts.length === 0) {
      console.warn('[resend-id] refused: not_found');
      return NextResponse.json({ success: false, notFound: true }, { status: 400 });
    }

    const ids = accounts.map((a) => a.registration_id);
    const { subject, html, text } = await resendRegistrationIdTemplate({
      name: accounts[0].name ?? undefined,
      registrationId: ids.join(', '),
    });
    const sent = await sendEmail({ to: email, subject, html, text, from: FROM.training });
    console.info(`[resend-id] sent ${ids.length} id(s), provider id ${sent.id ?? 'none'}`);
    return NextResponse.json({ success: true, sentTo: maskEmail(email) });
  } catch (e) {
    console.error('[resend-id] failed:', e);
    return NextResponse.json({ success: false, error: 'We could not send the email just now. Please try again in a minute, or contact support@financialmodelerpro.com.' }, { status: 502 });
  }
}
