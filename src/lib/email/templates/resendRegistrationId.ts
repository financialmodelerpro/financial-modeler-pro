import { baseLayoutBranded, h1, p, button, divider } from './_base';

const LEARN_URL = process.env.NEXT_PUBLIC_LEARN_URL ?? 'https://learn.financialmodelerpro.com';

interface ResendRegistrationIdData {
  name?: string;
  registrationId: string;
}

export async function resendRegistrationIdTemplate({ name, registrationId }: ResendRegistrationIdData) {
  const subject = 'Your Financial Modeler Pro Registration ID';

  const html = await baseLayoutBranded(`
    ${h1('Your Registration ID')}
    ${name ? p(`Hi <strong>${name}</strong>,`) : ''}
    ${p('You requested your Registration ID for Financial Modeler Pro Training. Here it is:')}

    <div style="background:#F0F6FF;border-left:4px solid #2E75B6;border-radius:6px;padding:20px 24px;margin:24px 0;">
      <div style="font-size:12px;color:#64748B;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:6px;">Registration ID</div>
      <div style="font-size:26px;font-weight:800;color:#1F3864;letter-spacing:3px;font-family:monospace;">${registrationId}</div>
    </div>

    ${p('Use this ID along with your email address and password to access the Training Dashboard.')}

    <div style="text-align:center;margin:28px 0;">
      ${button('Sign In Now', `${LEARN_URL}/signin`)}
    </div>

    ${divider()}
    ${p('If you did not request this, please contact our support team immediately.', 'font-size:13px;color:#64748B;')}
  `);

  const text = `Financial Modeler Pro — Your Registration ID\n\n${name ? `Hi ${name},\n\n` : ''}Your Registration ID is: ${registrationId}\n\nSign in at: ${LEARN_URL}/signin`;

  return { subject, html, text };
}
