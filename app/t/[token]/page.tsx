import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getServerClient } from '@/src/lib/supabase';
import { getStudentProgress, getCertificatesByEmail } from '@/src/lib/sheets';
import { COURSES } from '@/src/config/courses';
import type { Metadata } from 'next';

// Revalidate every 5 minutes so the view is reasonably fresh
export const revalidate = 300;

// ── Types ─────────────────────────────────────────────────────────────────────
interface ProgRow { sessionId: string; passed: boolean; score: number; attempts: number; }
interface CertData { certificateId: string; issuedAt: string; certifierUrl: string; }

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtDate(d?: string | null) {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }); }
  catch { return d; }
}
function today() {
  return new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

// ── Metadata ──────────────────────────────────────────────────────────────────
export async function generateMetadata(
  { params }: { params: Promise<{ token: string }> },
): Promise<Metadata> {
  return {
    title: 'Verified Transcript — Financial Modeler Pro',
    description: 'Official academic transcript issued by Financial Modeler Pro Training Hub.',
  };
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default async function PublicTranscriptPage(
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  // ── Look up the token ──────────────────────────────────────────────────────
  const sb = getServerClient();
  const { data: link } = await sb
    .from('transcript_links')
    .select('registration_id, email, course_id, created_at, view_count')
    .eq('token', token)
    .eq('is_active', true)
    .maybeSingle();

  if (!link) notFound();

  // Increment view count (best-effort, don't block render)
  sb.from('transcript_links')
    .update({ view_count: (link.view_count ?? 0) + 1 })
    .eq('token', token)
    .then(() => {});

  // ── Fetch progress ─────────────────────────────────────────────────────────
  const [progressResult, certsResult] = await Promise.all([
    getStudentProgress(link.email, link.registration_id),
    getCertificatesByEmail(link.email),
  ]);

  if (!progressResult.success || !progressResult.data) notFound();

  const { student, sessions } = progressResult.data;
  const courseId = link.course_id;
  const course   = COURSES[courseId];
  if (!course) notFound();

  // Build progress map
  const progMap = new Map<string, ProgRow>();
  for (const s of sessions) {
    progMap.set(s.sessionId, { sessionId: s.sessionId, passed: s.passed, score: s.score, attempts: s.attempts });
  }

  // Build cert map
  const certMap = new Map<string, CertData>();
  if (certsResult.success && certsResult.data) {
    for (const c of certsResult.data) {
      const k = c.course?.toLowerCase().includes('bvm') ? 'bvm' : '3sfm';
      certMap.set(k, { certificateId: c.certificateId, issuedAt: c.issuedAt, certifierUrl: c.certifierUrl });
    }
  }

  const regularSessions  = course.sessions.filter(s => !s.isFinal);
  const finalSession     = course.sessions.find(s => s.isFinal);
  const passedCount      = regularSessions.filter(s => progMap.get(s.id)?.passed).length;
  const finalProg        = finalSession ? progMap.get(finalSession.id) : undefined;
  const allComplete      = passedCount === regularSessions.length && !!finalProg?.passed;
  const cert             = certMap.get(courseId) ?? null;
  const scoresArr        = regularSessions.map(s => progMap.get(s.id)).filter(p => p && p.attempts > 0).map(p => p!.score);
  const avgScore         = scoresArr.length ? Math.round(scoresArr.reduce((a, b) => a + b, 0) / scoresArr.length) : null;
  const pdfUrl           = `/api/t/${token}/pdf`;

  // ── Brand colours ──────────────────────────────────────────────────────────
  const C = {
    navy:   '#0D2E5A',
    navy2:  '#1B4F8A',
    green:  '#2EAA4A',
    gold:   '#C9A84C',
    text:   '#111827',
    muted:  '#6B7280',
    border: '#E5E7EB',
    lBlue:  '#EBF3FC',
    lGrey:  '#F9FAFB',
  };

  return (
    <div style={{ fontFamily: "'Inter','Helvetica Neue',sans-serif", background: '#E8EDF5', minHeight: '100vh' }}>

      {/* ── Verification banner ──────────────────────────────────────────────── */}
      <div style={{ background: C.navy, padding: '10px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 16 }}>🔒</span>
          <div>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>Verified Academic Transcript</span>
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginLeft: 10 }}>
              Issued by Financial Modeler Pro Training Hub
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>Token: {token.slice(0, 8)}…</span>
          <a href={pdfUrl}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 16px', background: C.green, color: '#fff', borderRadius: 6, fontWeight: 700, fontSize: 12, textDecoration: 'none' }}>
            ⬇ Download PDF
          </a>
          <Link href="/training"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '7px 14px', background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.7)', borderRadius: 6, fontWeight: 600, fontSize: 12, textDecoration: 'none' }}>
            FMP Training Hub ↗
          </Link>
        </div>
      </div>

      {/* ── Transcript card ──────────────────────────────────────────────────── */}
      <div style={{ maxWidth: 820, margin: '32px auto', padding: '0 16px 48px' }}>
        <div style={{ background: '#fff', borderRadius: 12, overflow: 'hidden', boxShadow: '0 4px 32px rgba(0,0,0,0.12)' }}>

          {/* Header */}
          <div style={{ background: C.navy, padding: '18px 36px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 800, color: '#fff', marginBottom: 3 }}>Financial Modeler Pro</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginBottom: 1 }}>www.financialmodelerpro.com</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginBottom: 6 }}>Ahmad Din | Corporate Finance Expert</div>
              <div style={{ fontSize: 12, fontWeight: 800, color: '#90CAF9', letterSpacing: 1.5, textTransform: 'uppercase' }}>
                Official Academic Transcript
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ background: 'rgba(255,255,255,0.12)', borderRadius: 6, padding: '6px 14px', display: 'inline-block' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.8)' }}>FMP Training Hub</div>
              </div>
              {cert && (
                <div style={{ marginTop: 8 }}>
                  <span style={{ fontSize: 10, color: '#A7F3D0', fontWeight: 600 }}>✓ Certificate Verified</span>
                </div>
              )}
            </div>
          </div>

          {/* Student info strip */}
          <div style={{ background: C.lBlue, padding: '14px 36px', display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            {[
              [['Student Name', student.name || link.registration_id], ['Registration ID', link.registration_id], ['Email', link.email]],
              [['Course', course.title], ['Enrollment Date', fmtDate(student.registeredAt)], ['Issue Date', today()]],
            ].map((col, ci) => (
              <div key={ci} style={{ flex: 1, minWidth: 220 }}>
                {col.map(([lbl, val]) => (
                  <div key={lbl} style={{ display: 'flex', gap: 8, marginBottom: 5 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: C.navy2, minWidth: 120 }}>{lbl}</span>
                    <span style={{ fontSize: 12, color: C.text, fontWeight: lbl === 'Student Name' ? 700 : 400 }}>{val}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>

          {/* Status banner */}
          {allComplete ? (
            <div style={{ background: '#F0FFF4', padding: '10px 36px', borderTop: '2px solid #BBF7D0', borderBottom: '2px solid #BBF7D0' }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: '#166534' }}>✓ OFFICIAL TRANSCRIPT — Course Complete</div>
              <div style={{ fontSize: 11, color: '#166534', marginTop: 2 }}>
                All requirements fulfilled. Certificate issued as of {today()}.
              </div>
            </div>
          ) : (
            <div style={{ background: '#FFFBEB', padding: '10px 36px', borderTop: '2px solid #FDE68A', borderBottom: '2px solid #FDE68A' }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: '#92400E' }}>⏳ PROGRESS TRANSCRIPT — Course in Progress</div>
              <div style={{ fontSize: 11, color: '#92400E', marginTop: 2 }}>
                This transcript reflects current progress as of {today()}.
              </div>
            </div>
          )}

          {/* Session table */}
          <div style={{ padding: '20px 36px 0' }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
              <span style={{ fontSize: 13, fontWeight: 800, color: C.navy, marginRight: 12 }}>{course.title}</span>
              <div style={{ flex: 1, height: 1, background: C.border }} />
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: C.navy2 }}>
                    {['#', 'Session', 'Score', 'Status', 'Attempts'].map((h, hi) => (
                      <th key={h} style={{ padding: '8px 10px', textAlign: hi > 1 ? 'center' : 'left', fontSize: 10, fontWeight: 700, color: '#fff', letterSpacing: '0.06em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {regularSessions.map((sess, idx) => {
                    const prog = progMap.get(sess.id);
                    return (
                      <tr key={sess.id} style={{ background: idx % 2 === 1 ? C.lGrey : '#fff', borderBottom: `1px solid ${C.border}` }}>
                        <td style={{ padding: '7px 10px', fontSize: 11, color: C.muted, whiteSpace: 'nowrap' }}>{sess.id}</td>
                        <td style={{ padding: '7px 10px', fontSize: 12, color: C.text }}>{sess.title}</td>
                        <td style={{ padding: '7px 10px', fontSize: 12, fontWeight: 700, color: C.text, textAlign: 'center' }}>
                          {prog && prog.attempts > 0 ? `${prog.score}%` : '—'}
                        </td>
                        <td style={{ padding: '7px 10px', textAlign: 'center' }}>
                          {prog?.passed
                            ? <span style={{ fontSize: 10, fontWeight: 700, background: '#D1FAE5', color: '#065F46', borderRadius: 4, padding: '2px 8px' }}>PASSED</span>
                            : prog?.attempts
                              ? <span style={{ fontSize: 10, fontWeight: 700, background: '#FEE2E2', color: '#991B1B', borderRadius: 4, padding: '2px 8px' }}>FAILED</span>
                              : <span style={{ fontSize: 10, fontWeight: 700, background: '#F3F4F6', color: C.muted, borderRadius: 4, padding: '2px 8px' }}>NOT STARTED</span>
                          }
                        </td>
                        <td style={{ padding: '7px 10px', fontSize: 11, color: C.text, textAlign: 'center' }}>
                          {prog?.attempts ?? 0} / {sess.maxAttempts}
                        </td>
                      </tr>
                    );
                  })}

                  {/* Final exam */}
                  {finalSession && (() => {
                    const fp = progMap.get(finalSession.id);
                    return (
                      <tr style={{ background: '#FDF3DC', borderBottom: `1px solid ${C.border}` }}>
                        <td style={{ padding: '8px 10px', fontSize: 10, fontWeight: 800, color: C.gold }}>FINAL</td>
                        <td style={{ padding: '8px 10px' }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: C.text }}>{finalSession.title}</div>
                          <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>
                            {finalSession.questionCount} questions · Pass mark {finalSession.passingScore}%
                          </div>
                        </td>
                        <td style={{ padding: '8px 10px', fontSize: 12, fontWeight: 700, color: C.text, textAlign: 'center' }}>
                          {fp && fp.attempts > 0 ? `${fp.score}%` : '—'}
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                          {!passedCount && !fp?.attempts
                            ? <span style={{ fontSize: 10, fontWeight: 700, background: '#FEF3C7', color: '#92400E', borderRadius: 4, padding: '2px 8px' }}>LOCKED</span>
                            : fp?.passed
                              ? <span style={{ fontSize: 10, fontWeight: 700, background: '#D1FAE5', color: '#065F46', borderRadius: 4, padding: '2px 8px' }}>PASSED</span>
                              : fp?.attempts
                                ? <span style={{ fontSize: 10, fontWeight: 700, background: '#FEE2E2', color: '#991B1B', borderRadius: 4, padding: '2px 8px' }}>FAILED</span>
                                : <span style={{ fontSize: 10, fontWeight: 700, background: '#F3F4F6', color: C.muted, borderRadius: 4, padding: '2px 8px' }}>NOT STARTED</span>
                          }
                        </td>
                        <td style={{ padding: '8px 10px', fontSize: 11, color: C.text, textAlign: 'center' }}>
                          {fp?.attempts ?? 0} / {finalSession.maxAttempts}
                        </td>
                      </tr>
                    );
                  })()}
                </tbody>
              </table>
            </div>
          </div>

          {/* Summary boxes */}
          <div style={{ display: 'flex', gap: 16, padding: '20px 36px', flexWrap: 'wrap' }}>
            {/* Academic summary */}
            <div style={{ flex: 1, minWidth: 240, border: `1.5px solid ${C.navy2}`, borderRadius: 8, padding: '14px 16px' }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: C.navy, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 12 }}>
                Academic Summary — {course.shortTitle}
              </div>
              {[
                ['Sessions Passed',   `${passedCount} of ${regularSessions.length}`],
                ['Average Score',     avgScore !== null ? `${avgScore}%` : '—'],
                ['Final Exam Score',  finalProg?.passed ? `${finalProg.score}%` : finalProg?.attempts ? `${finalProg.score}% (failed)` : '—'],
                ['Overall Result',    allComplete ? 'PASSED' : 'IN PROGRESS'],
              ].map(([l, v]) => (
                <div key={l} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 11, color: C.muted }}>{l}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: v === 'PASSED' ? C.green : v === 'IN PROGRESS' ? C.gold : C.text }}>{v}</span>
                </div>
              ))}
            </div>

            {/* Certification status */}
            <div style={{ flex: 1, minWidth: 240, border: `1.5px solid ${cert ? C.green : C.border}`, borderRadius: 8, padding: '14px 16px' }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: C.navy, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 12 }}>
                Certification Status
              </div>
              {[
                ['Status',         cert ? 'CERTIFIED' : allComplete ? 'PROCESSING' : 'NOT EARNED'],
                ['Certificate ID', cert?.certificateId ?? '—'],
                ['Issued',         cert ? fmtDate(cert.issuedAt) : '—'],
              ].map(([l, v]) => (
                <div key={l} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 11, color: C.muted }}>{l}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: v === 'CERTIFIED' ? C.green : v === 'PROCESSING' ? C.gold : C.text }}>{v}</span>
                </div>
              ))}
              {cert?.certifierUrl && (
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.border}` }}>
                  <a href={cert.certifierUrl} target="_blank" rel="noopener noreferrer"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: C.navy2, textDecoration: 'none', border: `1.5px solid ${C.navy2}`, borderRadius: 6, padding: '6px 14px' }}>
                    🏅 Verify on Certifier.io ↗
                  </a>
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div style={{ background: C.navy, padding: '12px 36px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)' }}>Issue Date: {today()}</span>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', textAlign: 'center' }}>
              This transcript is an official record issued by Financial Modeler Pro.
            </span>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)' }}>www.financialmodelerpro.com</span>
          </div>
        </div>

        {/* Download + share actions */}
        <div style={{ marginTop: 20, display: 'flex', justifyContent: 'center', gap: 12, flexWrap: 'wrap' }}>
          <a href={pdfUrl}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '11px 24px', background: C.navy, color: '#fff', borderRadius: 8, fontWeight: 700, fontSize: 14, textDecoration: 'none', boxShadow: '0 4px 16px rgba(13,46,90,0.25)' }}>
            ⬇ Download PDF
          </a>
          <Link href="/training"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '11px 24px', background: '#fff', color: C.navy2, borderRadius: 8, fontWeight: 700, fontSize: 14, textDecoration: 'none', border: `2px solid ${C.navy2}` }}>
            FMP Training Hub →
          </Link>
        </div>

        <p style={{ textAlign: 'center', fontSize: 11, color: '#9CA3AF', marginTop: 16 }}>
          This is a verified transcript. Share this URL to allow anyone to view and download it.
        </p>
      </div>
    </div>
  );
}
