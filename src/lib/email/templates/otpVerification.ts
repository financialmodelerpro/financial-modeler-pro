import { baseLayoutBranded, h1, p, divider } from './_base';

interface OtpVerificationData {
  code: string;
  expiresMinutes?: number;
}

export async function otpVerificationTemplate({ code, expiresMinutes = 10 }: OtpVerificationData) {
  const subject = 'Your Financial Modeler Pro Verification Code';

  const html = await baseLayoutBranded(`
    ${h1('Email Verification Code')}
    ${p('Use the code below to verify your email address. This code expires in <strong>' + expiresMinutes + ' minutes</strong>.')}

    <div style="background:#F0F6FF;border:2px solid #2E75B6;border-radius:10px;padding:24px;text-align:center;margin:24px 0;">
      <div style="font-size:36px;font-weight:800;letter-spacing:10px;color:#1F3864;font-family:monospace;">${code}</div>
      <div style="font-size:12px;color:#64748B;margin-top:8px;">Verification Code - expires in ${expiresMinutes} minutes</div>
    </div>

    ${p('If you did not request this code, you can safely ignore this email.')}
    ${divider()}
    ${p('Need help? Contact us at <a href="mailto:support@financialmodelerpro.com" style="color:#2E75B6;">support@financialmodelerpro.com</a>', 'font-size:13px;color:#64748B;')}
  `);

  const text = `Financial Modeler Pro - Email Verification\n\nYour verification code is: ${code}\n\nThis code expires in ${expiresMinutes} minutes.\n\nIf you did not request this, ignore this email.`;

  return { subject, html, text };
}
