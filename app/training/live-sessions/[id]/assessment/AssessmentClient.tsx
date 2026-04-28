'use client';

import { useEffect, useMemo, useState, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { TrainingShell } from '@/src/hubs/training/components/TrainingShell';
import { ArrowLeft, Clock, CheckCircle2, XCircle, Award, Lock, Pause } from 'lucide-react';
import type { StudentAssessmentView } from '@/src/hubs/training/lib/assessment/liveSessionAssessments';
import {
  type ServerAttemptState,
  startAttemptApi,
  pauseAttemptApi,
  resumeAttemptApi,
  getAttemptStateApi,
  firePauseOnUnload,
} from '@/src/hubs/training/lib/assessment/attemptInProgressClient';

const NAVY = '#0D2E5A';
const GREEN = '#2EAA4A';
const RED = '#DC2626';
const BLUE = '#1B4F8A';
const GOLD = '#F5B942';

interface SessionInfo {
  id: string;
  title: string;
  instructor_name?: string | null;
  duration_minutes?: number | null;
  banner_url?: string | null;
}

interface PrevAttempt {
  attempt_number: number;
  score: number;
  passed: boolean;
  submitted_at: string;
}

interface SubmitResponse {
  score: number;
  passed: boolean;
  attempt_number: number;
  can_retry: boolean;
  max_attempts: number;
  question_results: Record<string, boolean>;
  correct_answers: Record<string, number>;
  correct_answer_texts?: Record<string, string>;
  explanations: Array<{ id: string; explanation: string }>;
}

interface Props {
  session: SessionInfo;
  assessment: StudentAssessmentView;
  previousAttempts: PrevAttempt[];
  watchPercentage: number;
  studentEmail: string;
}

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 11, fontWeight: 700, color: '#6B7280',
  letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 4,
};

function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

export function AssessmentClient({
  session,
  assessment,
  previousAttempts,
  watchPercentage,
}: Props) {
  const router = useRouter();

  const watchGate = assessment.require_watch_before_assessment;
  const watchOk = watchPercentage >= assessment.watch_threshold;
  const attemptsUsed = previousAttempts.length;
  const hasPassed = previousAttempts.some(a => a.passed);
  const attemptsLeft = assessment.max_attempts - attemptsUsed;
  const canStart = !hasPassed && attemptsLeft > 0 && (!watchGate || watchOk);

  const [phase, setPhase] = useState<'intro' | 'quiz' | 'result'>('intro');
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<SubmitResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Server-anchored attempt state (migration 126). Drives the countdown,
  // the pause overlay, and the visibility-change pause/resume flow. Server
  // is the deadline source of truth.
  const [attemptState, setAttemptState] = useState<ServerAttemptState | null>(null);
  const attemptStateRef = useRef<ServerAttemptState | null>(null);
  attemptStateRef.current = attemptState;

  // Next attempt number is the count of finished attempts + 1. Live sessions
  // never key on `is_final`, so the pause endpoints always allow up to the
  // global cap (1 pause / 120s grace).
  const nextAttemptNumber = previousAttempts.length + 1;
  const answersKey = `live_assessment_answers_${session.id}_${nextAttemptNumber}`;

  // Global shuffle settings (shared with 3SFM/BVM via migration 108)
  const [shuffleSettings, setShuffleSettings] = useState<{ shuffleQuestions: boolean; shuffleOptions: boolean } | null>(null);
  useEffect(() => {
    fetch('/api/training/assessment-settings')
      .then(r => r.json())
      .then((d: { shuffleQuestions?: boolean; shuffleOptions?: boolean }) => {
        setShuffleSettings({
          shuffleQuestions: d.shuffleQuestions !== false,
          shuffleOptions:   d.shuffleOptions   === true,
        });
      })
      .catch(() => setShuffleSettings({ shuffleQuestions: true, shuffleOptions: false }));
  }, []);

  /**
   * Build the shuffled question view + per-question option index maps once the
   * settings arrive. `optionMaps[qid][shuffledIdx] = originalDbIdx` — used at
   * submit time to translate the student's choice back to the index the server
   * stored as `correct_index`, since scoring runs against DB-ordered options.
   * Shuffle is deterministic per mount (runs once after settings load) so a
   * student who switches tab doesn't see the questions reshuffle mid-quiz.
   */
  const { questions, optionMaps } = useMemo(() => {
    const baseOrdered = assessment.questions.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    if (!shuffleSettings) return { questions: baseOrdered, optionMaps: {} as Record<string, number[]> };

    let qs = baseOrdered;
    if (shuffleSettings.shuffleQuestions && qs.length > 1) {
      qs = qs.slice();
      for (let i = qs.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [qs[i], qs[j]] = [qs[j], qs[i]];
      }
    }

    const maps: Record<string, number[]> = {};
    if (shuffleSettings.shuffleOptions) {
      qs = qs.map(q => {
        if (!Array.isArray(q.options) || q.options.length < 2) { maps[q.id] = []; return q; }
        const order = q.options.map((_, i) => i);
        for (let i = order.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [order[i], order[j]] = [order[j], order[i]];
        }
        maps[q.id] = order;
        return { ...q, options: order.map(i => q.options[i]) };
      });
    }

    return { questions: qs, optionMaps: maps };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assessment.questions, shuffleSettings]);

  // Restore in-progress attempt on mount: if the server still has a row for
  // (email, sessionId, nextAttemptNumber), jump straight to the quiz phase
  // and replay the answers persisted to localStorage so reload preserves
  // progress.
  useEffect(() => {
    if (!canStart) return;
    let cancelled = false;
    (async () => {
      const existing = await getAttemptStateApi({ sessionId: session.id, attemptNumber: nextAttemptNumber });
      if (cancelled || !existing) return;
      setAttemptState(existing);
      try {
        const raw = localStorage.getItem(answersKey);
        if (raw) setAnswers(JSON.parse(raw) as Record<string, number>);
      } catch { /* ignore */ }
      setTimeLeft(existing.secondsRemaining);
      setPhase('quiz');
      if (existing.secondsRemaining <= 0 && !existing.paused) {
        setTimeout(() => void handleSubmit(), 50);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id, nextAttemptNumber, canStart]);

  // Display tick. Re-derives every second from attemptState.expiresAt while
  // not paused; freezes at the paused-time value when paused.
  useEffect(() => {
    if (phase !== 'quiz' || !attemptState) return;
    if (attemptState.paused) {
      setTimeLeft(attemptState.secondsRemaining);
      return;
    }
    if (!assessment.timer_minutes) return;
    const expiresMs = new Date(attemptState.expiresAt).getTime();
    const tick = () => {
      const left = Math.max(0, Math.floor((expiresMs - Date.now()) / 1000));
      setTimeLeft(left);
      if (left <= 0) void handleSubmit();
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, attemptState, assessment.timer_minutes]);

  // Visibility change pause/resume + beforeunload pause on intentional close.
  // Live-session quizzes are never marked is_final, so pauseAllowed gates
  // the call (1 pause / 120s grace per attempt).
  useEffect(() => {
    if (phase !== 'quiz') return;
    const idn = { sessionId: session.id, attemptNumber: nextAttemptNumber };

    const onVis = async () => {
      const cur = attemptStateRef.current;
      if (document.visibilityState === 'hidden') {
        if (!cur || cur.isFinal || !cur.pauseAllowed || cur.paused) return;
        const res = await pauseAttemptApi(idn);
        if (res.ok && res.state) setAttemptState(res.state);
      } else {
        const resumed = await resumeAttemptApi(idn);
        if (resumed) {
          setAttemptState(resumed);
        } else {
          const fresh = await getAttemptStateApi(idn);
          if (fresh) setAttemptState(fresh);
        }
      }
    };
    const onUnload = () => {
      const cur = attemptStateRef.current;
      if (cur && !cur.isFinal && cur.pauseAllowed && !cur.paused) {
        firePauseOnUnload(idn);
      }
    };

    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('beforeunload', onUnload);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('beforeunload', onUnload);
    };
  }, [phase, session.id, nextAttemptNumber]);

  // Persist answers on every change so a reload mid-quiz never loses progress.
  useEffect(() => {
    if (phase !== 'quiz') return;
    try { localStorage.setItem(answersKey, JSON.stringify(answers)); } catch { /* ignore */ }
  }, [answers, phase, answersKey]);

  async function startQuiz() {
    setError(null);
    setAnswers({});
    try { localStorage.removeItem(answersKey); } catch { /* ignore */ }
    const state = await startAttemptApi(
      { sessionId: session.id, attemptNumber: nextAttemptNumber },
      assessment.timer_minutes ?? null,
      false, // live sessions never carry a final-exam flag
    );
    if (state) {
      setAttemptState(state);
      setTimeLeft(state.secondsRemaining);
    } else if (assessment.timer_minutes) {
      // Fallback: the server side errored. Continue with a client-only clock
      // so the quiz still functions; pause/resume just won't work this run.
      setTimeLeft(assessment.timer_minutes * 60);
    }
    setPhase('quiz');
  }

  async function handleSubmit() {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const startedAtMs = attemptState ? new Date(attemptState.startedAt).getTime() : null;
      const timeTakenSeconds = startedAtMs ? Math.floor((Date.now() - startedAtMs) / 1000) : null;

      // Translate shuffled-option answers back to DB-ordered indices before
      // POSTing. Server scores against the stored `correct_index` which is
      // always expressed in original (non-shuffled) order.
      const submitAnswers: Record<string, number> = {};
      for (const [qid, pickedShuffled] of Object.entries(answers)) {
        const map = optionMaps[qid];
        submitAnswers[qid] = (Array.isArray(map) && map.length > 0 && typeof map[pickedShuffled] === 'number')
          ? map[pickedShuffled]
          : pickedShuffled;
      }

      const res = await fetch(`/api/training/live-sessions/${session.id}/assessment/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers: submitAnswers, timeTakenSeconds }),
      });
      const json = await res.json() as Partial<SubmitResponse> & { error?: string };
      if (!res.ok || json.error) {
        throw new Error(json.error ?? 'Submission failed');
      }
      setResult(json as SubmitResponse);
      setPhase('result');
      try { localStorage.removeItem(answersKey); } catch { /* ignore */ }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  const allAnswered = questions.every(q => typeof answers[q.id] === 'number');

  return (
    <TrainingShell activeNav="live-sessions">
      <div style={{ maxWidth: 820, margin: '0 auto', padding: '24px 20px 56px', fontFamily: "'Inter', sans-serif" }}>
        {/* Header */}
        <div style={{ marginBottom: 20 }}>
          <Link href={`/training/live-sessions/${session.id}`}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: '#6B7280', textDecoration: 'none', marginBottom: 14 }}>
            <ArrowLeft size={14} /> Back to session
          </Link>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#14B8A6', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 4 }}>
            Assessment
          </div>
          <h1 style={{ fontSize: 'clamp(20px, 3.5vw, 28px)', fontWeight: 800, color: NAVY, margin: 0, lineHeight: 1.2 }}>
            {session.title}
          </h1>
          <div style={{ fontSize: 13, color: '#6B7280', marginTop: 6 }}>
            Part of FMP Real-World Financial Modeling
          </div>
        </div>

        {error && (
          <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', color: '#991B1B', padding: '12px 16px', borderRadius: 8, marginBottom: 16, fontSize: 13 }}>
            {error}
          </div>
        )}

        {phase === 'intro' && (
          <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, padding: 24, boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 20 }}>
              <div><div style={labelStyle}>Questions</div><div style={{ fontSize: 18, fontWeight: 800, color: NAVY }}>{questions.length}</div></div>
              <div><div style={labelStyle}>Pass Threshold</div><div style={{ fontSize: 18, fontWeight: 800, color: NAVY }}>{assessment.pass_threshold}%</div></div>
              <div><div style={labelStyle}>Attempts</div><div style={{ fontSize: 18, fontWeight: 800, color: NAVY }}>{attemptsUsed} / {assessment.max_attempts}</div></div>
              {assessment.timer_minutes && (
                <div><div style={labelStyle}>Timer</div><div style={{ fontSize: 18, fontWeight: 800, color: NAVY }}>{assessment.timer_minutes} min</div></div>
              )}
            </div>

            {previousAttempts.length > 0 && (
              <div style={{ marginBottom: 20 }}>
                <div style={labelStyle}>Previous Attempts</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {previousAttempts.map(a => (
                    <div key={a.attempt_number} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: '#374151' }}>
                      <span style={{ fontWeight: 700, color: a.passed ? GREEN : RED }}>
                        {a.passed ? <CheckCircle2 size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} /> : <XCircle size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />}
                        Attempt {a.attempt_number}: {a.score}%
                      </span>
                      <span style={{ color: '#9CA3AF' }}>{new Date(a.submitted_at).toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {hasPassed ? (
              <div style={{ background: '#F0FFF4', border: '1px solid #BBF7D0', color: '#166534', padding: '14px 16px', borderRadius: 10, marginBottom: 16 }}>
                <Award size={16} style={{ verticalAlign: 'middle', marginRight: 6 }} />
                You&apos;ve already passed this assessment. 🎉
              </div>
            ) : watchGate && !watchOk ? (
              <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', color: '#92400E', padding: '14px 16px', borderRadius: 10, marginBottom: 16, fontSize: 13 }}>
                <Lock size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />
                Watch at least <strong>{assessment.watch_threshold}%</strong> of the session to unlock the assessment. You&apos;ve watched {watchPercentage}%.
              </div>
            ) : attemptsLeft <= 0 ? (
              <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', color: '#991B1B', padding: '14px 16px', borderRadius: 10, marginBottom: 16 }}>
                <Lock size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />
                You&apos;ve used all {assessment.max_attempts} attempts.
              </div>
            ) : null}

            <div style={{ display: 'flex', gap: 10 }}>
              {canStart ? (
                <button onClick={startQuiz}
                        style={{ padding: '12px 28px', borderRadius: 10, background: GREEN, color: '#fff', fontWeight: 800, fontSize: 14, border: 'none', cursor: 'pointer' }}>
                  Start Assessment →
                </button>
              ) : (
                <Link href={`/training/live-sessions/${session.id}`}
                      style={{ padding: '12px 28px', borderRadius: 10, background: NAVY, color: '#fff', fontWeight: 700, fontSize: 14, textDecoration: 'none' }}>
                  Back to session
                </Link>
              )}
            </div>
          </div>
        )}

        {phase === 'quiz' && (
          <div style={{ position: 'relative' }}>
            {/* Paused overlay blocks interaction while server-side pause is active. */}
            {attemptState?.paused && (
              <div style={{
                position: 'fixed', inset: 0, zIndex: 50,
                background: 'rgba(15, 23, 42, 0.55)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                backdropFilter: 'blur(2px)',
              }}>
                <div style={{
                  background: '#fff', borderRadius: 14, padding: '28px 36px', maxWidth: 420,
                  textAlign: 'center', boxShadow: '0 12px 40px rgba(0,0,0,0.25)',
                  border: '2px solid #FDE68A',
                }}>
                  <Pause size={36} style={{ color: '#92400E', marginBottom: 8 }} />
                  <h3 style={{ fontSize: 18, fontWeight: 800, color: NAVY, margin: '0 0 8px' }}>Assessment Paused</h3>
                  <p style={{ fontSize: 14, color: '#475569', margin: '0 0 14px', lineHeight: 1.5 }}>
                    Your timer is paused while this tab is in the background.
                    It will resume automatically when you return.
                  </p>
                  <div style={{
                    display: 'inline-block', fontSize: 14, fontWeight: 700, color: '#92400E',
                    background: '#FEF3C7', padding: '8px 14px', borderRadius: 6,
                    fontVariantNumeric: 'tabular-nums',
                  }}>
                    Grace remaining: {fmtTime(attemptState.graceSecondsRemaining)}
                  </div>
                </div>
              </div>
            )}

            {timeLeft != null && (
              <div style={{
                position: 'sticky', top: 0, zIndex: 10,
                background: attemptState?.paused ? '#92400E' : (timeLeft < 60 ? RED : BLUE),
                color: '#fff', padding: '10px 16px', borderRadius: 8,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                marginBottom: 16, fontSize: 13, fontWeight: 700, gap: 12, flexWrap: 'wrap',
              }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  {attemptState?.paused ? <Pause size={14} /> : <Clock size={14} />}
                  {attemptState?.paused ? `PAUSED - Grace remaining` : 'Time remaining'}
                </span>
                <span style={{ fontSize: 18, fontVariantNumeric: 'tabular-nums' }}>
                  {attemptState?.paused ? fmtTime(attemptState.graceSecondsRemaining) : fmtTime(timeLeft)}
                </span>
              </div>
            )}

            {attemptState && !attemptState.paused && attemptState.pauseCount > 0 && (
              <div style={{
                fontSize: 11, color: '#64748B', textAlign: 'right',
                marginTop: -8, marginBottom: 12,
              }}>
                {attemptState.graceSecondsRemaining > 0
                  ? `${attemptState.pauseCount} pause used (${fmtTime(attemptState.graceSecondsRemaining)} grace remaining)`
                  : 'Grace exhausted'}
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {questions.map((q, idx) => (
                <div key={q.id} style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, padding: '18px 20px' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#6B7280', letterSpacing: '0.06em', marginBottom: 6 }}>
                    QUESTION {idx + 1} OF {questions.length}
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: NAVY, marginBottom: 14, lineHeight: 1.45 }}
                       className="fmp-rich-text"
                       dangerouslySetInnerHTML={{ __html: q.question }} />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {q.options.map((opt, oi) => {
                      const active = answers[q.id] === oi;
                      return (
                        <label key={oi}
                               style={{
                                 display: 'flex', alignItems: 'center', gap: 10,
                                 padding: '10px 14px', borderRadius: 8,
                                 border: `1.5px solid ${active ? BLUE : '#E5E7EB'}`,
                                 background: active ? '#EFF6FF' : '#fff',
                                 cursor: 'pointer', fontSize: 13.5, color: NAVY,
                               }}>
                          <input
                            type="radio"
                            name={`q_${q.id}`}
                            checked={active}
                            onChange={() => setAnswers(a => ({ ...a, [q.id]: oi }))}
                            style={{ margin: 0 }}
                          />
                          <span style={{ fontWeight: 700, color: active ? BLUE : '#9CA3AF', width: 18 }}>{String.fromCharCode(65 + oi)}</span>
                          <span>{opt}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 18, alignItems: 'center' }}>
              <button
                onClick={handleSubmit}
                disabled={!allAnswered || submitting}
                style={{
                  padding: '12px 28px', borderRadius: 10,
                  background: !allAnswered || submitting ? '#9CA3AF' : GREEN,
                  color: '#fff', fontWeight: 800, fontSize: 14,
                  border: 'none', cursor: !allAnswered || submitting ? 'not-allowed' : 'pointer',
                }}>
                {submitting ? 'Submitting…' : 'Submit Assessment'}
              </button>
              <div style={{ fontSize: 12, color: '#6B7280' }}>
                {Object.keys(answers).length} / {questions.length} answered
              </div>
            </div>
          </div>
        )}

        {phase === 'result' && result && (
          <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, padding: 28, textAlign: 'center', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
            <div style={{
              width: 72, height: 72, borderRadius: '50%',
              background: result.passed ? '#F0FFF4' : '#FEF2F2',
              color: result.passed ? GREEN : RED,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 14px',
            }}>
              {result.passed ? <CheckCircle2 size={40} /> : <XCircle size={40} />}
            </div>
            <h2 style={{ fontSize: 22, fontWeight: 800, color: NAVY, margin: '0 0 6px' }}>
              {result.passed ? 'You passed! 🎉' : 'Not this time'}
            </h2>
            <div style={{ fontSize: 48, fontWeight: 800, color: result.passed ? GREEN : RED, margin: '12px 0', letterSpacing: '-0.02em' }}>
              {result.score}%
            </div>
            <div style={{ fontSize: 13, color: '#6B7280', marginBottom: 18 }}>
              Attempt {result.attempt_number} of {result.max_attempts} · Pass threshold {assessment.pass_threshold}%
            </div>

            {/* Per-question summary */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, textAlign: 'left', marginBottom: 20 }}>
              {questions.map((q, idx) => {
                const correct = result.question_results[q.id];
                const studentAns = answers[q.id];
                const correctAnsText = result.correct_answer_texts?.[q.id];
                const explanation = result.explanations.find(e => e.id === q.id)?.explanation;
                return (
                  <div key={q.id}
                       style={{ padding: '10px 14px', borderRadius: 8, background: correct ? '#F0FFF4' : '#FEF2F2', border: `1px solid ${correct ? '#BBF7D0' : '#FECACA'}` }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      {correct ? <CheckCircle2 size={14} color={GREEN} /> : <XCircle size={14} color={RED} />}
                      <span style={{ fontSize: 11, fontWeight: 700, color: '#6B7280' }}>Q{idx + 1}</span>
                      <span style={{ fontSize: 12, color: NAVY, fontWeight: 600, flex: 1 }} dangerouslySetInnerHTML={{ __html: q.question }} />
                    </div>
                    <div style={{ fontSize: 12, color: '#6B7280', paddingLeft: 22 }}>
                      Your answer: <strong>{q.options[studentAns] ?? '—'}</strong>
                      {!correct && correctAnsText && (
                        <> · Correct: <strong style={{ color: GREEN }}>{correctAnsText}</strong></>
                      )}
                    </div>
                    {explanation && (
                      <div className="fmp-rich-text" style={{ marginTop: 6, paddingLeft: 22, fontSize: 12, color: '#374151' }}
                           dangerouslySetInnerHTML={{ __html: explanation }} />
                    )}
                  </div>
                );
              })}
            </div>

            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
              {result.passed && (
                <Link href={`/training/live-sessions/${session.id}`}
                      style={{ padding: '12px 22px', borderRadius: 10, background: GOLD, color: NAVY, fontWeight: 800, fontSize: 14, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <Award size={16} /> View Achievement Card
                </Link>
              )}
              {!result.passed && result.can_retry && (
                <button onClick={() => { setResult(null); setAnswers({}); setPhase('intro'); router.refresh(); }}
                        style={{ padding: '12px 22px', borderRadius: 10, background: BLUE, color: '#fff', fontWeight: 700, fontSize: 14, border: 'none', cursor: 'pointer' }}>
                  Retake ({result.max_attempts - result.attempt_number} left)
                </button>
              )}
              <Link href={`/training/live-sessions/${session.id}`}
                    style={{ padding: '12px 22px', borderRadius: 10, background: '#fff', color: NAVY, fontWeight: 700, fontSize: 14, textDecoration: 'none', border: '1px solid #E5E7EB' }}>
                Back to session
              </Link>
            </div>
          </div>
        )}
      </div>
    </TrainingShell>
  );
}
