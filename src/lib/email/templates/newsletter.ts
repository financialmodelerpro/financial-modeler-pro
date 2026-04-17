import { baseLayoutBranded, p } from './_base';

const MAIN_URL = process.env.NEXT_PUBLIC_MAIN_URL ?? 'https://financialmodelerpro.com';

interface NewsletterData {
  body: string; // HTML content from the editor
  hub: string;
  unsubscribeToken: string;
}

export async function newsletterTemplate({ body, hub, unsubscribeToken }: NewsletterData) {
  const hubLabel = hub === 'training' ? 'Training Hub' : hub === 'modeling' ? 'Modeling Hub' : 'Financial Modeler Pro';
  const unsubscribeUrl = `${MAIN_URL}/api/newsletter/unsubscribe?token=${unsubscribeToken}`;

  const html = await baseLayoutBranded(`
    ${body}

    <div style="margin-top:32px;padding-top:20px;border-top:1px solid #E5E7EB;">
      ${p(`You're receiving this because you subscribed to ${hubLabel} updates.`, 'font-size:12px;color:#9CA3AF;')}
      <p style="font-size:12px;color:#9CA3AF;margin:4px 0 0;">
        <a href="${unsubscribeUrl}" style="color:#9CA3AF;text-decoration:underline;">Unsubscribe</a>
      </p>
    </div>
  `);

  const text = `Newsletter from Financial Modeler Pro\n\nTo unsubscribe: ${unsubscribeUrl}`;

  return { html, text };
}
