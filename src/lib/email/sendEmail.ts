import { Resend } from 'resend';

let _resend: Resend | null = null;
function getResend(): Resend {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

export const FROM = {
  training: `Financial Modeler Pro Training <${process.env.EMAIL_FROM_TRAINING ?? 'training@financialmodelerpro.com'}>`,
  noreply:  `Financial Modeler Pro <${process.env.EMAIL_FROM_NOREPLY ?? 'no-reply@financialmodelerpro.com'}>`,
};

interface SendEmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  from?: string;
}

export async function sendEmail({ to, subject, html, text, from }: SendEmailOptions) {
  const { data, error } = await getResend().emails.send({
    from:    from ?? FROM.training,
    to:      Array.isArray(to) ? to : [to],
    subject,
    html,
    text:    text ?? stripHtml(html),
  });
  if (error) throw new Error(error.message);
  return data;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim();
}
