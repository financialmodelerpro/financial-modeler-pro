/*
 * html-safe: inviteUrl
 *
 * Built by this codebase from APP_URL plus a server-generated token. No
 * user-supplied text reaches it, and escaping a URL would break the link.
 * The inviter and account names ARE user-supplied and are escaped here.
 */
import { baseLayoutBranded, h1, p, button, divider, escapeHtml } from './_base';

interface AccountInviteOptions {
  inviterName: string | null;
  accountName: string;
  inviteUrl: string;
  expiresDays: number;
}

export async function accountInviteEmail({ inviterName, accountName, inviteUrl, expiresDays }: AccountInviteOptions): Promise<{
  subject: string;
  html: string;
}> {
  const who = inviterName ? escapeHtml(inviterName) : 'Your colleague';
  const acct = escapeHtml(accountName);

  const html = await baseLayoutBranded(`
    ${h1('You are invited to join a team')}
    ${p(`<strong>${who}</strong> has invited you to join <strong>${acct}</strong> on the Financial Modeler Pro Modeling Hub.`)}
    ${p('Create your login through the button below. Your access is covered by the team’s subscription; there is nothing to buy.')}
    <div style="text-align:center;margin:28px 0;">
      ${button('Join the team →', inviteUrl)}
    </div>
    ${p('Or copy and paste this link into your browser:')}
    <p style="font-size:12px;word-break:break-all;color:#2E75B6;margin:0 0 14px;">${inviteUrl}</p>
    ${divider()}
    ${p(`This invite expires in <strong>${expiresDays} days</strong> and can be used once, for this email address only.`, 'font-size:13px;color:#6B7280;')}
    ${p('If you were not expecting this, you can safely ignore this email.', 'font-size:13px;color:#6B7280;')}
  `);

  return {
    subject: `You’re invited to join ${accountName} on Financial Modeler Pro`,
    html,
  };
}
