import { baseLayoutBranded, h1, p, divider } from './_base';

const SUPPORT_EMAIL = process.env.EMAIL_FROM_SUPPORT ?? 'support@financialmodelerpro.com';

interface LockedOutData {
  name?: string;
  sessionName: string;
  reason?: string;
  attemptsUsed?: number;
  maxAttempts?: number;
}

export async function lockedOutTemplate({ name, sessionName, reason, attemptsUsed, maxAttempts }: LockedOutData) {
  const subject = `Access Restricted - ${sessionName}`;

  const html = await baseLayoutBranded(`
    ${h1('Session Access Restricted')}
    ${name ? p(`Hi <strong>${name}</strong>,`) : ''}
    ${p(`Your access to <strong>${sessionName}</strong> has been temporarily restricted.`)}

    ${attemptsUsed && maxAttempts ? `
    <div style="background:#FEF2F2;border-left:4px solid #EF4444;border-radius:6px;padding:16px 20px;margin:16px 0;">
      <p style="margin:0;font-size:13px;color:#991B1B;">
        You have used <strong>${attemptsUsed} of ${maxAttempts}</strong> allowed attempts.
        ${reason ? `<br />${reason}` : ''}
      </p>
    </div>
    ` : reason ? `
    <div style="background:#FEF2F2;border-left:4px solid #EF4444;border-radius:6px;padding:16px 20px;margin:16px 0;">
      <p style="margin:0;font-size:13px;color:#991B1B;">${reason}</p>
    </div>
    ` : ''}

    ${p('If you believe this is an error or need assistance, please contact our support team.')}
    ${divider()}
    <p style="margin:0;font-size:13px;color:#64748B;">
      Contact support: <a href="mailto:${SUPPORT_EMAIL}" style="color:#2E75B6;">${SUPPORT_EMAIL}</a>
    </p>
  `);

  const text = `Financial Modeler Pro - Session Access Restricted\n\n${name ? `Hi ${name},\n\n` : ''}Your access to ${sessionName} has been temporarily restricted.\n\n${reason ?? ''}\n\nContact support: ${SUPPORT_EMAIL}`;

  return { subject, html, text };
}
