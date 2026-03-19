'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface QuestionOption {
  text: string;
}

interface Question {
  id: string;
  question: string;
  options: QuestionOption[];
  points: number;
}

interface Assessment {
  id: string;
  title: string;
  description: string;
  pass_score: number;
  time_limit: number | null;
  max_attempts: number;
  assessment_questions: Question[];
}

interface Attempt {
  id: string;
  score: number;
  passed: boolean;
  submitted_at: string;
  time_taken: number | null;
}

interface Certificate {
  certificate_number: string;
  issued_at: string;
}

interface GradedQuestion {
  id: string;
  correct_index: number;
  selected_index: number | null;
}

interface SubmitResult {
  score: number;
  passed: boolean;
  certificate: Certificate | null;
  gradedQuestions: GradedQuestion[];
}

type PageState = 'loading' | 'overview' | 'taking' | 'results';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AssessmentPage() {
  const params = useParams();
  const courseId = params.courseId as string;

  const [pageState, setPageState] = useState<PageState>('loading');
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [certificate, setCertificate] = useState<Certificate | null>(null);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [submitResult, setSubmitResult] = useState<SubmitResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);

  // ── Fetch overview data ────────────────────────────────────────────────────

  useEffect(() => {
    fetch(`/api/training/${courseId}/assessment`)
      .then(r => r.json())
      .then(data => {
        if (!data || data.error) {
          setError(data?.error ?? 'Assessment not found');
          setPageState('overview');
          return;
        }
        setAssessment(data.assessment);
        setAttempts(data.attempts ?? []);
        setCertificate(data.certificate ?? null);
        setPageState('overview');
      })
      .catch(() => {
        setError('Failed to load assessment');
        setPageState('overview');
      });
  }, [courseId]);

  // ── Timer ──────────────────────────────────────────────────────────────────

  const handleSubmit = useCallback(async (timedOut = false) => {
    if (!assessment) return;
    if (!timedOut && !confirm('Are you sure you want to submit your assessment? You cannot change answers after submitting.')) return;

    setSubmitting(true);
    if (timerRef.current) clearInterval(timerRef.current);

    const timeTaken = Math.round((Date.now() - startTimeRef.current) / 1000);

    try {
      const res = await fetch(`/api/training/${courseId}/assessment/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assessmentId: assessment.id, answers, timeTaken }),
      });
      const data = await res.json() as SubmitResult & { error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Submission failed');
      setSubmitResult(data);
      if (data.certificate) setCertificate(data.certificate);
      setPageState('results');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Submission failed');
    } finally {
      setSubmitting(false);
    }
  }, [assessment, answers, courseId]);

  useEffect(() => {
    if (pageState !== 'taking' || !assessment?.time_limit) return;

    const totalSeconds = assessment.time_limit * 60;
    setTimeLeft(totalSeconds);
    startTimeRef.current = Date.now();

    timerRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev === null || prev <= 1) {
          clearInterval(timerRef.current!);
          handleSubmit(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [pageState, assessment?.time_limit, handleSubmit]);

  // ── Derived state ──────────────────────────────────────────────────────────

  const hasPassed = attempts.some(a => a.passed) || !!certificate;
  const attemptsUsed = attempts.length;
  const maxAttempts = assessment?.max_attempts ?? 0;
  const attemptsExhausted = !hasPassed && attemptsUsed >= maxAttempts;
  const canStart = !!assessment && !hasPassed && !attemptsExhausted;

  function startAssessment() {
    setAnswers({});
    setSubmitResult(null);
    setError(null);
    startTimeRef.current = Date.now();
    setPageState('taking');
  }

  // ─── Styles ─────────────────────────────────────────────────────────────────

  const pageStyle: React.CSSProperties = {
    fontFamily: "'Inter', sans-serif",
    background: '#F4F7FC',
    minHeight: '100vh',
    padding: '40px 20px',
  };

  const containerStyle: React.CSSProperties = {
    maxWidth: 800,
    margin: '0 auto',
  };

  const cardStyle: React.CSSProperties = {
    background: '#fff',
    borderRadius: 16,
    padding: 40,
    boxShadow: '0 2px 16px rgba(27,58,107,0.07)',
    marginBottom: 24,
  };

  const btnPrimary: React.CSSProperties = {
    background: '#1B4F8A',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    padding: '12px 28px',
    fontSize: 14,
    fontWeight: 700,
    cursor: 'pointer',
  };

  const btnSecondary: React.CSSProperties = {
    background: '#fff',
    color: '#1B4F8A',
    border: '1px solid #1B4F8A',
    borderRadius: 8,
    padding: '12px 28px',
    fontSize: 14,
    fontWeight: 700,
    cursor: 'pointer',
  };

  // ─── Loading ─────────────────────────────────────────────────────────────────

  if (pageState === 'loading') {
    return (
      <div style={pageStyle}>
        <div style={{ ...containerStyle, textAlign: 'center', paddingTop: 80 }}>
          <div style={{ fontSize: 14, color: '#6B7280' }}>Loading assessment…</div>
        </div>
      </div>
    );
  }

  // ─── Overview ────────────────────────────────────────────────────────────────

  if (pageState === 'overview') {
    return (
      <div style={pageStyle}>
        <div style={containerStyle}>

          {/* Breadcrumb */}
          <div style={{ marginBottom: 24, fontSize: 13, color: '#6B7280' }}>
            <Link href="/training" style={{ color: '#1B4F8A', textDecoration: 'none', fontWeight: 600 }}>Training Library</Link>
            <span style={{ margin: '0 8px' }}>›</span>
            <Link href={`/training/${courseId}`} style={{ color: '#1B4F8A', textDecoration: 'none', fontWeight: 600 }}>Course</Link>
            <span style={{ margin: '0 8px' }}>›</span>
            <span>Assessment</span>
          </div>

          {error && (
            <div style={{ background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 10, padding: '16px 20px', marginBottom: 24, color: '#7F1D1D', fontSize: 14 }}>
              {error}
            </div>
          )}

          {!assessment ? (
            <div style={cardStyle}>
              <div style={{ textAlign: 'center', padding: '40px 0', color: '#6B7280' }}>
                <div style={{ fontSize: 48, marginBottom: 16 }}>📋</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#1B3A6B', marginBottom: 8 }}>No Assessment Available</div>
                <div style={{ fontSize: 14 }}>This course does not have an assessment yet.</div>
              </div>
            </div>
          ) : (
            <>
              {/* Certificate banner */}
              {certificate && (
                <div style={{ background: '#ECFDF5', border: '1px solid #6EE7B7', borderRadius: 10, padding: 20, marginBottom: 24 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 32 }}>🏆</span>
                    <div>
                      <div style={{ fontSize: 16, fontWeight: 800, color: '#065F46', marginBottom: 4 }}>
                        Congratulations — You are Certified!
                      </div>
                      <div style={{ fontSize: 13, color: '#047857' }}>
                        Certificate #{certificate.certificate_number} · Issued {formatDate(certificate.issued_at)}
                      </div>
                    </div>
                    <div style={{ marginLeft: 'auto' }}>
                      <Link
                        href="/training/certificates"
                        style={{ ...btnPrimary, background: '#059669', textDecoration: 'none', display: 'inline-block' }}
                      >
                        View Certificate →
                      </Link>
                    </div>
                  </div>
                </div>
              )}

              {/* Main card */}
              <div style={cardStyle}>
                <h1 style={{ fontSize: 26, fontWeight: 800, color: '#1B3A6B', marginBottom: 8 }}>
                  {assessment.title}
                </h1>
                <p style={{ fontSize: 14, color: '#6B7280', lineHeight: 1.65, marginBottom: 32 }}>
                  {assessment.description}
                </p>

                {/* Meta grid */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 16, marginBottom: 32 }}>
                  {[
                    { label: 'Questions', value: assessment.assessment_questions.length.toString() },
                    { label: 'Pass Score', value: `${assessment.pass_score}%` },
                    { label: 'Time Limit', value: assessment.time_limit ? `${assessment.time_limit} min` : 'No limit' },
                    { label: 'Max Attempts', value: assessment.max_attempts.toString() },
                  ].map(m => (
                    <div key={m.label} style={{ background: '#F4F7FC', borderRadius: 10, padding: '16px 20px', textAlign: 'center' }}>
                      <div style={{ fontSize: 22, fontWeight: 800, color: '#1B3A6B', marginBottom: 4 }}>{m.value}</div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{m.label}</div>
                    </div>
                  ))}
                </div>

                {/* Attempts history */}
                {attempts.length > 0 && (
                  <div style={{ marginBottom: 28 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>Previous Attempts</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {attempts.map((a, i) => (
                        <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 12, background: '#F9FAFB', border: '1px solid #E8F0FB', borderRadius: 8, padding: '10px 16px', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 12, color: '#9CA3AF', width: 24, textAlign: 'center', fontWeight: 700 }}>#{attempts.length - i}</span>
                          <span style={{ fontSize: 22, fontWeight: 800, color: a.passed ? '#059669' : '#DC2626', minWidth: 52 }}>{a.score}%</span>
                          <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: a.passed ? '#ECFDF5' : '#FEF2F2', color: a.passed ? '#065F46' : '#7F1D1D', border: `1px solid ${a.passed ? '#6EE7B7' : '#FCA5A5'}` }}>
                            {a.passed ? 'PASSED' : 'FAILED'}
                          </span>
                          <span style={{ fontSize: 12, color: '#9CA3AF', marginLeft: 'auto' }}>{formatDate(a.submitted_at)}</span>
                          {a.time_taken !== null && (
                            <span style={{ fontSize: 12, color: '#9CA3AF' }}>{formatTime(a.time_taken)}</span>
                          )}
                        </div>
                      ))}
                    </div>
                    <div style={{ marginTop: 10, fontSize: 12, color: '#9CA3AF' }}>
                      {attemptsUsed} of {maxAttempts} attempt{maxAttempts !== 1 ? 's' : ''} used
                    </div>
                  </div>
                )}

                {/* CTA */}
                {attemptsExhausted ? (
                  <div style={{ background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 10, padding: '16px 20px', color: '#7F1D1D', fontSize: 14, fontWeight: 600 }}>
                    No more attempts available. You have used all {maxAttempts} attempt{maxAttempts !== 1 ? 's' : ''}.
                  </div>
                ) : !hasPassed ? (
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                    <button onClick={startAssessment} style={btnPrimary} disabled={!canStart}>
                      {attemptsUsed === 0 ? 'Start Assessment' : 'Retry Assessment'}
                    </button>
                    <Link href={`/training/${courseId}`} style={{ ...btnSecondary, textDecoration: 'none', display: 'inline-block' }}>
                      ← Back to Course
                    </Link>
                  </div>
                ) : (
                  <Link href={`/training/${courseId}`} style={{ ...btnSecondary, textDecoration: 'none', display: 'inline-block' }}>
                    ← Back to Course
                  </Link>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  // ─── Taking ───────────────────────────────────────────────────────────────────

  if (pageState === 'taking' && assessment) {
    const questions = assessment.assessment_questions;
    const answeredCount = Object.keys(answers).length;
    const isTimeLow = timeLeft !== null && timeLeft < 120;

    return (
      <div style={pageStyle}>
        <div style={containerStyle}>

          {/* Header bar */}
          <div style={{ background: '#fff', borderRadius: 12, padding: '16px 24px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', boxShadow: '0 2px 8px rgba(27,58,107,0.06)' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: '#1B3A6B' }}>{assessment.title}</div>
              <div style={{ fontSize: 12, color: '#9CA3AF', marginTop: 2 }}>
                {answeredCount} of {questions.length} answered
              </div>
            </div>

            {timeLeft !== null && (
              <div style={{ fontSize: 14, fontWeight: 700, color: isTimeLow ? '#DC2626' : '#1B3A6B', background: isTimeLow ? '#FEF2F2' : '#F4F7FC', border: `1px solid ${isTimeLow ? '#FCA5A5' : '#E8F0FB'}`, borderRadius: 8, padding: '6px 14px', transition: 'all 0.3s' }}>
                ⏱ {formatTime(timeLeft)}
              </div>
            )}

            <button
              onClick={() => handleSubmit(false)}
              disabled={submitting || answeredCount === 0}
              style={{ ...btnPrimary, opacity: answeredCount === 0 ? 0.5 : 1 }}
            >
              {submitting ? 'Submitting…' : 'Submit Assessment'}
            </button>
          </div>

          {/* Questions */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {questions.map((q, qi) => (
              <div key={q.id} style={{ background: '#fff', border: '1px solid #E8F0FB', borderRadius: 10, padding: 20, boxShadow: '0 1px 4px rgba(27,58,107,0.04)' }}>
                <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
                  <span style={{ flexShrink: 0, width: 26, height: 26, borderRadius: '50%', background: answers[q.id] !== undefined ? '#1B4F8A' : '#E8F0FB', color: answers[q.id] !== undefined ? '#fff' : '#6B7280', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s' }}>
                    {qi + 1}
                  </span>
                  <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: '#1B3A6B', lineHeight: 1.55 }}>{q.question}</p>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingLeft: 38 }}>
                  {q.options.map((opt, oi) => {
                    const selected = answers[q.id] === oi;
                    return (
                      <button
                        key={oi}
                        onClick={() => setAnswers(prev => ({ ...prev, [q.id]: oi }))}
                        style={{
                          display: 'block',
                          width: '100%',
                          textAlign: 'left',
                          border: selected ? '2px solid #1B4F8A' : '1px solid #D1D5DB',
                          borderRadius: 8,
                          padding: '12px 16px',
                          cursor: 'pointer',
                          fontSize: 13,
                          fontWeight: selected ? 600 : 400,
                          color: selected ? '#1B3A6B' : '#374151',
                          background: selected ? '#EBF2FF' : '#fff',
                          transition: 'all 0.15s',
                          fontFamily: "'Inter', sans-serif",
                        }}
                      >
                        <span style={{ fontWeight: 700, color: selected ? '#1B4F8A' : '#9CA3AF', marginRight: 10 }}>
                          {String.fromCharCode(65 + oi)}.
                        </span>
                        {opt.text}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* Submit footer */}
          <div style={{ background: '#fff', borderRadius: 12, padding: '20px 24px', marginTop: 20, display: 'flex', justifyContent: 'flex-end', gap: 12, boxShadow: '0 2px 8px rgba(27,58,107,0.06)' }}>
            <button
              onClick={() => { if (confirm('Cancel assessment? Your progress will be lost.')) setPageState('overview'); }}
              style={btnSecondary}
            >
              Cancel
            </button>
            <button
              onClick={() => handleSubmit(false)}
              disabled={submitting || answeredCount === 0}
              style={{ ...btnPrimary, opacity: answeredCount === 0 ? 0.5 : 1 }}
            >
              {submitting ? 'Submitting…' : `Submit Assessment (${answeredCount}/${questions.length})`}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Results ──────────────────────────────────────────────────────────────────

  if (pageState === 'results' && submitResult && assessment) {
    const { score, passed, gradedQuestions } = submitResult;
    const newCert = submitResult.certificate;
    const attemptsRemaining = assessment.max_attempts - (attemptsUsed + 1);

    const gradedMap = new Map<string, GradedQuestion>(
      gradedQuestions.map(g => [g.id, g])
    );

    return (
      <div style={pageStyle}>
        <div style={containerStyle}>

          {/* Score banner */}
          <div style={{ background: '#fff', borderRadius: 16, padding: 40, marginBottom: 20, textAlign: 'center', boxShadow: '0 2px 16px rgba(27,58,107,0.07)' }}>
            <div style={{ fontSize: 64, fontWeight: 900, color: passed ? '#059669' : '#DC2626', lineHeight: 1, marginBottom: 12 }}>
              {score}%
            </div>
            <div style={{ marginBottom: passed && newCert ? 24 : 0 }}>
              <span style={{
                display: 'inline-block',
                fontSize: 16,
                fontWeight: 800,
                padding: '8px 24px',
                borderRadius: 24,
                background: passed ? '#ECFDF5' : '#FEF2F2',
                border: `1px solid ${passed ? '#6EE7B7' : '#FCA5A5'}`,
                color: passed ? '#065F46' : '#7F1D1D',
              }}>
                {passed ? '✓ PASSED' : '✗ FAILED'}
              </span>
            </div>

            {/* Certificate display */}
            {passed && newCert && (
              <div style={{ marginTop: 24, background: '#ECFDF5', border: '1px solid #6EE7B7', borderRadius: 10, padding: 20, maxWidth: 480, margin: '24px auto 0' }}>
                <div style={{ fontSize: 24, marginBottom: 8 }}>🎉</div>
                <div style={{ fontSize: 15, fontWeight: 800, color: '#065F46', marginBottom: 8 }}>
                  You&rsquo;ve earned a certificate!
                </div>
                <div style={{ fontSize: 13, color: '#047857', marginBottom: 12 }}>
                  Your certificate number is:
                </div>
                <div style={{ fontFamily: "'Courier New', monospace", fontSize: 18, fontWeight: 700, color: '#1B3A6B', background: '#fff', border: '1px solid #6EE7B7', borderRadius: 8, padding: '10px 20px', letterSpacing: '0.08em', display: 'inline-block', marginBottom: 16 }}>
                  {newCert.certificate_number}
                </div>
                <div>
                  <Link href="/training/certificates" style={{ ...btnPrimary, background: '#059669', textDecoration: 'none', display: 'inline-block' }}>
                    View All Certificates →
                  </Link>
                </div>
              </div>
            )}

            {!passed && (
              <div style={{ marginTop: 12, fontSize: 13, color: '#6B7280' }}>
                Pass score: {assessment.pass_score}%
                {attemptsRemaining > 0
                  ? ` · ${attemptsRemaining} attempt${attemptsRemaining !== 1 ? 's' : ''} remaining`
                  : ' · No more attempts available'}
              </div>
            )}
          </div>

          {/* Question review */}
          <div style={{ background: '#fff', borderRadius: 16, padding: 32, marginBottom: 20, boxShadow: '0 2px 16px rgba(27,58,107,0.07)' }}>
            <h2 style={{ fontSize: 16, fontWeight: 800, color: '#1B3A6B', marginBottom: 20 }}>Question Review</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {assessment.assessment_questions.map((q, qi) => {
                const graded = gradedMap.get(q.id);
                const correctIdx = graded?.correct_index ?? -1;
                const selectedIdx = graded?.selected_index ?? null;
                const isCorrect = selectedIdx !== null && selectedIdx === correctIdx;

                return (
                  <div key={q.id} style={{ border: `1px solid ${isCorrect ? '#6EE7B7' : '#FCA5A5'}`, borderRadius: 10, padding: 16, background: isCorrect ? '#F0FDF4' : '#FFF5F5' }}>
                    <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
                      <span style={{ flexShrink: 0, width: 22, height: 22, borderRadius: '50%', background: isCorrect ? '#059669' : '#DC2626', color: '#fff', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {qi + 1}
                      </span>
                      <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#1B3A6B', lineHeight: 1.5 }}>{q.question}</p>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingLeft: 32 }}>
                      {q.options.map((opt, oi) => {
                        const isSelected = selectedIdx === oi;
                        const isCorrectOpt = correctIdx === oi;

                        let optStyle: React.CSSProperties = { border: '1px solid #E5E7EB', background: '#fff', color: '#374151' };
                        if (isCorrectOpt) optStyle = { border: '1px solid #6EE7B7', background: '#ECFDF5', color: '#065F46' };
                        if (isSelected && !isCorrectOpt) optStyle = { border: '1px solid #FCA5A5', background: '#FEF2F2', color: '#7F1D1D' };

                        return (
                          <div key={oi} style={{ ...optStyle, borderRadius: 8, padding: '8px 12px', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontWeight: 700, fontSize: 12, minWidth: 18 }}>
                              {String.fromCharCode(65 + oi)}.
                            </span>
                            <span style={{ flex: 1 }}>{opt.text}</span>
                            {isCorrectOpt && <span style={{ fontSize: 11, fontWeight: 700, color: '#059669' }}>✓ Correct</span>}
                            {isSelected && !isCorrectOpt && <span style={{ fontSize: 11, fontWeight: 700, color: '#DC2626' }}>✗ Your answer</span>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {!passed && attemptsRemaining > 0 && (
              <button onClick={startAssessment} style={btnPrimary}>
                Try Again ({attemptsRemaining} left)
              </button>
            )}
            <Link href={`/training/${courseId}`} style={{ ...btnSecondary, textDecoration: 'none', display: 'inline-block' }}>
              ← Back to Course
            </Link>
            <Link href="/training" style={{ ...btnSecondary, textDecoration: 'none', display: 'inline-block', border: '1px solid #D1D5DB', color: '#6B7280' }}>
              Training Library
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
