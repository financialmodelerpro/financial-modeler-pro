import { getServerClient } from '@/src/core/db/supabase';

export interface LiveSessionQuestion {
  id: string;
  question: string;
  options: string[];
  correct_index: number;
  explanation?: string;
  order: number;
}

export interface LiveSessionAssessment {
  id: string;
  session_id: string;
  enabled: boolean;
  questions: LiveSessionQuestion[];
  pass_threshold: number;
  max_attempts: number;
  timer_minutes: number | null;
  require_watch_before_assessment: boolean;
  watch_threshold: number;
  created_at?: string;
  updated_at?: string;
}

export interface LiveSessionAttempt {
  id: string;
  session_id: string;
  email: string;
  reg_id: string | null;
  attempt_number: number;
  score: number;
  passed: boolean;
  answers: Record<string, number>;
  question_results: Record<string, boolean>;
  time_taken_seconds: number | null;
  submitted_at: string;
  pause_count: number;
  total_paused_seconds: number;
  pause_log: Array<{ pausedAt: string; resumedAt: string; durationSeconds: number }>;
}

export interface StudentAssessmentView {
  id: string;
  session_id: string;
  enabled: boolean;
  questions: Array<Omit<LiveSessionQuestion, 'correct_index' | 'explanation'>>;
  pass_threshold: number;
  max_attempts: number;
  timer_minutes: number | null;
  require_watch_before_assessment: boolean;
  watch_threshold: number;
}

export function stripAnswersForStudent(a: LiveSessionAssessment): StudentAssessmentView {
  return {
    id: a.id,
    session_id: a.session_id,
    enabled: a.enabled,
    pass_threshold: a.pass_threshold,
    max_attempts: a.max_attempts,
    timer_minutes: a.timer_minutes,
    require_watch_before_assessment: a.require_watch_before_assessment,
    watch_threshold: a.watch_threshold,
    questions: (a.questions ?? []).map(q => ({
      id: q.id,
      question: q.question,
      options: q.options,
      order: q.order ?? 0,
    })),
  };
}

export async function getAssessment(sessionId: string): Promise<LiveSessionAssessment | null> {
  const sb = getServerClient();
  const { data } = await sb
    .from('live_session_assessments')
    .select('*')
    .eq('session_id', sessionId)
    .maybeSingle();
  return (data as LiveSessionAssessment | null) ?? null;
}

export async function saveAssessment(
  sessionId: string,
  data: Partial<Omit<LiveSessionAssessment, 'id' | 'session_id' | 'created_at' | 'updated_at'>>,
): Promise<LiveSessionAssessment> {
  const sb = getServerClient();
  const payload: Record<string, unknown> = {
    session_id: sessionId,
    updated_at: new Date().toISOString(),
  };
  if (data.enabled !== undefined) payload.enabled = data.enabled;
  if (data.questions !== undefined) payload.questions = data.questions;
  if (data.pass_threshold !== undefined) payload.pass_threshold = data.pass_threshold;
  if (data.max_attempts !== undefined) payload.max_attempts = data.max_attempts;
  if (data.timer_minutes !== undefined) payload.timer_minutes = data.timer_minutes;
  if (data.require_watch_before_assessment !== undefined) {
    payload.require_watch_before_assessment = data.require_watch_before_assessment;
  }
  if (data.watch_threshold !== undefined) payload.watch_threshold = data.watch_threshold;

  const { data: saved, error } = await sb
    .from('live_session_assessments')
    .upsert(payload, { onConflict: 'session_id' })
    .select('*')
    .single();

  if (error) throw new Error(error.message);

  // Keep the denormalized flag in sync.
  const hasQuestions = Array.isArray(saved?.questions) && saved.questions.length > 0;
  await sb
    .from('live_sessions')
    .update({ has_assessment: saved?.enabled === true && hasQuestions })
    .eq('id', sessionId);

  return saved as LiveSessionAssessment;
}

export async function deleteAssessment(sessionId: string): Promise<void> {
  const sb = getServerClient();
  await sb.from('live_session_assessments').delete().eq('session_id', sessionId);
  await sb.from('live_sessions').update({ has_assessment: false }).eq('id', sessionId);
}

export async function getStudentAttempts(
  sessionId: string,
  email: string,
): Promise<LiveSessionAttempt[]> {
  const sb = getServerClient();
  const { data } = await sb
    .from('live_session_attempts')
    .select('*')
    .eq('session_id', sessionId)
    .eq('email', email.toLowerCase())
    .order('attempt_number', { ascending: true });
  return (data ?? []) as LiveSessionAttempt[];
}

export async function getAllAttemptsForSession(
  sessionId: string,
): Promise<LiveSessionAttempt[]> {
  const sb = getServerClient();
  const { data } = await sb
    .from('live_session_attempts')
    .select('*')
    .eq('session_id', sessionId)
    .order('submitted_at', { ascending: false });
  return (data ?? []) as LiveSessionAttempt[];
}

/** Latest attempt for a student on a session (or null if none). */
export async function getLatestAttempt(
  sessionId: string,
  email: string,
): Promise<LiveSessionAttempt | null> {
  const attempts = await getStudentAttempts(sessionId, email);
  return attempts.length > 0 ? attempts[attempts.length - 1] : null;
}

export async function hasPassed(sessionId: string, email: string): Promise<boolean> {
  const sb = getServerClient();
  const { data } = await sb
    .from('live_session_attempts')
    .select('id')
    .eq('session_id', sessionId)
    .eq('email', email.toLowerCase())
    .eq('passed', true)
    .limit(1);
  return (data?.length ?? 0) > 0;
}

export async function getWatchPercentage(sessionId: string, email: string): Promise<number> {
  const sb = getServerClient();
  const { data } = await sb
    .from('session_watch_history')
    .select('watch_percentage, status')
    .eq('session_id', sessionId)
    .eq('student_email', email.toLowerCase())
    .maybeSingle();
  if (!data) return 0;
  if (data.status === 'completed') return Math.max(100, Number(data.watch_percentage ?? 100));
  return Math.max(0, Math.min(100, Number(data.watch_percentage ?? 0)));
}

export async function isWatchRequirementMet(
  sessionId: string,
  email: string,
  threshold: number,
): Promise<boolean> {
  const pct = await getWatchPercentage(sessionId, email);
  return pct >= threshold;
}

/**
 * Score + persist a new attempt. Throws if max_attempts reached or assessment
 * is disabled. Returns the saved attempt plus whether the student may retry.
 *
 * Optional `pauseSnapshot` denormalizes pause history (migration 126) onto
 * the resulting `live_session_attempts` row so the admin attempts viewer
 * can surface pause counts after the in-progress row has been deleted.
 */
export async function submitAttempt(params: {
  sessionId: string;
  email: string;
  regId: string | null;
  answers: Record<string, number>;
  timeTakenSeconds: number | null;
  pauseSnapshot?: {
    pauseCount:         number;
    totalPausedSeconds: number;
    pauseLog:           unknown[];
  };
}): Promise<{ attempt: LiveSessionAttempt; canRetry: boolean; assessment: LiveSessionAssessment }> {
  const { sessionId, email, regId, answers, timeTakenSeconds, pauseSnapshot } = params;
  const normalizedEmail = email.toLowerCase();

  const assessment = await getAssessment(sessionId);
  if (!assessment) throw new Error('Assessment not configured for this session.');
  if (!assessment.enabled) throw new Error('Assessment is not enabled.');
  if (!assessment.questions || assessment.questions.length === 0) {
    throw new Error('Assessment has no questions.');
  }

  if (assessment.require_watch_before_assessment) {
    const ok = await isWatchRequirementMet(sessionId, normalizedEmail, assessment.watch_threshold);
    if (!ok) throw new Error('Watch requirement not met.');
  }

  const existing = await getStudentAttempts(sessionId, normalizedEmail);
  const alreadyPassed = existing.some(a => a.passed);
  if (alreadyPassed) throw new Error('You have already passed this assessment.');
  if (existing.length >= assessment.max_attempts) throw new Error('Maximum attempts reached.');

  let correctCount = 0;
  const questionResults: Record<string, boolean> = {};
  for (const q of assessment.questions) {
    const studentAnswer = Number(answers[q.id]);
    const isCorrect = Number.isFinite(studentAnswer) && studentAnswer === q.correct_index;
    questionResults[q.id] = isCorrect;
    if (isCorrect) correctCount++;
  }

  const score = Math.round((correctCount / assessment.questions.length) * 100);
  const passed = score >= assessment.pass_threshold;
  const attemptNumber = existing.length + 1;

  const sb = getServerClient();
  const { data: inserted, error } = await sb
    .from('live_session_attempts')
    .insert({
      session_id: sessionId,
      email: normalizedEmail,
      reg_id: regId ?? null,
      attempt_number: attemptNumber,
      score,
      passed,
      answers,
      question_results: questionResults,
      time_taken_seconds: timeTakenSeconds,
      pause_count:          pauseSnapshot?.pauseCount         ?? 0,
      total_paused_seconds: pauseSnapshot?.totalPausedSeconds ?? 0,
      pause_log:            pauseSnapshot?.pauseLog           ?? [],
    })
    .select('*')
    .single();

  if (error || !inserted) {
    throw new Error(error?.message ?? 'Failed to save attempt.');
  }

  const canRetry = !passed && attemptNumber < assessment.max_attempts;

  return { attempt: inserted as LiveSessionAttempt, canRetry, assessment };
}
