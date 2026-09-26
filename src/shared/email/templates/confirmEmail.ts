/*
 * html-safe: confirmUrl
 *
 * Built by this codebase from APP_URL plus a server-generated confirmation
 * token. No user-supplied text reaches it, and escaping a URL would break the
 * link. See verify-email-escaping for the rule this declaration satisfies.
 *
 * html-safe: hub is the literal 'training' | 'modeling', typed by the caller
 * in code, and only chooses which fixed block renders; it is never printed.
 */
import { baseLayoutBranded, fmpLayout, h1, p, button, divider } from './_base';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.financialmodelerpro.com';

/**
 * The Modeling Hub can be installed as an app from the browser (2026-09-26,
 * founder). It is NOT a download, so this never says one: the browser adds it
 * from the sign-in page, where the install option appears. Modeling Hub only;
 * the Training Hub has no installed app.
 */
export const MODELING_APP_SIGNIN_URL = `${APP_URL}/signin`;
export function modelingAppSection(): string {
  const li = (label: string, how: string): string =>
    `<li style="margin:0 0 6px;"><strong>${label}:</strong> ${how}</li>`;
  return `
    <h2 style="margin:0 0 10px;font-size:17px;font-weight:700;color:#1F3864;">Use the Modeling Hub as an app</h2>
    ${p('You can install the Modeling Hub as an app from your browser, so it opens in its own window like any other app on your device. Open the sign-in page, then:')}
    <ul style="margin:0 0 14px;padding-left:20px;font-size:14px;line-height:1.6;color:#374151;">
      ${li('Chrome on a computer', 'click the install icon in the address bar')}
      ${li('Android', 'open the browser menu and choose Install app')}
      ${li('iPhone', 'tap Share, then Add to Home Screen')}
    </ul>
    <p style="margin:0 0 14px;font-size:14px;"><a href="${MODELING_APP_SIGNIN_URL}" style="color:#2E75B6;">Open the Modeling Hub sign-in page</a></p>`;
}

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
    ${hub === 'modeling' ? divider() + modelingAppSection() : ''}
  `);

  return {
    subject: `Confirm your Financial Modeler Pro account`,
    html,
  };
}
