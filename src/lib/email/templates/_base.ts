const SUPPORT_EMAIL = process.env.EMAIL_FROM_SUPPORT ?? 'support@financialmodelerpro.com';
const APP_URL       = process.env.NEXT_PUBLIC_APP_URL ?? 'https://financialmodelerpro.com';
const YEAR          = new Date().getFullYear();

export function baseLayout(content: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Financial Modeler Pro</title>
</head>
<body style="margin:0;padding:0;background:#F4F6F9;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1a1a1a;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F4F6F9;padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">

          <!-- Header -->
          <tr>
            <td style="background:#1F3864;border-radius:10px 10px 0 0;padding:28px 36px;text-align:center;">
              <span style="font-size:22px;font-weight:700;color:#ffffff;letter-spacing:0.5px;">
                Financial Modeler Pro
              </span>
              <div style="font-size:11px;color:rgba(255,255,255,0.55);margin-top:4px;letter-spacing:0.8px;text-transform:uppercase;">
                Professional Financial Modeling Platform
              </div>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="background:#ffffff;padding:36px 40px;border-left:1px solid #E2E8F0;border-right:1px solid #E2E8F0;">
              ${content}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#F8FAFC;border:1px solid #E2E8F0;border-top:none;border-radius:0 0 10px 10px;padding:20px 36px;text-align:center;">
              <p style="margin:0 0 6px;font-size:12px;color:#64748B;">
                &copy; ${YEAR} Financial Modeler Pro &nbsp;|&nbsp;
                <a href="${APP_URL}" style="color:#2E75B6;text-decoration:none;">${APP_URL.replace(/^https?:\/\//, '')}</a>
              </p>
              <p style="margin:0;font-size:12px;color:#64748B;">
                Support: <a href="mailto:${SUPPORT_EMAIL}" style="color:#2E75B6;text-decoration:none;">${SUPPORT_EMAIL}</a>
              </p>
              <p style="margin:10px 0 0;font-size:11px;color:#94A3B8;">
                This is an automated message. Please do not reply directly to this email.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
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
