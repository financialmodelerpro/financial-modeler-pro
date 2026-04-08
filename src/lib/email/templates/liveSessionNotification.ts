/**
 * Live Session email template — announcement or reminder.
 * Sent directly via Resend from Next.js (no Apps Script).
 */

interface Params {
  name: string;
  sessionTitle: string;
  sessionDate: string;
  sessionTime: string;
  timezone: string;
  liveUrl?: string;
  description?: string;
  attachments?: { name: string; url: string }[];
  isReminder: boolean;
}

export function liveSessionNotificationTemplate(p: Params): { subject: string; html: string } {
  const subject = p.isReminder
    ? `Reminder: ${p.sessionTitle} starts in 1 hour`
    : `New Live Session: ${p.sessionTitle} - ${p.sessionDate}`;

  const calendarBlock = p.liveUrl ? `
    <div style="background:#f0f4ff;border-left:4px solid #2E75B6;padding:20px 24px;border-radius:6px;margin:24px 0;">
      <p style="margin:0 0 8px;font-weight:bold;color:#1F3864;">
        ${p.sessionDate} at ${p.sessionTime} (${p.timezone})</p>
      <p style="margin:8px 0;color:#555;">${p.description || ''}</p>
      <div style="margin-top:16px;">
        <a href="${p.liveUrl}" style="background:#1ABC9C;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block;">
          Join Live Session
        </a>
      </div>
    </div>` : '';

  const attachBlock = p.attachments?.length ? `
    <p><strong>Session Materials:</strong></p>
    <ul>${p.attachments.map(a => `<li><a href="${a.url}" style="color:#2E75B6;">${a.name}</a></li>`).join('')}</ul>` : '';

  const body = p.isReminder
    ? `<p>Dear <strong>${p.name}</strong>,</p>
       <p>This is a reminder that <strong>${p.sessionTitle}</strong> starts in <strong>1 hour</strong>.</p>
       ${calendarBlock}${attachBlock}`
    : `<p>Dear <strong>${p.name}</strong>,</p>
       <p>A new live training session has been scheduled:</p>
       <h2 style="color:#1F3864;margin:16px 0;">${p.sessionTitle}</h2>
       ${calendarBlock}${attachBlock}`;

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:32px 16px;">
<tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
<tr><td style="background:#1F3864;padding:28px 36px;">
  <div style="color:#fff;font-size:22px;font-weight:bold;">Financial Modeler Pro</div>
  <div style="color:#a8c4e0;font-size:13px;margin-top:4px;">Training & Certification Platform</div>
</td></tr>
<tr><td style="background:#2E75B6;padding:14px 36px;">
  <div style="color:#fff;font-size:16px;font-weight:bold;">
    ${p.isReminder ? 'Session Reminder' : 'Live Session Announcement'}
  </div>
</td></tr>
<tr><td style="padding:36px;color:#333;font-size:15px;line-height:1.7;">
  ${body}
  <p>Best regards,<br><strong>Ahmad Din</strong><br>Financial Modeler Pro</p>
</td></tr>
<tr><td style="background:#f8f9fb;padding:20px 36px;border-top:1px solid #e8ecf0;">
  <p style="margin:0;font-size:12px;color:#888;">&copy; ${new Date().getFullYear()} Financial Modeler Pro</p>
</td></tr>
</table></td></tr></table>
</body></html>`;

  return { subject, html };
}
