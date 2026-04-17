import { baseLayoutBranded, h1, p, divider } from './_base';

interface DeviceVerificationOptions {
  code: string;
  expiryMinutes?: number;
}

export async function deviceVerificationTemplate({ code, expiryMinutes = 10 }: DeviceVerificationOptions): Promise<{
  subject: string;
  html: string;
}> {
  const html = await baseLayoutBranded(`
    ${h1('New Device Sign-In')}
    ${p('We noticed a sign-in attempt from a new or unrecognized device. Enter the code below to verify it\'s you.')}
    <div style="text-align:center;margin:28px 0;">
      <div style="display:inline-block;background:#F8FAFC;border:2px solid #E2E8F0;border-radius:10px;padding:20px 40px;">
        <div style="font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#64748B;margin-bottom:8px;">Verification Code</div>
        <div style="font-size:36px;font-weight:800;letter-spacing:0.25em;color:#1F3864;font-family:monospace;">${code}</div>
      </div>
    </div>
    ${divider()}
    ${p(`This code expires in <strong>${expiryMinutes} minutes</strong>.`, 'font-size:13px;color:#6B7280;')}
    ${p('If this was not you, change your password immediately and contact support.', 'font-size:13px;color:#DC2626;')}
  `);

  return {
    subject: 'New device sign-in — verification code',
    html,
  };
}
