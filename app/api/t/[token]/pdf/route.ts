import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/core/db/supabase';
import { getStudentProgressFromSupabase as getStudentProgress } from '@/src/hubs/training/lib/progress/progressFromSupabase';
import { COURSES } from '@/src/hubs/training/config/courses';

export const dynamic = 'force-dynamic';

const QR_API = 'https://api.qrserver.com/v1/create-qr-code';

function fmtDate(d?: string | null): string {
  if (!d) return '-';
  try { return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }); }
  catch { return d; }
}
function today(): string {
  return new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  const sb = getServerClient();
  const { data: link } = await sb
    .from('transcript_links')
    .select('registration_id, email, course_id')
    .eq('token', token)
    .eq('is_active', true)
    .maybeSingle();

  if (!link) {
    return new NextResponse('Transcript link not found or expired.', { status: 404 });
  }

  const courseId = link.course_id;
  const course   = COURSES[courseId];
  if (!course) {
    return new NextResponse('Course not found.', { status: 404 });
  }

  // Fetch progress + certificate data from single source of truth in parallel.
  // student_certificates is the canonical store - no Apps Script or external cert lookup.
  const [progressResult, { data: certRow }] = await Promise.all([
    getStudentProgress(link.email, link.registration_id),
    sb
      .from('student_certificates')
      .select('certificate_id, verification_url, issued_at, issued_date, cert_pdf_url, badge_url')
      .eq('registration_id', link.registration_id)
      .eq('course_code', courseId.toUpperCase())
      .maybeSingle(),
  ]);

  if (!progressResult.success || !progressResult.data) {
    return new NextResponse('Could not load student progress.', { status: 404 });
  }

  const { student, sessions } = progressResult.data;

  const progMap = new Map<string, { passed: boolean; score: number; attempts: number }>();
  for (const s of sessions) progMap.set(s.sessionId, { passed: s.passed, score: s.score, attempts: s.attempts });

  // Build cert data from Supabase only
  const certId    = certRow?.certificate_id ?? '';
  const verifyUrl = certRow?.verification_url ?? '';
  const issuedAt  = certRow?.issued_at ?? certRow?.issued_date ?? '';
  const hasCert   = !!certId;

  // QR encodes the same verificationUrl as the issued PDF - deterministic, no new generation logic.
  const qrSrc = verifyUrl
    ? `${QR_API}/?size=120x120&data=${encodeURIComponent(verifyUrl)}`
    : '';

  const regularSessions = course.sessions.filter(s => !s.isFinal);
  const finalSession    = course.sessions.find(s => s.isFinal);
  const passedCount     = regularSessions.filter(s => progMap.get(s.id)?.passed).length;
  const finalProg       = finalSession ? progMap.get(finalSession.id) : undefined;
  const allComplete     = passedCount === regularSessions.length && !!finalProg?.passed;
  const scoresArr       = regularSessions.map(s => progMap.get(s.id)).filter(p => p && p.attempts > 0).map(p => p!.score);
  const avgScore        = scoresArr.length ? Math.round(scoresArr.reduce((a, b) => a + b, 0) / scoresArr.length) : null;

  const rows = regularSessions.map(sess => {
    const prog = progMap.get(sess.id);
    const statusLabel = prog?.passed ? 'PASSED' : prog?.attempts ? 'FAILED' : 'NOT STARTED';
    const statusColor = prog?.passed ? '#065F46' : prog?.attempts ? '#991B1B' : '#6B7280';
    const statusBg    = prog?.passed ? '#D1FAE5' : prog?.attempts ? '#FEE2E2' : '#F3F4F6';
    return `
      <tr>
        <td style="padding:6px 10px;font-size:11px;color:#6B7280;">${sess.id}</td>
        <td style="padding:6px 10px;font-size:12px;">${sess.title}</td>
        <td style="padding:6px 10px;font-size:12px;text-align:center;font-weight:700;">${prog && prog.attempts > 0 ? `${prog.score}%` : '-'}</td>
        <td style="padding:6px 10px;text-align:center;">
          <span style="font-size:10px;font-weight:700;background:${statusBg};color:${statusColor};border-radius:4px;padding:2px 8px;">${statusLabel}</span>
        </td>
        <td style="padding:6px 10px;font-size:11px;text-align:center;">${prog?.attempts ?? 0} / ${sess.maxAttempts}</td>
      </tr>`;
  }).join('');

  const finalRow = finalSession ? (() => {
    const fp = progMap.get(finalSession.id);
    const st = fp?.passed ? 'PASSED' : fp?.attempts ? 'FAILED' : (!passedCount ? 'LOCKED' : 'NOT STARTED');
    const sc = fp?.passed ? '#065F46' : fp?.attempts ? '#991B1B' : '#92400E';
    const sb2= fp?.passed ? '#D1FAE5' : fp?.attempts ? '#FEE2E2' : fp ? '#F3F4F6' : '#FEF3C7';
    return `
      <tr style="background:#FDF3DC;">
        <td style="padding:8px 10px;font-size:10px;font-weight:800;color:#C9A84C;">FINAL</td>
        <td style="padding:8px 10px;font-size:12px;font-weight:700;">${finalSession.title}</td>
        <td style="padding:8px 10px;font-size:12px;text-align:center;font-weight:700;">${fp && fp.attempts > 0 ? `${fp.score}%` : '-'}</td>
        <td style="padding:8px 10px;text-align:center;">
          <span style="font-size:10px;font-weight:700;background:${sb2};color:${sc};border-radius:4px;padding:2px 8px;">${st}</span>
        </td>
        <td style="padding:8px 10px;font-size:11px;text-align:center;">${fp?.attempts ?? 0} / ${finalSession.maxAttempts}</td>
      </tr>`;
  })() : '';

  // Verify / QR section - only rendered when certificate exists
  const verifySection = hasCert && verifyUrl ? `
  <!-- Verify Certificate -->
  <div style="margin:0 36px 20px;border:1.5px solid #1B4F8A;border-radius:8px;padding:16px 20px;display:flex;align-items:flex-start;gap:20px;background:#F0F7FF;">
    ${qrSrc ? `<img src="${qrSrc}" alt="Certificate verification QR code" width="100" height="100" style="border-radius:6px;border:1px solid #E5E7EB;flex-shrink:0;" />` : ''}
    <div>
      <div style="font-size:12px;font-weight:800;color:#0D2E5A;margin-bottom:3px;">Verify Certificate</div>
      <div style="font-size:11px;color:#6B7280;margin-bottom:10px;">Scan QR code or use the link below</div>
      <a href="${verifyUrl}" style="display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:700;color:#1B4F8A;text-decoration:none;border:1.5px solid #1B4F8A;border-radius:6px;padding:6px 14px;background:#fff;">
        🔗 Verify Certificate ↗
      </a>
      <div style="margin-top:8px;font-size:10px;color:#9CA3AF;word-break:break-all;line-height:1.5;">${verifyUrl}</div>
    </div>
  </div>` : !hasCert ? `
  <div style="margin:0 36px 20px;padding:12px 16px;background:#F9FAFB;border-radius:8px;border:1px solid #E5E7EB;">
    <div style="font-size:11px;color:#6B7280;">QR code and verification link will appear here once the certificate is issued.</div>
  </div>` : '';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Transcript -${student.name} - ${course.title}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; background: #fff; color: #111827; font-size: 13px; }
  @media screen {
    body { background: #E8EDF5; padding: 24px; }
    .card { max-width: 820px; margin: 0 auto; background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 32px rgba(0,0,0,0.12); }
    .print-note { max-width: 820px; margin: 16px auto; text-align: center; font-size: 12px; color: #9CA3AF; }
  }
  @media print {
    body { background: #fff; padding: 0; }
    .card { max-width: 100%; box-shadow: none; border-radius: 0; }
    .print-note, .no-print { display: none !important; }
    @page { margin: 12mm; size: A4 portrait; }
  }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; }
</style>
</head>
<body>
<div class="card">
  <!-- Header -->
  <div style="background:#0D2E5A;padding:18px 36px 14px;display:flex;justify-content:space-between;align-items:flex-start;">
    <div>
      <div style="font-size:15px;font-weight:800;color:#fff;margin-bottom:3px;">Financial Modeler Pro</div>
      <div style="font-size:11px;color:rgba(255,255,255,0.5);margin-bottom:1px;">www.financialmodelerpro.com</div>
      <div style="font-size:11px;color:rgba(255,255,255,0.5);margin-bottom:6px;">Ahmad Din | Corporate Finance Expert</div>
      <div style="font-size:12px;font-weight:800;color:#90CAF9;letter-spacing:1.5px;text-transform:uppercase;">OFFICIAL ACADEMIC TRANSCRIPT</div>
    </div>
    <div style="text-align:right;">
      <div style="background:rgba(255,255,255,0.12);border-radius:6px;padding:6px 14px;display:inline-block;">
        <div style="font-size:11px;font-weight:700;color:rgba(255,255,255,0.8);">FMP Training Hub</div>
      </div>
      ${hasCert ? `<div style="margin-top:8px;font-size:10px;color:#A7F3D0;font-weight:600;">Certificate Verified</div>` : ''}
    </div>
  </div>

  <!-- Student info -->
  <div style="background:#EBF3FC;padding:14px 36px;display:flex;gap:24px;flex-wrap:wrap;">
    <div style="flex:1;min-width:220px;">
      <div style="display:flex;gap:8px;margin-bottom:5px;"><span style="font-size:11px;font-weight:700;color:#1B4F8A;min-width:120px;">Student Name</span><span style="font-size:12px;font-weight:700;">${student.name || link.registration_id}</span></div>
      <div style="display:flex;gap:8px;margin-bottom:5px;"><span style="font-size:11px;font-weight:700;color:#1B4F8A;min-width:120px;">Registration ID</span><span style="font-size:12px;">${link.registration_id}</span></div>
      <div style="display:flex;gap:8px;margin-bottom:5px;"><span style="font-size:11px;font-weight:700;color:#1B4F8A;min-width:120px;">Email</span><span style="font-size:12px;">${link.email}</span></div>
    </div>
    <div style="flex:1;min-width:220px;">
      <div style="display:flex;gap:8px;margin-bottom:5px;"><span style="font-size:11px;font-weight:700;color:#1B4F8A;min-width:120px;">Course</span><span style="font-size:12px;">${course.title}</span></div>
      <div style="display:flex;gap:8px;margin-bottom:5px;"><span style="font-size:11px;font-weight:700;color:#1B4F8A;min-width:120px;">Enrollment Date</span><span style="font-size:12px;">${fmtDate(student.registeredAt)}</span></div>
      <div style="display:flex;gap:8px;margin-bottom:5px;"><span style="font-size:11px;font-weight:700;color:#1B4F8A;min-width:120px;">Issue Date</span><span style="font-size:12px;">${today()}</span></div>
    </div>
  </div>

  <!-- Status banner -->
  ${allComplete
    ? `<div style="background:#F0FFF4;padding:10px 36px;border-top:2px solid #BBF7D0;border-bottom:2px solid #BBF7D0;">
        <div style="font-size:12px;font-weight:800;color:#166534;">OFFICIAL TRANSCRIPT - Course Complete</div>
        <div style="font-size:11px;color:#166534;margin-top:2px;">All requirements fulfilled. Certificate issued as of ${hasCert ? fmtDate(issuedAt) : today()}.</div>
       </div>`
    : `<div style="background:#FFFBEB;padding:10px 36px;border-top:2px solid #FDE68A;border-bottom:2px solid #FDE68A;">
        <div style="font-size:12px;font-weight:800;color:#92400E;">PROGRESS TRANSCRIPT - Course in Progress</div>
        <div style="font-size:11px;color:#92400E;margin-top:2px;">This transcript reflects current progress as of ${today()}.</div>
       </div>`
  }

  <!-- Session table -->
  <div style="padding:20px 36px 0;">
    <div style="display:flex;align-items:center;margin-bottom:12px;">
      <span style="font-size:13px;font-weight:800;color:#0D2E5A;margin-right:12px;">${course.title}</span>
      <div style="flex:1;height:1px;background:#E5E7EB;"></div>
    </div>
    <table>
      <thead>
        <tr style="background:#1B4F8A;">
          ${['#', 'Session', 'Score', 'Status', 'Attempts'].map(h => `<th style="padding:8px 10px;text-align:left;font-size:10px;font-weight:700;color:#fff;letter-spacing:0.06em;text-transform:uppercase;white-space:nowrap;">${h}</th>`).join('')}
        </tr>
      </thead>
      <tbody>
        ${rows}
        ${finalRow}
      </tbody>
    </table>
  </div>

  <!-- Summary + Cert status -->
  <div style="display:flex;gap:16px;padding:20px 36px;flex-wrap:wrap;">
    <div style="flex:1;min-width:240px;border:1.5px solid #1B4F8A;border-radius:8px;padding:14px 16px;">
      <div style="font-size:11px;font-weight:800;color:#0D2E5A;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:12px;">Academic Summary -${course.shortTitle}</div>
      ${[
        ['Sessions Passed', `${passedCount} of ${regularSessions.length}`],
        ['Average Score', avgScore !== null ? `${avgScore}%` : '-'],
        ['Final Exam Score', finalProg?.passed ? `${finalProg.score}%` : finalProg?.attempts ? `${finalProg.score}% (failed)` : '-'],
        ['Overall Result', allComplete ? 'PASSED' : 'IN PROGRESS'],
      ].map(([l, v]) => `
        <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
          <span style="font-size:11px;color:#6B7280;">${l}</span>
          <span style="font-size:11px;font-weight:700;color:${v === 'PASSED' ? '#2EAA4A' : v === 'IN PROGRESS' ? '#C9A84C' : '#111827'};">${v}</span>
        </div>`).join('')}
    </div>
    <div style="flex:1;min-width:240px;border:1.5px solid ${hasCert ? '#2EAA4A' : '#E5E7EB'};border-radius:8px;padding:14px 16px;">
      <div style="font-size:11px;font-weight:800;color:#0D2E5A;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:12px;">Certification Status</div>
      ${[
        ['Status',           hasCert ? 'CERTIFIED' : allComplete ? 'PROCESSING' : 'NOT EARNED'],
        ['Certificate ID',   certId || '-'],
        ['Completion Date',  hasCert ? fmtDate(issuedAt) : '-'],
      ].map(([l, v]) => `
        <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
          <span style="font-size:11px;color:#6B7280;">${l}</span>
          <span style="font-size:11px;font-weight:700;font-family:${l === 'Certificate ID' ? 'monospace' : 'inherit'};color:${v === 'CERTIFIED' ? '#2EAA4A' : v === 'PROCESSING' ? '#C9A84C' : '#111827'};">${v}</span>
        </div>`).join('')}
      ${!hasCert && allComplete ? `<div style="margin-top:8px;font-size:11px;color:#C9A84C;">Certificate is being processed. Check back shortly.</div>` : ''}
      ${!hasCert && !allComplete ? `<div style="margin-top:8px;font-size:11px;color:#6B7280;">Complete all sessions and the final exam to earn your certificate.</div>` : ''}
    </div>
  </div>

  ${verifySection}

  <!-- Footer -->
  <div style="background:#0D2E5A;padding:12px 36px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
    <span style="font-size:10px;color:rgba(255,255,255,0.45);">Issue Date: ${today()}</span>
    <span style="font-size:10px;color:rgba(255,255,255,0.45);text-align:center;flex:1;">This transcript is an official record issued by Financial Modeler Pro.</span>
    <span style="font-size:10px;color:rgba(255,255,255,0.45);">www.financialmodelerpro.com</span>
  </div>
</div>

<p class="print-note">Use your browser's Print function (Ctrl+P / Cmd+P) to save as PDF.</p>
<script>
  if (window.location.search.includes('autoprint=1')) {
    window.onload = function() { window.print(); };
  }
</script>
</body>
</html>`;

  return new NextResponse(html, {
    status: 200,
    headers: {
      'Content-Type':  'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
