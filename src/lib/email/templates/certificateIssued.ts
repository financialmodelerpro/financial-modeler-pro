import { baseLayout, h1, p, button, divider } from './_base';

interface CertificateIssuedData {
  studentName:     string;
  courseName:      string;
  certPdfUrl?:     string;
  badgeUrl?:       string;
  verificationUrl?: string;
  certificateId?:  string;
  grade?:          string;
  // Legacy fields (kept for compatibility)
  name?:           string;
  certificateUrl?: string;
  certifierUrl?:   string;
}

export function certificateIssuedTemplate(data: CertificateIssuedData) {
  const name      = data.studentName || data.name || 'Student';
  const course    = data.courseName;
  const certUrl   = data.certPdfUrl ?? data.certificateUrl ?? data.certifierUrl ?? '';
  const verifyUrl = data.verificationUrl ?? '';
  const badgeUrl  = data.badgeUrl ?? '';
  const certId    = data.certificateId ?? '';
  const grade     = data.grade ?? '';

  const learnUrl = process.env.NEXT_PUBLIC_LEARN_URL ?? 'https://learn.financialmodelerpro.com';

  const subject = `Congratulations! Your ${course} Certificate is Ready`;

  const html = baseLayout(`
    <div style="text-align:center;margin-bottom:24px;">
      <div style="font-size:48px;">🏆</div>
      <div style="font-size:13px;font-weight:700;color:#C9A84C;text-transform:uppercase;letter-spacing:1px;margin-top:8px;">Certificate Issued</div>
    </div>

    ${h1(`Congratulations, ${name}!`)}
    ${p(`You have successfully completed <strong>${course}</strong> and earned your official Financial Modeler Pro certificate.`)}
    ${grade ? p(`<strong>Grade: ${grade}</strong>`) : ''}
    ${certId ? `<p style="text-align:center;font-size:12px;color:#9CA3AF;font-family:monospace;">Certificate ID: ${certId}</p>` : ''}

    ${certUrl ? `
    <div style="text-align:center;margin:28px 0;">
      ${button('⬇ Download Certificate PDF', certUrl)}
    </div>
    ` : ''}

    ${divider()}

    <div style="display:flex;gap:12px;flex-wrap:wrap;margin:16px 0;">
      ${badgeUrl ? `
      <a href="${badgeUrl}" style="flex:1;min-width:140px;display:block;padding:10px 16px;background:#0D2E5A;color:#fff;text-decoration:none;font-size:13px;font-weight:600;text-align:center;border-radius:7px;">
        🎖 Download Badge
      </a>
      ` : ''}
      ${verifyUrl ? `
      <a href="${verifyUrl}" style="flex:1;min-width:140px;display:block;padding:10px 16px;background:#2EAA4A;color:#fff;text-decoration:none;font-size:13px;font-weight:600;text-align:center;border-radius:7px;">
        ✅ Verify Certificate
      </a>
      ` : ''}
    </div>

    ${verifyUrl ? `
    <div style="background:#FFFBEB;border-left:4px solid #C9A84C;border-radius:6px;padding:16px 20px;margin:16px 0;">
      <p style="margin:0;font-size:13px;color:#92400E;font-weight:600;">Share your achievement</p>
      <p style="margin:6px 0 0;font-size:12px;color:#92400E;">
        Your certificate is publicly verifiable at:<br/>
        <a href="${verifyUrl}" style="color:#1B4F8A;">${verifyUrl}</a>
      </p>
    </div>
    ` : ''}

    ${p(`View your certificate and download all assets from your <a href="${learnUrl}/training/dashboard" style="color:#1B4F8A;">Training Dashboard</a>.`, 'font-size:13px;color:#64748B;')}
    ${p('We are proud of your dedication and achievement. Well done!', 'font-size:13px;color:#64748B;')}
  `);

  const text = `Congratulations, ${name}!\n\nYou have successfully completed ${course} and earned your official Financial Modeler Pro certificate.\n${grade ? `Grade: ${grade}\n` : ''}${certId ? `Certificate ID: ${certId}\n` : ''}${verifyUrl ? `\nVerify your certificate: ${verifyUrl}\n` : ''}${certUrl ? `\nDownload Certificate: ${certUrl}\n` : ''}`;

  return { subject, html, text };
}
