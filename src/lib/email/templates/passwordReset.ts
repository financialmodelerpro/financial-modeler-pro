import { baseLayoutBranded, h1, p, button, divider } from './_base';

interface PasswordResetData {
  resetUrl: string;
  expiresMinutes?: number;
}

export async function passwordResetTemplate({ resetUrl, expiresMinutes = 60 }: PasswordResetData) {
  const subject = 'Reset Your Financial Modeler Pro Password';

  const html = await baseLayoutBranded(`
    ${h1('Password Reset Request')}
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
