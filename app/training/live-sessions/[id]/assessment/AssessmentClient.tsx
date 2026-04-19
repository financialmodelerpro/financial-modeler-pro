'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { TrainingShell } from '@/src/components/training/TrainingShell';
import { ArrowLeft, Clock, CheckCircle2, XCircle, Award, Lock } from 'lucide-react';
import type { StudentAssessmentView } from '@/src/lib/training/liveSessionAssessments';

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
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<SubmitResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  useEffect(() => {
    if (phase !== 'quiz' || !assessment.timer_minutes || !startedAt) return;
    const deadline = startedAt + assessment.timer_minutes * 60 * 1000;
    const tick = () => {
      const left = Math.max(0, Math.floor((deadline - Date.now()) / 1000));
      setTimeLeft(left);
      if (left <= 0) {
        void handleSubmit();
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, startedAt, assessment.timer_minutes]);

  function startQuiz() {
    setError(null);
    setAnswers({});
    setStartedAt(Date.now());
    if (assessment.timer_minutes) setTimeLeft(assessment.timer_minutes * 60);
    setPhase('quiz');
  }

  async function handleSubmit() {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const timeTakenSeconds = startedAt ? Math.floor((Date.now() - startedAt) / 1000) : null;

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
          <div>
            {timeLeft != null && (
              <div style={{
                position: 'sticky', top: 0, zIndex: 10,
                background: timeLeft < 60 ? RED : BLUE,
                color: '#fff', padding: '10px 16px', borderRadius: 8,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                marginBottom: 16, fontSize: 13, fontWeight: 700,
              }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <Clock size={14} /> Time remaining
                </span>
                <span style={{ fontSize: 18, fontVariantNumeric: 'tabular-nums' }}>{fmtTime(timeLeft)}</span>
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
