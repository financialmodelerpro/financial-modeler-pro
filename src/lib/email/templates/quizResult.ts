import { baseLayout, h1, p, button, divider } from './_base';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://financialmodelerpro.com';

interface QuizResultData {
  name?: string;
  sessionName: string;
  score: number;
  passMark: number;
  passed: boolean;
  attemptsUsed?: number;
  maxAttempts?: number;
}

export function quizResultTemplate({ name, sessionName, score, passMark, passed, attemptsUsed, maxAttempts }: QuizResultData) {
  const subject = passed
    ? `✓ Passed: ${sessionName} — Score ${score}%`
    : `Result: ${sessionName} — Score ${score}%`;

  const scoreColor  = passed ? '#2EAA4A' : '#EF4444';
  const scoreBg     = passed ? '#F0FDF4' : '#FEF2F2';
  const borderColor = passed ? '#2EAA4A' : '#EF4444';
  const statusLabel = passed ? 'PASSED' : 'NOT PASSED';

  const html = baseLayout(`
    ${h1(passed ? `Well done${name ? `, ${name}` : ''}!` : `Result: ${sessionName}`)}
    ${name && !passed ? p(`Hi <strong>${name}</strong>,`) : ''}
    ${p(`Here are your results for <strong>${sessionName}</strong>:`)}

    <div style="background:${scoreBg};border:2px solid ${borderColor};border-radius:10px;padding:24px;text-align:center;margin:20px 0;">
      <div style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:${scoreColor};margin-bottom:8px;">${statusLabel}</div>
      <div style="font-size:48px;font-weight:800;color:${scoreColor};">${score}%</div>
      <div style="font-size:13px;color:#64748B;margin-top:6px;">Pass mark: ${passMark}%${attemptsUsed && maxAttempts ? ` &nbsp;·&nbsp; Attempt ${attemptsUsed} of ${maxAttempts}` : ''}</div>
    </div>

    ${passed
      ? p('Congratulations on passing this session! Continue to the next session to keep your progress going.')
      : p(`You need <strong>${passMark}%</strong> to pass. Review the material and try again when you are ready.`)
    }

    <div style="text-align:center;margin:24px 0;">
      ${button('Go to Training Dashboard', `${APP_URL}/training/dashboard`)}
    </div>

    ${divider()}
    ${p('Keep up the great work — every session brings you closer to your certificate.', 'font-size:13px;color:#64748B;')}
  `);

  const text = `Financial Modeler Pro — Quiz Result\n\n${name ? `Hi ${name},\n\n` : ''}Result for ${sessionName}: ${statusLabel}\nScore: ${score}% (Pass mark: ${passMark}%)\n\nDashboard: ${APP_URL}/training/dashboard`;

  return { subject, html, text };
}
