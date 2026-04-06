/**
 * GET /api/auth/confirm-email?token=xxx
 *
 * Verifies the email confirmation token for the Modeling Hub.
 * On success: marks user email_confirmed=true, redirects to signin with confirmed=true.
 * On failure: redirects to signin with error=invalid-token.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyConfirmationToken } from '@/src/lib/shared/emailConfirmation';
import { serverClient } from '@/src/lib/shared/supabase';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.financialmodelerpro.com';

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token') ?? '';

  if (!token) {
    return NextResponse.redirect(`${APP_URL}/signin?error=invalid-token`);
  }

  const result = await verifyConfirmationToken(token, 'modeling');

  if (!result.valid || !result.email) {
    return NextResponse.redirect(`${APP_URL}/signin?error=invalid-token`);
  }

  // Update user record
  const { error } = await serverClient
    .from('users')
    .update({
      email_confirmed: true,
      confirmed_at: new Date().toISOString(),
    })
    .eq('email', result.email);

  if (error) {
    console.error('[auth/confirm-email] update error:', error);
    return NextResponse.redirect(`${APP_URL}/signin?error=invalid-token`);
  }

  return NextResponse.redirect(`${APP_URL}/signin?confirmed=true`);
}
