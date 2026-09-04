/*
 * html-safe: confirmUrl
 *
 * Built by this codebase from APP_URL plus a server-generated confirmation
 * token. No user-supplied text reaches it, and escaping a URL would break the
 * link. See verify-email-escaping for the rule this declaration satisfies.
 */
import { baseLayoutBranded, fmpLayout, h1, p, button, divider } from './_base';

interface ConfirmEmailOptions {
  confirmUrl: string;
  hub: 'training' | 'modeling';
}

export async function confirmEmailTemplate({ confirmUrl, hub }: ConfirmEmailOptions): Promise<{
  subject: string;
  html: string;
}> {
  const hubName = hub === 'training' ? 'Training Hub' : 'Modeling Hub';

  // The footer reason follows the HUB (2026-09-04): the shared branding
  // default says "you registered for our training program", which is true
  // for a Training Hub confirmation and wrong for a Modeling Hub one.
  const layout = (content: string) => hub === 'modeling'
    ? fmpLayout(content, 'You are receiving this because an account was created on the Modeling Hub with this email address.')
    : baseLayoutBranded(content);

  const html = await layout(`
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
