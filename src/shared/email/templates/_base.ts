import { getServerClient } from '@/src/core/db/supabase';

const YEAR = new Date().getFullYear();

// ── Email branding cache (refreshed every 5 minutes) ───────────────────────

interface EmailBranding {
  logo_url: string;
  logo_width: number;
  logo_alt: string;
  signature_html: string;
  footer_text: string;
  primary_color: string;
}

let _brandingCache: EmailBranding | null = null;
let _brandingCacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export async function getEmailBranding(): Promise<EmailBranding> {
  if (_brandingCache && Date.now() - _brandingCacheTime < CACHE_TTL) return _brandingCache;
  try {
    const sb = getServerClient();
    const { data } = await sb.from('email_branding').select('*').limit(1).single();
    if (data) {
      _brandingCache = data as EmailBranding;
      _brandingCacheTime = Date.now();
      return _brandingCache;
    }
  } catch { /* fall through to defaults */ }
  return {
    logo_url: '',
    logo_width: 180,
    logo_alt: 'Financial Modeler Pro',
    signature_html: `<div style="margin-top:32px;padding-top:24px;border-top:1px solid #e5e7eb;">
  <p style="margin:0;font-size:14px;color:#374151;font-weight:600;">Financial Modeler Pro</p>
  <p style="margin:4px 0 0;font-size:13px;color:#6b7280;">Professional Financial Modeling Training</p>
  <p style="margin:4px 0 0;font-size:13px;color:#6b7280;"><a href="https://financialmodelerpro.com" style="color:#2E75B6;">financialmodelerpro.com</a></p>
</div>`,
    footer_text: '\u00A9 Financial Modeler Pro. You are receiving this because you registered for our training program.',
    primary_color: '#1F3864',
  };
}

// ── Base layout (with dynamic branding) ────────────────────────────────────

export async function baseLayoutBranded(content: string): Promise<string> {
  const b = await getEmailBranding();
  const logoBlock = b.logo_url
    ? `<img src="${b.logo_url}" alt="${b.logo_alt}" width="${b.logo_width}" style="display:block;margin:0 auto;max-width:100%;height:auto;" />`
    : `<span style="font-size:22px;font-weight:700;color:#ffffff;letter-spacing:0.5px;">Financial Modeler Pro</span>
       <div style="font-size:11px;color:rgba(255,255,255,0.55);margin-top:4px;letter-spacing:0.8px;text-transform:uppercase;">Structured Modeling. Real-World Finance.</div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>Financial Modeler Pro</title></head>
<body style="margin:0;padding:0;background:#F4F6F9;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1a1a1a;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F4F6F9;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">
        <!-- Header -->
        <tr><td style="background:${b.primary_color};border-radius:10px 10px 0 0;padding:28px 36px;text-align:center;">
          ${logoBlock}
        </td></tr>
        <!-- Body -->
        <tr><td style="background:#ffffff;padding:36px 40px;border-left:1px solid #E2E8F0;border-right:1px solid #E2E8F0;">
          ${content}
          ${b.signature_html}
        </td></tr>
        <!-- Footer -->
        <tr><td style="background:#F8FAFC;border:1px solid #E2E8F0;border-top:none;border-radius:0 0 10px 10px;padding:20px 36px;text-align:center;">
          <p style="margin:0;font-size:12px;color:#94A3B8;">${b.footer_text.replace('{year}', String(YEAR))}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export function button(label: string, href: string): string {
  return `<a href="${href}" style="display:inline-block;background:#2E75B6;color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;padding:13px 32px;border-radius:7px;margin:16px 0;">${label}</a>`;
}

export function divider(): string {
  return `<hr style="border:none;border-top:1px solid #E2E8F0;margin:24px 0;" />`;
}

export function h1(text: string): string {
  return `<h1 style="margin:0 0 12px;font-size:22px;font-weight:700;color:#1F3864;">${text}</h1>`;
}

export function p(text: string, style = ''): string {
  return `<p style="margin:0 0 14px;line-height:1.6;color:#374151;${style}">${text}</p>`;
}
