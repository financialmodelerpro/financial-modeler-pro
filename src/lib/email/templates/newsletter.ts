import { getEmailBranding } from './_base';

const MAIN_URL = process.env.NEXT_PUBLIC_MAIN_URL ?? 'https://financialmodelerpro.com';
const YEAR = new Date().getFullYear();

interface NewsletterData {
  body: string;
  hub: string;
  unsubscribeToken: string;
}

/** Newsletter-specific branded layout - overrides signature + footer for newsletter context. */
async function baseLayoutNewsletter(content: string): Promise<string> {
  const b = await getEmailBranding();
  const logoBlock = b.logo_url
    ? `<img src="${b.logo_url}" alt="${b.logo_alt}" width="${b.logo_width}" style="display:block;margin:0 auto;max-width:100%;height:auto;" />`
    : `<span style="font-size:22px;font-weight:700;color:#ffffff;letter-spacing:0.5px;">Financial Modeler Pro</span>
       <div style="font-size:11px;color:rgba(255,255,255,0.55);margin-top:4px;letter-spacing:0.8px;text-transform:uppercase;">Structured Modeling. Real-World Finance.</div>`;

  const signature = `<div style="margin-top:32px;padding-top:24px;border-top:1px solid #e5e7eb;">
  <p style="margin:0;font-size:14px;color:#374151;font-weight:600;">Financial Modeler Pro</p>
  <p style="margin:4px 0 0;font-size:13px;color:#6b7280;">Structured Modeling. Real-World Finance.</p>
  <p style="margin:4px 0 0;font-size:13px;color:#6b7280;"><a href="${MAIN_URL}" style="color:#2E75B6;">financialmodelerpro.com</a></p>
</div>`;

  const footer = `\u00A9 ${YEAR} Financial Modeler Pro. You are receiving this because you subscribed to Financial Modeler Pro updates.`;

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>Financial Modeler Pro</title></head>
<body style="margin:0;padding:0;background:#F4F6F9;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1a1a1a;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F4F6F9;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">
        <tr><td style="background:${b.primary_color};border-radius:10px 10px 0 0;padding:28px 36px;text-align:center;">
          ${logoBlock}
        </td></tr>
        <tr><td style="background:#ffffff;padding:36px 40px;border-left:1px solid #E2E8F0;border-right:1px solid #E2E8F0;">
          ${content}
          ${signature}
        </td></tr>
        <tr><td style="background:#F8FAFC;border:1px solid #E2E8F0;border-top:none;border-radius:0 0 10px 10px;padding:20px 36px;text-align:center;">
          <p style="margin:0;font-size:12px;color:#94A3B8;">${footer}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export async function newsletterTemplate({ body, hub, unsubscribeToken }: NewsletterData) {
  const hubLabel = hub === 'training' ? 'Training Hub' : hub === 'modeling' ? 'Modeling Hub' : 'Financial Modeler Pro';
  const unsubscribeUrl = `${MAIN_URL}/api/newsletter/unsubscribe?token=${unsubscribeToken}`;

  const html = await baseLayoutNewsletter(`
    ${body}

    <div style="margin-top:32px;padding-top:20px;border-top:1px solid #E5E7EB;">
      <p style="font-size:12px;color:#9CA3AF;margin:0;">You're receiving this because you subscribed to ${hubLabel} updates.</p>
      <p style="font-size:12px;color:#9CA3AF;margin:4px 0 0;">
        <a href="${unsubscribeUrl}" style="color:#9CA3AF;text-decoration:underline;">Unsubscribe</a>
      </p>
    </div>
  `);

  const text = `Newsletter from Financial Modeler Pro\n\nTo unsubscribe: ${unsubscribeUrl}`;

  return { html, text };
}
