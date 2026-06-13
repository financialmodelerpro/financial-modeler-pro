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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Resolve a human greeting name. The notify route passes `r.name || r.email`,
// so recipients without a roster name would otherwise be greeted as
// "Dear ahmaddin.ch@gmail.com". When the value is empty or an email address,
// fall back to a readable name derived from the local part (or "Student").
function greetingName(name?: string): string {
  const n = (name ?? '').trim();
  if (!n) return 'Student';
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(n)) {
    const pretty = n.split('@')[0]
      .replace(/[._\-+]+/g, ' ')
      .replace(/\d+/g, '')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
    return pretty || 'Student';
  }
  return n;
}

// The session `description` is stored as PLAIN TEXT with real newlines (the
// session page renders it with `white-space: pre-wrap`, so blank lines,
// line breaks and `•` bullet lines all show as authored). Dropping that
// text raw into an HTML <p> collapses every newline to a space, giving the
// run-on paragraph users saw in the email. This mirrors the page structure
// in email-safe HTML: blank line -> new block, consecutive `•` lines -> a
// real <ul>/<li> list, other newlines -> <br>. Everything is HTML-escaped
// first; Unicode-bold heading glyphs (e.g. 𝗙𝗶𝗻𝗮𝗻𝗰𝗶𝗮𝗹) are not HTML-special
// so they pass through unchanged.
const BULLET_RE = /^\s*[•·*–-]\s+/;

function descriptionToEmailHtml(raw: string): string {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let para: string[] = [];
  let bullets: string[] = [];

  const flushPara = () => {
    if (para.length) {
      out.push(`<p style="margin:0 0 12px;color:#374151;line-height:1.7;">${para.join('<br>')}</p>`);
      para = [];
    }
  };
  const flushBullets = () => {
    if (bullets.length) {
      out.push(`<ul style="margin:0 0 12px;padding-left:22px;color:#374151;line-height:1.7;">${bullets.map(b => `<li style="margin:2px 0;">${b}</li>`).join('')}</ul>`);
      bullets = [];
    }
  };

  for (const line of lines) {
    if (line.trim() === '') {
      flushBullets();
      flushPara();
    } else if (BULLET_RE.test(line)) {
      flushPara();
      bullets.push(escapeHtml(line.replace(BULLET_RE, '')));
    } else {
      flushBullets();
      para.push(escapeHtml(line));
    }
  }
  flushBullets();
  flushPara();
  return out.join('');
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

  // Full session write-up rendered as its own section, with structure
  // preserved. It is placed AFTER the date box + CTA on purpose: a long
  // description can be long enough that Gmail collapses the tail of a
  // threaded message behind its "•••" trimmed-content toggle, so the date
  // and the View & Register button must sit above it and stay visible
  // without expanding.
  const descriptionBlock = p.description?.trim()
    ? `<div style="margin:20px 0;font-size:15px;">${descriptionToEmailHtml(p.description)}</div>`
    : '';

  const dateBlock = `
    <div style="background:#f0f4ff;border-left:4px solid #2E75B6;padding:20px 24px;border-radius:6px;margin:24px 0;">
      <p style="margin:0 0 8px;font-weight:bold;color:#1F3864;">
        ${p.sessionDate} at ${p.sessionTime} (${p.timezone})</p>
      ${p.registrationCount ? `<p style="margin:8px 0;font-size:13px;color:#2E75B6;">Join ${p.registrationCount} other students who have already registered</p>` : ''}
      <div style="margin-top:16px;">
        <a href="${p.sessionUrl}" style="background:#2E75B6;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block;">
          View & Register for This Session
        </a>
      </div>
      <p style="margin:12px 0 0;font-size:12px;color:#888;">Register to get the join link, calendar invite and session materials.</p>
      ${dialInBlock}
    </div>`;

  const attachBlock = p.attachments?.length ? `
    <p><strong>Session Materials:</strong></p>
    <ul>${p.attachments.map(a => `<li><a href="${a.url}" style="color:#2E75B6;">${a.name}</a></li>`).join('')}</ul>` : '';

  const body = p.isReminder
    ? `<p>Dear <strong>${escapeHtml(greetingName(p.name))}</strong>,</p>
       <p>This is a reminder that <strong>${p.sessionTitle}</strong> starts in <strong>1 hour</strong>.</p>
       ${dateBlock}${descriptionBlock}${attachBlock}`
    : `<p>Dear <strong>${escapeHtml(greetingName(p.name))}</strong>,</p>
       <p>A new live training session has been scheduled:</p>
       <h2 style="color:#1F3864;margin:16px 0;">${p.sessionTitle}</h2>
       ${dateBlock}
       ${descriptionBlock}${attachBlock}`;

  return { subject, html: await emailShell(p.isReminder ? 'Session Reminder' : 'Live Session Announcement', body) };
}

/**
 * Registration confirmation email - sent when student registers for a session.
 */
export async function registrationConfirmationTemplate(p: ConfirmationParams): Promise<{ subject: string; html: string }> {
  const subject = `You're registered: ${p.sessionTitle} - ${p.sessionDate}`;

  const body = `
    <p>Dear <strong>${escapeHtml(greetingName(p.name))}</strong>,</p>
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
