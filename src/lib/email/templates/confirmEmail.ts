import { baseLayoutBranded, h1, p, button, divider } from './_base';

interface ConfirmEmailOptions {
  confirmUrl: string;
  hub: 'training' | 'modeling';
}

export async function confirmEmailTemplate({ confirmUrl, hub }: ConfirmEmailOptions): Promise<{
  subject: string;
  html: string;
}> {
  const hubName = hub === 'training' ? 'Training Hub' : 'Modeling Hub';

  const html = await baseLayoutBranded(`
    ${h1('Confirm Your Email Address')}
    ${p(`Thank you for registering with the Financial Modeler Pro <strong>${hubName}</strong>.`)}
    ${p('Please click the button below to confirm your email address and activate your account.')}
    <div style="text-align:center;margin:28px 0;">
      ${button('Confirm My Email →', confirmUrl)}
    </div>
    ${p('Or copy and paste this link into your browser:')}
    <p style="font-size:12px;word-break:break-all;color:#2E75B6;margin:0 0 14px;">${confirmUrl}</p>
    ${divider()}
    ${p('This link expires in <strong>24 hours</strong>.', 'font-size:13px;color:#6B7280;')}
    ${p('If you did not create this account, you can safely ignore this email.', 'font-size:13px;color:#6B7280;')}
  `);

  return {
    subject: `Confirm your Financial Modeler Pro account`,
    html,
  };
}
