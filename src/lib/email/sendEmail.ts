import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

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
  const { data, error } = await resend.emails.send({
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
