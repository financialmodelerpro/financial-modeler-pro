/*
 * html-safe: resetUrl
 * html-safe: expiresMinutes
 *
 * A URL built by this codebase from a server-generated token, and a number.
 * The recipient NAME is user-supplied and is escaped below, at the one place
 * it enters the HTML.
 */
import { baseLayoutBranded, h1, p, button, divider, escapeHtml } from './_base';

interface PasswordResetData {
  resetUrl: string;
  expiresMinutes?: number;
  /** User-supplied display name; ESCAPED before rendering. */
  name?: string | null;
}

export async function passwordResetTemplate({ resetUrl, expiresMinutes = 60, name }: PasswordResetData) {
  const subject = 'Reset Your Financial Modeler Pro Password';
  const greeting = name && name.trim() ? `Hi ${escapeHtml(name.trim().split(' ')[0])},` : 'Hi,';

  const html = await baseLayoutBranded(`
    ${h1('Password Reset Request')}
    ${p(greeting)}
    ${p('We received a request to reset the password for your Financial Modeler Pro account. Click the button below to set a new password.')}

    <div style="text-align:center;margin:28px 0;">
      ${button('Reset My Password', resetUrl)}
    </div>

    ${p('This link expires in <strong>' + expiresMinutes + ' minutes</strong>. If you did not request a password reset, you can safely ignore this email - your password will remain unchanged.')}
    ${divider()}
    <p style="margin:0;font-size:12px;color:#64748B;word-break:break-all;">
      If the button above does not work, copy and paste this URL into your browser:<br />
      <a href="${resetUrl}" style="color:#2E75B6;">${resetUrl}</a>
    </p>
  `);

  const text = `Financial Modeler Pro - Password Reset\n\nWe received a request to reset your password.\n\nReset link (expires in ${expiresMinutes} minutes):\n${resetUrl}\n\nIf you did not request this, ignore this email.`;

  return { subject, html, text };
}
