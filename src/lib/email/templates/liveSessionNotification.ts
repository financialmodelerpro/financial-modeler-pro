/**
 * Live Session email templates.
 * Sent directly via Resend from Next.js (no Apps Script).
 * Uses email_branding table for logo + signature (same as System A).
 */

import { getEmailBranding } from './_base';

interface NotificationParams {
  name: string;
  sessionTitle: string;
  sessionDate: string;
  sessionTime: string;
  timezone: string;
  sessionUrl: string;
  joinUrl?: string;
  description?: string;
  attachments?: { name: string; url: string }[];
  isReminder: boolean;
  registrationCount?: number;
  dialInTollNumber?: string;
  dialInConferenceId?: string;
}

interface ConfirmationParams {
  name: string;
  sessionTitle: string;
  sessionDate: string;
  sessionTime: string;
  timezone: string;
  sessionUrl: string;
  liveUrl?: string;
}

async function emailShell(bannerText: string, body: string): Promise<string> {
  const b = await getEmailBranding();
  const logoBlock = b.logo_url
    ? `<img src="${b.logo_url}" alt="${b.logo_alt}" width="${b.logo_width}" style="display:block;margin:0 auto;max-width:100%;height:auto;" />`
    : `<span style="font-size:22px;font-weight:700;color:#ffffff;">Financial Modeler Pro</span>
       <div style="font-size:11px;color:rgba(255,255,255,0.55);margin-top:4px;letter-spacing:0.8px;text-transform:uppercase;">Structured Modeling. Real-World Finance.</div>`;

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:32px 16px;">
<tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
<tr><td style="background:${b.primary_color};padding:28px 36px;text-align:center;">
  ${logoBlock}
</td></tr>
<tr><td style="background:#2E75B6;padding:14px 36px;">
  <div style="color:#fff;font-size:16px;font-weight:bold;">${bannerText}</div>
</td></tr>
<tr><td style="padding:36px;color:#333;font-size:15px;line-height:1.7;">
  ${body}
  ${b.signature_html}
</td></tr>
<tr><td style="background:#f8f9fb;padding:20px 36px;border-top:1px solid #e8ecf0;">
  <p style="margin:0;font-size:12px;color:#888;">${b.footer_text.replace('{year}', String(new Date().getFullYear()))}</p>
</td></tr>
</table></td></tr></table>
</body></html>`;
}

/**
 * Announcement or reminder email - links to session page (not direct join link).
 */
export async function liveSessionNotificationTemplate(p: NotificationParams): Promise<{ subject: string; html: string }> {
  const subject = p.isReminder
    ? `Reminder: ${p.sessionTitle} starts in 1 hour`
    : `New Live Session: ${p.sessionTitle} - ${p.sessionDate}`;

  const dialInBlock = (p.dialInTollNumber || p.dialInConferenceId) ? `
      <p style="margin:12px 0 0;font-size:12px;color:#888;">
        Phone dial-in:${p.dialInTollNumber ? ` ${p.dialInTollNumber}` : ''}${p.dialInConferenceId ? ` (Conference ID: ${p.dialInConferenceId})` : ''}
      </p>` : '';

  const dateBlock = `
    <div style="background:#f0f4ff;border-left:4px solid #2E75B6;padding:20px 24px;border-radius:6px;margin:24px 0;">
      <p style="margin:0 0 8px;font-weight:bold;color:#1F3864;">
        ${p.sessionDate} at ${p.sessionTime} (${p.timezone})</p>
      ${p.description ? `<p style="margin:8px 0;color:#555;">${p.description}</p>` : ''}
      ${p.registrationCount ? `<p style="margin:8px 0;font-size:13px;color:#2E75B6;">Join ${p.registrationCount} other students who have already registered</p>` : ''}
      <div style="margin-top:16px;">
        <a href="${p.sessionUrl}" style="background:#2E75B6;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block;">
          View & Register for This Session
        </a>
      </div>
      ${p.joinUrl ? `<p style="margin:12px 0 0;font-size:12px;color:#888;">Direct join link: <a href="${p.joinUrl}" style="color:#2E75B6;">${p.joinUrl}</a></p>` : `<p style="margin:12px 0 0;font-size:12px;color:#888;">Log in to your account to register and get the join link</p>`}
      ${dialInBlock}
    </div>`;

  const attachBlock = p.attachments?.length ? `
    <p><strong>Session Materials:</strong></p>
    <ul>${p.attachments.map(a => `<li><a href="${a.url}" style="color:#2E75B6;">${a.name}</a></li>`).join('')}</ul>` : '';

  const body = p.isReminder
    ? `<p>Dear <strong>${p.name}</strong>,</p>
       <p>This is a reminder that <strong>${p.sessionTitle}</strong> starts in <strong>1 hour</strong>.</p>
       ${dateBlock}${attachBlock}`
    : `<p>Dear <strong>${p.name}</strong>,</p>
       <p>A new live training session has been scheduled:</p>
       <h2 style="color:#1F3864;margin:16px 0;">${p.sessionTitle}</h2>
       ${dateBlock}${attachBlock}`;

  return { subject, html: await emailShell(p.isReminder ? 'Session Reminder' : 'Live Session Announcement', body) };
}

/**
 * Registration confirmation email - sent when student registers for a session.
 */
export async function registrationConfirmationTemplate(p: ConfirmationParams): Promise<{ subject: string; html: string }> {
  const subject = `You're registered: ${p.sessionTitle} - ${p.sessionDate}`;

  const body = `
    <p>Dear <strong>${p.name}</strong>,</p>
    <p>You're confirmed for <strong>${p.sessionTitle}</strong>!</p>

    <div style="background:#f0fdf4;border-left:4px solid #2EAA4A;padding:20px 24px;border-radius:6px;margin:24px 0;">
      <p style="margin:0 0 8px;font-weight:bold;color:#166534;">
        ${p.sessionDate} at ${p.sessionTime} (${p.timezone})</p>
      <p style="margin:8px 0;color:#555;">
        The join link will be available in your dashboard <strong>30 minutes before</strong> the session starts.</p>
      <div style="margin-top:16px;">
        <a href="${p.sessionUrl}" style="background:#2EAA4A;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block;">
          View Session in Dashboard
        </a>
      </div>
      ${p.liveUrl ? `<div style="margin-top:10px;">
        <a href="${p.liveUrl}" style="background:#1B4F8A;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block;">
          Join Session
        </a>
      </div>` : ''}
    </div>

    <p style="font-size:13px;color:#6B7280;">The join link will also be available in your dashboard 30 minutes before the session starts.</p>
    <p style="font-size:13px;color:#6B7280;">Can't make it? You can cancel your registration from your dashboard.</p>`;

  return { subject, html: await emailShell('Registration Confirmed', body) };
}
