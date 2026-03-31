'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import type {
  AssessmentQuestionsData,
  AssessmentQuestion,
  AttemptStatus,
  SubmitAssessmentResult,
} from '@/src/lib/sheets';
import { COURSES } from '@/src/config/courses';

// Resolve a human-readable session name from a tabKey (e.g. "3SFM_S1" → "Session 1: Introduction…")
function getSessionTitleFromTabKey(tabKey: string): string {
  const sep = tabKey.indexOf('_');
  if (sep === -1) return tabKey;
  const shortTitle = tabKey.slice(0, sep).toUpperCase();
  const sessionId  = tabKey.slice(sep + 1);
  const course = Object.values(COURSES).find(c => c.shortTitle.toUpperCase() === shortTitle);
  return course?.sessions.find(s => s.id === sessionId)?.title ?? tabKey;
}

// ── Training session helper ───────────────────────────────────────────────────

function getTrainingSession(): { email: string; registrationId: string } | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem('training_session');
    if (!raw) return null;
    return JSON.parse(raw) as { email: string; registrationId: string };
  } catch {
    return null;
  }
}

// ── localStorage answer persistence ──────────────────────────────────────────

function loadSavedAnswers(tabKey: string): Record<number, number> {
  try {
    const raw = localStorage.getItem(`assessment_answers_${tabKey}`);
    return raw ? JSON.parse(raw) as Record<number, number> : {};
  } catch {
    return {};
  }
}

function saveAnswers(tabKey: string, answers: Record<number, number>) {
  try {
    localStorage.setItem(`assessment_answers_${tabKey}`, JSON.stringify(answers));
  } catch { /* ignore */ }
}

function clearSavedAnswers(tabKey: string) {
  try {
    localStorage.removeItem(`assessment_answers_${tabKey}`);
  } catch { /* ignore */ }
}

// ── Types ─────────────────────────────────────────────────────────────────────

type PageState =
  | 'loading'
  | 'blocked-passed'
  | 'blocked-no-attempts'
  | 'ready'
  | 'taking'
  | 'submitting'
  | 'results';

// ── Colour tokens ─────────────────────────────────────────────────────────────

const NAVY  = '#13344F';
const GREEN = '#2EAA4A';
const GOLD  = '#C9A84C';
const WHITE = '#FFFFFF';
const LIGHT_BG = '#F8FAFC';
const BORDER = '#E2E8F0';

// ── Components ────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '80px 0' }}>
      <div style={{
        width: 40, height: 40, border: `4px solid ${BORDER}`,
        borderTop: `4px solid ${NAVY}`, borderRadius: '50%',
        animation: 'spin 0.8s linear infinite',
      }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function NavBar({ isFinal, sessionName }: { isFinal: boolean; sessionName: string }) {
  return (
    <nav style={{
      background: NAVY, color: WHITE, padding: '0 20px',
      display: 'flex', alignItems: 'center', gap: 14, height: 56,
      position: 'sticky', top: 0, zIndex: 100,
    }}>
      {/* FMP brand */}
      <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 7, textDecoration: 'none', flexShrink: 0 }}>
        <div style={{ width: 26, height: 26, borderRadius: 5, background: GREEN, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13 }}>📐</div>
        <span style={{ fontSize: 13, fontWeight: 800, color: WHITE, whiteSpace: 'nowrap' }}>Financial Modeler Pro</span>
      </Link>
      <span style={{ color: '#475569', flexShrink: 0 }}>|</span>
      <Link href="/training/dashboard" style={{ color: '#94A3B8', fontSize: 13, textDecoration: 'none', flexShrink: 0 }}>
        ← Dashboard
      </Link>
      <span style={{ color: '#475569', flexShrink: 0 }}>›</span>
      <span style={{ fontSize: 13, fontWeight: 600, color: WHITE, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {isFinal ? '🏆' : '📝'} {sessionName}
      </span>
    </nav>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AssessmentPage() {
  const params  = useParams<{ tabKey: string }>();
  const router  = useRouter();
  const tabKey  = decodeURIComponent(params.tabKey ?? '');

  // Page state
  const [pageState, setPageState]   = useState<PageState>('loading');
  const [questions, setQuestions]   = useState<AssessmentQuestionsData | null>(null);
  const [status, setStatus]         = useState<AttemptStatus | null>(null);
  const [result, setResult]         = useState<SubmitAssessmentResult | null>(null);
  const [errorMsg, setErrorMsg]     = useState('');

  // Taking state
  const [answers, setAnswers]       = useState<Record<number, number>>({});
  const [currentQ, setCurrentQ]     = useState(0);
  const [timeLeft, setTimeLeft]     = useState<number | null>(null);
  const timerRef                    = useRef<ReturnType<typeof setInterval> | null>(null);

  // Update browser tab title when session name is known (FIX 1)
  useEffect(() => {
    if (questions?.sessionName) {
      document.title = `Assessment | ${questions.sessionName} — Financial Modeler Pro`;
    }
  }, [questions?.sessionName]);

  // ── Load on mount ──────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setPageState('loading');
    setErrorMsg('');

    const session = getTrainingSession();
    if (!session) {
      router.replace('/training');
      return;
    }

    const { email, registrationId: regId } = session;

    // Fetch status + questions in parallel
    const [statusRes, questionsRes] = await Promise.all([
      fetch(`/api/training/attempt-status?tabKey=${encodeURIComponent(tabKey)}&email=${encodeURIComponent(email)}&regId=${encodeURIComponent(regId)}`),
      fetch(`/api/training/questions?tabKey=${encodeURIComponent(tabKey)}&email=${encodeURIComponent(email)}&regId=${encodeURIComponent(regId)}`),
    ]);

    const statusData  = await statusRes.json()    as { success: boolean; data?: AttemptStatus; error?: string };
    const questData   = await questionsRes.json() as { success: boolean; data?: AssessmentQuestionsData; error?: string };

    // ── Check attempt status FIRST — takes priority over question-load errors ──
    if (statusData.success && statusData.data) {
      const s = statusData.data;
      setStatus(s);

      if (s.passed) {
        setPageState('blocked-passed');
        return;
      }
      if (!s.canAttempt) {
        setPageState('blocked-no-attempts');
        return;
      }
    }

    // ── Now check if questions loaded ────────────────────────────────────────
    if (!questData.success || !questData.data) {
      // Apps Script may reject getQuestions if student already passed — treat gracefully
      const errLower = (questData.error ?? '').toLowerCase();
      if (errLower.includes('passed') || errLower.includes('already')) {
        setPageState('blocked-passed');
        return;
      }
      setErrorMsg(questData.error ?? 'Could not load questions. Please try again.');
      setPageState('ready'); // show error card
      return;
    }

    const q = questData.data;
    setQuestions(q);

    // Restore saved answers
    setAnswers(loadSavedAnswers(tabKey));
    setCurrentQ(0);
    setPageState('ready');
  }, [tabKey, router]);

  useEffect(() => { load(); }, [load]);

  // ── Timer ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (pageState !== 'taking' || !questions?.timeLimit) return;

    const totalSeconds = questions.timeLimit * 60;
    setTimeLeft(totalSeconds);

    timerRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev === null || prev <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          handleSubmit();  // auto-submit on timeout
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => { if (timerRef.current) clearInterval(timerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageState]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  function startAssessment() {
    setCurrentQ(0);
    setPageState('taking');
  }

  function selectAnswer(questionIndex: number, optionIndex: number) {
    const next = { ...answers, [questionIndex]: optionIndex };
    setAnswers(next);
    saveAnswers(tabKey, next);
  }

  async function handleSubmit() {
    if (timerRef.current) clearInterval(timerRef.current);
    setPageState('submitting');

    const session = getTrainingSession();
    if (!session) { router.replace('/training'); return; }

    const { email, registrationId: regId } = session;
    const total = questions?.questions.length ?? 0;
    const answersArray: number[] = Array.from({ length: total }, (_, i) => answers[i] ?? -1);

    const res = await fetch('/api/training/submit-assessment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tabKey, email, regId, answers: answersArray }),
    });

    const data = await res.json() as { success: boolean; data?: SubmitAssessmentResult; error?: string };

    clearSavedAnswers(tabKey);

    if (data.success && data.data) {
      setResult(data.data);
      setPageState('results');
    } else {
      setErrorMsg(data.error ?? 'Submission failed. Please try again.');
      setPageState('ready');
    }
  }

  // ── Render helpers ─────────────────────────────────────────────────────────

  const isFinal      = questions?.isFinal ?? false;
  const sessionName  = (questions?.sessionName && questions.sessionName !== tabKey)
    ? questions.sessionName
    : getSessionTitleFromTabKey(tabKey);
  const accentColor  = isFinal ? GOLD : GREEN;
  const totalQ       = questions?.questions.length ?? 0;
  const answered     = Object.keys(answers).length;
  const passingScore = questions?.passingScore ?? 70;

  function formatTime(secs: number) {
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  // ── Render: loading ────────────────────────────────────────────────────────

  if (pageState === 'loading') {
    return (
      <div style={{ minHeight: '100vh', background: LIGHT_BG }}>
        <NavBar isFinal={false} sessionName="Loading…" />
        <Spinner />
      </div>
    );
  }

  // ── Render: blocked-passed ─────────────────────────────────────────────────

  if (pageState === 'blocked-passed') {
    return (
      <div style={{ minHeight: '100vh', background: LIGHT_BG }}>
        <NavBar isFinal={isFinal} sessionName={sessionName} />
        <div style={{ maxWidth: 560, margin: '80px auto', padding: '0 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 64, marginBottom: 16 }}>🎉</div>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: NAVY, marginBottom: 12 }}>
            You already passed!
          </h1>
          <p style={{ color: '#475569', marginBottom: 8 }}>
            You passed <strong>{sessionName}</strong> with a score of{' '}
            <strong style={{ color: GREEN }}>{status?.lastScore ?? '—'}%</strong>.
          </p>
          <p style={{ color: '#64748B', fontSize: 14, marginBottom: 32 }}>
            No need to retake — your progress is saved.
          </p>
          <Link href="/training/dashboard" style={{
            display: 'inline-block', background: NAVY, color: WHITE,
            padding: '12px 28px', borderRadius: 8, fontWeight: 700,
            textDecoration: 'none', fontSize: 15,
          }}>
            ← Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  // ── Render: blocked-no-attempts ────────────────────────────────────────────

  if (pageState === 'blocked-no-attempts') {
    return (
      <div style={{ minHeight: '100vh', background: LIGHT_BG }}>
        <NavBar isFinal={isFinal} sessionName={sessionName} />
        <div style={{ maxWidth: 560, margin: '80px auto', padding: '0 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 64, marginBottom: 16 }}>🚫</div>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: NAVY, marginBottom: 12 }}>
            No attempts remaining
          </h1>
          <p style={{ color: '#475569', marginBottom: 8 }}>
            You have used all {status?.maxAttempts ?? 'your'} attempts for <strong>{sessionName}</strong>.
          </p>
          {status?.lastScore !== undefined && (
            <p style={{ color: '#64748B', fontSize: 14, marginBottom: 8 }}>
              Your last score was <strong>{status.lastScore}%</strong> (passing: {passingScore}%).
            </p>
          )}
          <p style={{ color: '#64748B', fontSize: 14, marginBottom: 32 }}>
            Please contact your instructor if you need additional attempts.
          </p>
          <Link href="/training/dashboard" style={{
            display: 'inline-block', background: NAVY, color: WHITE,
            padding: '12px 28px', borderRadius: 8, fontWeight: 700,
            textDecoration: 'none', fontSize: 15,
          }}>
            ← Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  // ── Render: ready ──────────────────────────────────────────────────────────

  if (pageState === 'ready') {
    // ── Questions failed to load: show clear error screen, never a blank/broken page ──
    if (errorMsg && !questions) {
      return (
        <div style={{ minHeight: '100vh', background: LIGHT_BG }}>
          <NavBar isFinal={false} sessionName={sessionName} />
          <div style={{ maxWidth: 520, margin: '80px auto', padding: '0 24px', textAlign: 'center' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
            <h2 style={{ fontSize: 20, fontWeight: 800, color: NAVY, marginBottom: 12 }}>
              Could not load questions
            </h2>
            <div style={{
              background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 8,
              padding: '14px 18px', marginBottom: 24, color: '#991B1B', fontSize: 14, textAlign: 'left',
            }}>
              {errorMsg}
            </div>
            <button onClick={load} style={{
              display: 'inline-block', background: NAVY, color: WHITE,
              padding: '12px 28px', borderRadius: 8, fontWeight: 700,
              fontSize: 15, border: 'none', cursor: 'pointer', marginBottom: 12,
            }}>
              Try Again
            </button>
            <br />
            <Link href="/training/dashboard" style={{
              fontSize: 14, color: '#64748B', textDecoration: 'underline',
            }}>
              ← Back to Dashboard
            </Link>
          </div>
        </div>
      );
    }

    const attemptNumber  = status ? status.attempts + 1 : 1;
    const maxAttempts    = status?.maxAttempts ?? (isFinal ? 1 : 3);
    const isOnlyAttempt  = maxAttempts === 1;
    return (
      <div style={{ minHeight: '100vh', background: LIGHT_BG }}>
        <NavBar isFinal={isFinal} sessionName={sessionName} />
        <div style={{ maxWidth: 640, margin: '60px auto', padding: '0 24px' }}>

          {/* Error banner (non-fatal — questions loaded but submission failed) */}
          {errorMsg && (
            <div style={{
              background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 8,
              padding: '14px 18px', marginBottom: 24, color: '#991B1B', fontSize: 14,
            }}>
              {errorMsg}
            </div>
          )}

          {/* Info card */}
          <div style={{
            background: WHITE, borderRadius: 12, border: `1px solid ${BORDER}`,
            boxShadow: '0 2px 8px rgba(0,0,0,0.06)', overflow: 'hidden',
          }}>
            {/* Header */}
            <div style={{ background: NAVY, padding: '28px 32px' }}>
              <div style={{ fontSize: 13, color: '#94A3B8', marginBottom: 4 }}>
                {questions?.course} — Assessment
              </div>
              <h1 style={{ fontSize: 24, fontWeight: 800, color: WHITE, margin: 0 }}>
                {isFinal ? '🏆' : '📝'} {sessionName}
              </h1>
            </div>

            {/* Body */}
            <div style={{ padding: '28px 32px' }}>
              {/* Stats row */}
              <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginBottom: 28 }}>
                {[
                  { label: 'Questions', value: totalQ },
                  { label: 'Passing Score', value: `${passingScore}%` },
                  { label: 'Attempt', value: `${attemptNumber} of ${maxAttempts}` },
                  ...(questions?.timeLimit ? [{ label: 'Time Limit', value: `${questions.timeLimit} min` }] : []),
                ].map(({ label, value }) => (
                  <div key={label} style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 24, fontWeight: 800, color: NAVY }}>{value}</div>
                    <div style={{ fontSize: 12, color: '#64748B' }}>{label}</div>
                  </div>
                ))}
              </div>

              {/* Final / only-attempt warning */}
              {isOnlyAttempt && (
                <div style={{ background: '#FFF8E1', border: '1px solid #FDE68A', borderRadius: 8, padding: '12px 16px', marginBottom: 24, fontSize: 13, color: '#92400E', fontWeight: 600 }}>
                  ⚠️ {isFinal ? 'This is the Final Exam — ' : ''}You have only 1 attempt. There is no retry once submitted.
                </div>
              )}

              {/* Previous attempt */}
              {status && status.attempts > 0 && (
                <div style={{
                  background: '#F1F5F9', borderRadius: 8, padding: '12px 16px',
                  marginBottom: 24, fontSize: 13, color: '#475569',
                }}>
                  Previous attempt: <strong>{status.lastScore ?? '—'}%</strong>
                  {status.lastCompletedAt && ` on ${new Date(status.lastCompletedAt).toLocaleDateString()}`}
                </div>
              )}

              {/* Instructions */}
              <ul style={{ color: '#475569', fontSize: 14, lineHeight: 1.7, paddingLeft: 20, marginBottom: 32 }}>
                <li>Select one answer per question.</li>
                <li>You can navigate between questions before submitting.</li>
                {questions?.timeLimit ? <li>Timer starts when you begin. The assessment will auto-submit when time runs out.</li> : null}
                <li>Your answers are saved as you go — refreshing is safe.</li>
              </ul>

              <button
                onClick={startAssessment}
                style={{
                  background: accentColor, color: WHITE, border: 'none',
                  padding: '14px 32px', borderRadius: 8, fontSize: 16, fontWeight: 700,
                  cursor: 'pointer', width: '100%',
                }}
              >
                {isOnlyAttempt ? (isFinal ? 'Start Final Exam →' : 'Start Assessment (1 attempt only) →') : 'Start Assessment →'}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Render: taking ─────────────────────────────────────────────────────────

  if (pageState === 'taking' && questions) {
    const q: AssessmentQuestion = questions.questions[currentQ];
    const progressPct = ((answered) / totalQ) * 100;
    const allAnswered = answered === totalQ;

    return (
      <div style={{ minHeight: '100vh', background: LIGHT_BG }}>
        <NavBar isFinal={isFinal} sessionName={sessionName} />

        {/* Progress + timer bar */}
        <div style={{
          background: WHITE, borderBottom: `1px solid ${BORDER}`,
          padding: '12px 24px', display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', gap: 16, flexWrap: 'wrap',
        }}>
          <div style={{ flex: 1, minWidth: 180 }}>
            <div style={{ fontSize: 12, color: '#64748B', marginBottom: 4 }}>
              {answered}/{totalQ} answered
            </div>
            <div style={{ height: 6, background: BORDER, borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${progressPct}%`, background: accentColor, transition: 'width 0.3s' }} />
            </div>
          </div>
          {timeLeft !== null && (
            <div style={{
              fontSize: 20, fontWeight: 800, color: timeLeft < 120 ? '#DC2626' : NAVY,
              fontVariantNumeric: 'tabular-nums',
            }}>
              ⏱ {formatTime(timeLeft)}
            </div>
          )}
        </div>

        <div style={{ maxWidth: 700, margin: '40px auto', padding: '0 24px' }}>
          {/* Question navigator */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 28 }}>
            {questions.questions.map((_, i) => (
              <button key={i} onClick={() => setCurrentQ(i)} style={{
                width: 36, height: 36, borderRadius: 6, border: 'none',
                background: i === currentQ
                  ? accentColor
                  : answers[i] !== undefined ? '#DBEAFE' : BORDER,
                color: i === currentQ ? WHITE : answers[i] !== undefined ? NAVY : '#64748B',
                fontWeight: i === currentQ ? 700 : 500,
                cursor: 'pointer', fontSize: 13,
              }}>
                {i + 1}
              </button>
            ))}
          </div>

          {/* Question card */}
          <div style={{
            background: WHITE, borderRadius: 12, border: `1px solid ${BORDER}`,
            boxShadow: '0 2px 8px rgba(0,0,0,0.06)', padding: 32, marginBottom: 24,
          }}>
            <div style={{ fontSize: 12, color: '#94A3B8', marginBottom: 12 }}>
              Question {currentQ + 1} of {totalQ}
              {q.points ? ` · ${q.points} pt${q.points > 1 ? 's' : ''}` : ''}
            </div>
            <p style={{ fontSize: 17, fontWeight: 600, color: NAVY, lineHeight: 1.6, marginBottom: 28 }}>
              {q.q}
            </p>

            {/* Options */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {q.options.map((opt, oi) => {
                const selected = answers[currentQ] === oi;
                return (
                  <button key={oi} onClick={() => selectAnswer(currentQ, oi)} style={{
                    textAlign: 'left', padding: '14px 18px', borderRadius: 8,
                    border: `2px solid ${selected ? accentColor : BORDER}`,
                    background: selected ? (isFinal ? '#FFF8E7' : '#F0FDF4') : WHITE,
                    color: NAVY, fontSize: 15, cursor: 'pointer',
                    transition: 'border-color 0.15s, background 0.15s',
                    fontWeight: selected ? 600 : 400,
                  }}>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      width: 26, height: 26, borderRadius: '50%', marginRight: 12, fontSize: 13,
                      background: selected ? accentColor : BORDER, color: selected ? WHITE : '#64748B',
                      flexShrink: 0,
                    }}>
                      {String.fromCharCode(65 + oi)}
                    </span>
                    {opt}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Navigation */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <button
              onClick={() => setCurrentQ(q => Math.max(0, q - 1))}
              disabled={currentQ === 0}
              style={{
                padding: '10px 20px', borderRadius: 8, border: `1px solid ${BORDER}`,
                background: WHITE, color: NAVY, fontWeight: 600, cursor: currentQ === 0 ? 'not-allowed' : 'pointer',
                opacity: currentQ === 0 ? 0.4 : 1,
              }}
            >
              ← Previous
            </button>

            {currentQ < totalQ - 1 ? (
              <button
                onClick={() => setCurrentQ(q => q + 1)}
                style={{
                  padding: '10px 20px', borderRadius: 8, border: 'none',
                  background: NAVY, color: WHITE, fontWeight: 600, cursor: 'pointer',
                }}
              >
                Next →
              </button>
            ) : (
              <button
                onClick={handleSubmit}
                disabled={!allAnswered}
                style={{
                  padding: '12px 28px', borderRadius: 8, border: 'none',
                  background: allAnswered ? accentColor : BORDER,
                  color: allAnswered ? WHITE : '#94A3B8',
                  fontWeight: 700, cursor: allAnswered ? 'pointer' : 'not-allowed', fontSize: 15,
                }}
              >
                {allAnswered ? 'Submit Assessment ✓' : `Answer all questions (${totalQ - answered} left)`}
              </button>
            )}
          </div>

          {/* Submit from anywhere if all answered */}
          {allAnswered && currentQ < totalQ - 1 && (
            <div style={{ textAlign: 'center', marginTop: 20 }}>
              <button onClick={handleSubmit} style={{
                background: accentColor, color: WHITE, border: 'none',
                padding: '12px 28px', borderRadius: 8, fontWeight: 700,
                cursor: 'pointer', fontSize: 15,
              }}>
                Submit Assessment ✓
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Render: submitting ─────────────────────────────────────────────────────

  if (pageState === 'submitting') {
    return (
      <div style={{ minHeight: '100vh', background: LIGHT_BG }}>
        <NavBar isFinal={isFinal} sessionName={sessionName} />
        <div style={{ textAlign: 'center', paddingTop: 120 }}>
          <Spinner />
          <p style={{ color: '#64748B', marginTop: 16, fontSize: 15 }}>Submitting your answers…</p>
        </div>
      </div>
    );
  }

  // ── Render: results ────────────────────────────────────────────────────────

  if (pageState === 'results' && result) {
    const passed     = result.passed;
    const scoreColor = passed ? GREEN : '#DC2626';

    return (
      <div style={{ minHeight: '100vh', background: LIGHT_BG }}>
        <NavBar isFinal={isFinal} sessionName={sessionName} />

        <div style={{ maxWidth: 600, margin: '60px auto', padding: '0 24px', textAlign: 'center' }}>
          {/* Emoji */}
          <div style={{ fontSize: 72, marginBottom: 16 }}>
            {passed ? (isFinal ? '🏆' : '🎉') : '📚'}
          </div>

          {/* Result card */}
          <div style={{
            background: WHITE, borderRadius: 16, border: `2px solid ${passed ? GREEN : '#FECACA'}`,
            boxShadow: '0 4px 16px rgba(0,0,0,0.08)', padding: 40, marginBottom: 24,
          }}>
            <h1 style={{ fontSize: 28, fontWeight: 800, color: NAVY, marginBottom: 8 }}>
              {passed ? 'Congratulations!' : 'Keep Practicing!'}
            </h1>
            <p style={{ fontSize: 16, color: '#475569', marginBottom: passed ? 28 : 8 }}>
              {passed
                ? `You passed ${sessionName}!`
                : `You didn't pass ${sessionName} this time.`}
            </p>
            {!passed && (
              <p style={{ fontSize: 14, color: '#64748B', marginBottom: 28 }}>
                You scored <strong style={{ color: '#DC2626' }}>{result.score}%</strong> — passing score is {passingScore}%.
              </p>
            )}

            {/* Score circle */}
            <div style={{
              width: 120, height: 120, borderRadius: '50%',
              border: `8px solid ${scoreColor}`, margin: '0 auto 28px',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            }}>
              <span style={{ fontSize: 32, fontWeight: 900, color: scoreColor }}>{result.score}%</span>
              <span style={{ fontSize: 11, color: '#94A3B8' }}>score</span>
            </div>

            {/* Stats */}
            <div style={{ display: 'flex', justifyContent: 'center', gap: 32, marginBottom: 20, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 20, fontWeight: 800, color: NAVY }}>{result.correctCount}/{result.totalQuestions}</div>
                <div style={{ fontSize: 12, color: '#64748B' }}>Correct</div>
              </div>
              <div>
                <div style={{ fontSize: 20, fontWeight: 800, color: NAVY }}>{passingScore}%</div>
                <div style={{ fontSize: 12, color: '#64748B' }}>Pass Mark</div>
              </div>
              <div>
                <div style={{ fontSize: 20, fontWeight: 800, color: NAVY }}>{result.attempts} of {result.maxAttempts}</div>
                <div style={{ fontSize: 12, color: '#64748B' }}>Attempt</div>
              </div>
            </div>

            {/* Attempt result message */}
            <div style={{ marginBottom: 24, fontSize: 13, borderRadius: 8, padding: '10px 16px',
              background: passed ? '#F0FDF4' : (result.maxAttempts - result.attempts) > 0 ? '#FFF8E1' : '#FEF2F2',
              color: passed ? '#15803D' : (result.maxAttempts - result.attempts) > 0 ? '#92400E' : '#991B1B',
              border: `1px solid ${passed ? '#BBF7D0' : (result.maxAttempts - result.attempts) > 0 ? '#FDE68A' : '#FECACA'}`,
              fontWeight: 600,
            }}>
              {passed
                ? `✓ Passed on attempt ${result.attempts} of ${result.maxAttempts}`
                : (result.maxAttempts - result.attempts) > 0
                  ? `${result.maxAttempts - result.attempts} attempt${result.maxAttempts - result.attempts === 1 ? '' : 's'} remaining`
                  : 'No attempts remaining — please contact your instructor.'}
            </div>

            {/* Feedback */}
            {result.feedback && (
              <div style={{
                background: '#F8FAFC', borderRadius: 8, padding: '14px 18px',
                marginBottom: 28, fontSize: 14, color: '#475569', textAlign: 'left',
              }}>
                {result.feedback}
              </div>
            )}

            {/* Actions */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {result.canRetry && !passed && (
                <button onClick={load} style={{
                  background: accentColor, color: WHITE, border: 'none',
                  padding: '14px', borderRadius: 8, fontWeight: 700, cursor: 'pointer', fontSize: 15,
                }}>
                  Try Again →
                </button>
              )}
              <Link href="/training/dashboard" style={{
                display: 'block', background: NAVY, color: WHITE,
                padding: '14px', borderRadius: 8, fontWeight: 700,
                textDecoration: 'none', fontSize: 15,
              }}>
                ← Back to Dashboard
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
