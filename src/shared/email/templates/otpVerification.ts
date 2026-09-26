/*
 * html-safe: code
 * html-safe: expiresMinutes
 * html-safe: purpose
 *
 * A server-generated code, a number, and a code literal that only chooses
 * which fixed wording renders. None can carry markup.
 */
import { baseLayoutBranded, neutralFooter, h1, p, divider } from './_base';

interface OtpVerificationData {
  code: string;
  expiresMinutes?: number;
  /**
   * 'password_reset' (2026-09-26): the Training Hub reset sends this code, and
   * the old wording ("verify your email address", subject "Verification
   * Code") did not say it was the password reset the student had just asked
   * for, so it read as unrelated or as spam. Default unchanged.
   */
  purpose?: 'verify' | 'password_reset';
}

export async function otpVerificationTemplate({ code, expiresMinutes = 10, purpose = 'verify' }: OtpVerificationData) {
  const reset = purpose === 'password_reset';
  const subject = reset ? `Your Training Hub password reset code: ${code}` : 'Your Financial Modeler Pro Verification Code';

  const html = await baseLayoutBranded(`
    ${h1(reset ? 'Reset your password' : 'Email Verification Code')}
    ${reset
      ? p('You asked to reset your Financial Modeler Pro Training Hub password. Enter this code on the reset page. It expires in <strong>' + expiresMinutes + ' minutes</strong>.')
      : p('Use the code below to verify your email address. This code expires in <strong>' + expiresMinutes + ' minutes</strong>.')}

    <div style="background:#F0F6FF;border:2px solid #2E75B6;border-radius:10px;padding:24px;text-align:center;margin:24px 0;">
      <div style="font-size:36px;font-weight:800;letter-spacing:10px;color:#1F3864;font-family:monospace;">${code}</div>
      <div style="font-size:12px;color:#64748B;margin-top:8px;">${reset ? 'Password reset code' : 'Verification Code'} - expires in ${expiresMinutes} minutes</div>
    </div>

    ${reset
      ? p('If you did not ask to reset your password, ignore this email: your password has not changed.')
      : p('If you did not request this code, you can safely ignore this email.')}
    ${divider()}
    ${p('Need help? Contact us at <a href="mailto:support@financialmodelerpro.com" style="color:#2E75B6;">support@financialmodelerpro.com</a>', 'font-size:13px;color:#64748B;')}
  `, {
    // Sent to people from EITHER hub, so the reason is the request itself,
    // never one hub's tagline (2026-09-04).
    footer_text: neutralFooter(reset
      ? 'You are receiving this because a password reset was requested for your Financial Modeler Pro Training Hub account.'
      : 'You are receiving this because a sign-in to your Financial Modeler Pro account needed verification.'),
  });

  const text = reset
    ? `Financial Modeler Pro Training Hub - Password reset\n\nYour password reset code is: ${code}\n\nIt expires in ${expiresMinutes} minutes.\n\nIf you did not ask to reset your password, ignore this email: your password has not changed.`
    : `Financial Modeler Pro - Email Verification\n\nYour verification code is: ${code}\n\nThis code expires in ${expiresMinutes} minutes.\n\nIf you did not request this, ignore this email.`;

  return { subject, html, text };
}
