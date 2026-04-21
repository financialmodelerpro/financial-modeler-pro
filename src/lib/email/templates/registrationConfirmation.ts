import { baseLayoutBranded, h1, p, button, divider } from './_base';

const LEARN_URL = process.env.NEXT_PUBLIC_LEARN_URL ?? 'https://learn.financialmodelerpro.com';

interface RegistrationConfirmationData {
  name: string;
  registrationId: string;
  /**
   * Optional. When omitted or blank, the email skips course-specific
   * language and prompts the student to pick a course after sign-in.
   * Required when sending post-migration welcome emails where course
   * selection now happens on the dashboard, not at signup.
   */
  courseName?: string;
}

export async function registrationConfirmationTemplate({ name, registrationId, courseName }: RegistrationConfirmationData) {
  const hasCourse = Boolean(courseName && courseName.trim());
  const displayName = name && name.trim() ? name : 'Student';

  const subject = hasCourse
    ? `Welcome to ${courseName} - Your Registration is Confirmed`
    : 'Welcome to Financial Modeler Pro - Your Registration is Confirmed';

  const welcomeLine = hasCourse
    ? `Welcome to <strong>Financial Modeler Pro Training</strong>! You are now enrolled in <strong>${courseName}</strong>. Save your Registration ID - you will need it to sign in.`
    : `Welcome to <strong>Financial Modeler Pro Training</strong>! Your account is ready. Sign in and choose your first course from the dashboard. Save your Registration ID - you will need it whenever you sign in.`;

  const html = await baseLayoutBranded(`
    ${h1('Registration Confirmed!')}
    ${p(`Hi <strong>${displayName}</strong>,`)}
    ${p(welcomeLine)}

    <div style="background:#F0F6FF;border-left:4px solid #2E75B6;border-radius:6px;padding:20px 24px;margin:24px 0;">
      <div style="font-size:12px;color:#64748B;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:6px;">Your Registration ID</div>
      <div style="font-size:26px;font-weight:800;color:#1F3864;letter-spacing:3px;font-family:monospace;">${registrationId}</div>
    </div>

    ${p('Use this ID along with your email address to sign in to the Training Dashboard.')}

    <div style="text-align:center;margin:28px 0;">
      ${button(hasCourse ? 'Go to Training Dashboard' : 'Sign In and Choose Your Course', `${LEARN_URL}/signin`)}
    </div>

    ${divider()}
    ${p('If you have any questions, our support team is here to help.', 'font-size:13px;color:#64748B;')}
  `);

  const textCourseLine = hasCourse
    ? `You are now enrolled in ${courseName}.`
    : 'Sign in to pick your first course.';

  const text = `Welcome to Financial Modeler Pro Training!\n\nHi ${displayName},\n\n${textCourseLine}\n\nYour Registration ID: ${registrationId}\n\nSign in at: ${LEARN_URL}/signin\n\nKeep this ID safe - you need it to access your courses.`;

  return { subject, html, text };
}
