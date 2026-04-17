import { baseLayoutBranded, h1, p, button, divider } from './_base';

const LEARN_URL = process.env.NEXT_PUBLIC_LEARN_URL ?? 'https://learn.financialmodelerpro.com';

interface RegistrationConfirmationData {
  name: string;
  registrationId: string;
  courseName: string;
}

export async function registrationConfirmationTemplate({ name, registrationId, courseName }: RegistrationConfirmationData) {
  const subject = `Welcome to ${courseName} - Your Registration is Confirmed`;

  const html = await baseLayoutBranded(`
    ${h1('Registration Confirmed!')}
    ${p(`Hi <strong>${name}</strong>,`)}
    ${p(`Welcome to <strong>Financial Modeler Pro Training</strong>! You are now enrolled in <strong>${courseName}</strong>. Save your Registration ID - you will need it to sign in.`)}

    <div style="background:#F0F6FF;border-left:4px solid #2E75B6;border-radius:6px;padding:20px 24px;margin:24px 0;">
      <div style="font-size:12px;color:#64748B;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:6px;">Your Registration ID</div>
      <div style="font-size:26px;font-weight:800;color:#1F3864;letter-spacing:3px;font-family:monospace;">${registrationId}</div>
    </div>

    ${p('Use this ID along with your email address to sign in to the Training Dashboard.')}

    <div style="text-align:center;margin:28px 0;">
      ${button('Go to Training Dashboard', `${LEARN_URL}/signin`)}
    </div>

    ${divider()}
    ${p('If you have any questions, our support team is here to help.', 'font-size:13px;color:#64748B;')}
  `);

  const text = `Welcome to Financial Modeler Pro Training!\n\nHi ${name},\n\nYou are now enrolled in ${courseName}.\n\nYour Registration ID: ${registrationId}\n\nSign in at: ${LEARN_URL}/signin\n\nKeep this ID safe - you need it to access your courses.`;

  return { subject, html, text };
}
