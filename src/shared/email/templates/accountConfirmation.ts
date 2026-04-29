import { baseLayoutBranded, h1, p, button, divider } from './_base';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://financialmodelerpro.com';

interface AccountConfirmationData {
  name: string;
  email: string;
  confirmUrl?: string;
}

export async function accountConfirmationTemplate({ name, email, confirmUrl }: AccountConfirmationData) {
  const subject = 'Welcome to Financial Modeler Pro - Confirm Your Account';

  const html = await baseLayoutBranded(`
    ${h1(`Welcome, ${name}!`)}
    ${p(`Your Financial Modeler Pro account has been created for <strong>${email}</strong>.`)}
    ${p('You now have access to the Modeling Hub - professional financial modeling tools built for real-world transactions.')}

    ${confirmUrl ? `
    <div style="background:#F0F6FF;border-radius:8px;padding:20px 24px;margin:20px 0;">
      ${p('Please confirm your email address to activate your account:', 'margin:0 0 12px;')}
      <div style="text-align:center;">
        ${button('Confirm Email Address', confirmUrl)}
      </div>
    </div>
    ${p('This confirmation link expires in 24 hours.', 'font-size:13px;color:#64748B;')}
    ` : `
    <div style="text-align:center;margin:28px 0;">
      ${button('Go to Modeling Hub', `${APP_URL}/modeling/dashboard`)}
    </div>
    `}

    ${divider()}
    ${p('If you did not create this account, please contact our support team immediately.', 'font-size:13px;color:#64748B;')}
  `);

  const text = `Welcome to Financial Modeler Pro!\n\nHi ${name},\n\nYour account has been created for ${email}.\n\n${confirmUrl ? `Confirm your email: ${confirmUrl}\n\n` : ''}Access the Modeling Hub: ${APP_URL}/modeling/dashboard`;

  return { subject, html, text };
}
