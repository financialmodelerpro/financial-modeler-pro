/**
 * GET /api/auth/confirm-email?token=xxx
 *
 * Verifies the email confirmation token for the Modeling Hub.
 * On success: marks user email_confirmed=true, marks token used, redirects
 * to signin with confirmed=true.
 * On failure: redirects to signin with error=invalid-token.
 *
 * Token consumption is deferred until the user update succeeds, matching
 * the Training Hub flow. Previously the token was marked used eagerly, so
 * any Supabase failure after that point left the token dead and the user
 * stuck at "invalid token" forever.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyConfirmationToken, markTokenUsed } from '@/src/shared/auth/emailConfirmation';
import { serverClient } from '@/src/core/db/supabase';
import { canEmailRegisterModeling } from '@/src/hubs/modeling/lib/access';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.financialmodelerpro.com';

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token') ?? '';

  if (!token) {
    return NextResponse.redirect(`${APP_URL}/signin?error=invalid-token`);
  }

  const result = await verifyConfirmationToken(token, 'modeling');

  if (!result.valid || !result.email || !result.tokenId) {
    return NextResponse.redirect(`${APP_URL}/signin?error=invalid-token`);
  }

  // Pre-launch gate (migration 136): if the register toggle flipped on
  // between registration and confirmation, block the confirmation unless
  // this email is admin or on the whitelist. Defense-in-depth against
  // stale tokens issued before the lockdown.
  const access = await canEmailRegisterModeling(result.email);
  if (!access.allowed) {
    return NextResponse.redirect(`${APP_URL}/signin?error=invite-only`);
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
    // Leave the token live so the user can click the same link again after
    // the underlying issue is fixed.
    return NextResponse.redirect(`${APP_URL}/signin?error=invalid-token`);
  }

  await markTokenUsed(result.tokenId);
  return NextResponse.redirect(`${APP_URL}/signin?confirmed=true`);
}
