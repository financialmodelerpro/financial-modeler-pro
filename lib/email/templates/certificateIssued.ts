import { baseLayout, h1, p, button, divider } from './_base';

interface CertificateIssuedData {
  name: string;
  courseName: string;
  certificateUrl?: string;
  certifierUrl?: string;
}

export function certificateIssuedTemplate({ name, courseName, certificateUrl, certifierUrl }: CertificateIssuedData) {
  const subject = `Congratulations! Your ${courseName} Certificate is Ready`;

  const viewUrl = certifierUrl ?? certificateUrl ?? '';

  const html = baseLayout(`
    <div style="text-align:center;margin-bottom:24px;">
      <div style="font-size:48px;">🏆</div>
      <div style="font-size:13px;font-weight:700;color:#C9A84C;text-transform:uppercase;letter-spacing:1px;margin-top:8px;">Certificate Issued</div>
    </div>

    ${h1(`Congratulations, ${name}!`)}
    ${p(`You have successfully completed <strong>${courseName}</strong> and earned your official Financial Modeler Pro certificate.`)}
    ${p('Your certificate verifies your skills in professional financial modeling and is ready to share on your resume or LinkedIn profile.')}

    ${viewUrl ? `
    <div style="text-align:center;margin:28px 0;">
      ${button('View My Certificate', viewUrl)}
    </div>
    ` : ''}

    ${divider()}
    <div style="background:#FFFBEB;border-left:4px solid #C9A84C;border-radius:6px;padding:16px 20px;margin:0 0 16px;">
      <p style="margin:0;font-size:13px;color:#92400E;font-weight:600;">Share your achievement</p>
      <p style="margin:6px 0 0;font-size:13px;color:#92400E;">Add your certificate to LinkedIn or include the verification link on your resume to showcase your expertise.</p>
    </div>
    ${p('We are proud of your dedication and achievement. Well done!', 'font-size:13px;color:#64748B;')}
  `);

  const text = `Congratulations, ${name}!\n\nYou have earned your ${courseName} certificate from Financial Modeler Pro.\n\n${viewUrl ? `View your certificate: ${viewUrl}\n\n` : ''}Share this achievement on LinkedIn or your resume!`;

  return { subject, html, text };
}
