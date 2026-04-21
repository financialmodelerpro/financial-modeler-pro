'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import type {
  AssessmentQuestionsData,
  AssessmentQuestion,
  AttemptStatus,
  SubmitAssessmentResult,
  QuestionResult,
} from '@/src/lib/training/sheets';
import { COURSES } from '@/src/config/courses';
import { shareTo, FMP_TRAINING_URL } from '@/src/lib/training/share';
import { useShareTemplate } from '@/src/lib/training/useShareTemplate';
import { renderShareTemplate, formatShareDate } from '@/src/lib/training/shareTemplates';

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

// Server-anchored attempt timer (migration 126). Authoritative state lives in
// assessment_attempts_in_progress; the client mirrors it for display + re-syncs
// on visibility change. See src/lib/training/attemptInProgressClient.ts.
import {
  type ServerAttemptState,
  startAttemptApi,
  pauseAttemptApi,
  resumeAttemptApi,
  getAttemptStateApi,
  firePauseOnUnload,
} from '@/src/lib/training/attemptInProgressClient';

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

function NavBar({ isFinal, sessionName, dashUrl }: { isFinal: boolean; sessionName: string; dashUrl: string }) {
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
      <Link href={dashUrl} style={{ color: '#94A3B8', fontSize: 13, textDecoration: 'none', flexShrink: 0 }}>
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
  const courseId = tabKey.toUpperCase().startsWith('BVM') ? 'bvm' : '3sfm';
  const dashUrl = `/training/dashboard?course=${courseId}`;

  // Page state
  const [pageState, setPageState]   = useState<PageState>('loading');
  const [questions, setQuestions]   = useState<AssessmentQuestionsData | null>(null);
  const [status, setStatus]         = useState<AttemptStatus | null>(null);
  const [result, setResult]         = useState<SubmitAssessmentResult | null>(null);
  const [errorMsg, setErrorMsg]     = useState('');
  const [linkCopied, setLinkCopied] = useState(false);
  const [studentName, setStudentName] = useState('');

  // Share template (assessment pass) — fetched once, rendered with live data below.
  const shareTemplate = useShareTemplate('assessment_passed');

  // Taking state
  const [answers, setAnswers]       = useState<Record<number, number>>({});
  const [currentQ, setCurrentQ]     = useState(0);
  const [timeLeft, setTimeLeft]     = useState<number | null>(null);
  const timerRef                    = useRef<ReturnType<typeof setInterval> | null>(null);
  // Attempt number for THIS run (status.attempts at load + 1). Stable across a
  // single attempt even if `status.attempts` changes (e.g. after submit).
  const [attemptForRun, setAttemptForRun] = useState<number | null>(null);
  // Server-anchored timer state (migration 126). Drives countdown, pause UI,
  // and the visibility-change pause/resume flow.
  const [attemptState, setAttemptState] = useState<ServerAttemptState | null>(null);
  // Shuffle settings
  const [shuffleOptions, setShuffleOptions] = useState(false);
  // Maps: for each question index, stores the mapping from shuffled option index → original option index
  // e.g. optionMaps[0] = [2, 0, 3, 1] means shuffled option 0 was originally at index 2
  const [optionMaps, setOptionMaps] = useState<number[][]>([]);

  // Update browser tab title when session name is known (FIX 1)
  useEffect(() => {
    if (questions?.sessionName) {
      document.title = `Assessment | ${questions.sessionName} - Financial Modeler Pro`;
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

    // Quick Supabase check - if already passed, block immediately (no Apps Script delay)
    try {
      const sbCheck = await fetch(`/api/training/progress?email=${encodeURIComponent(email)}&registrationId=${encodeURIComponent(regId)}`);
      const sbData = await sbCheck.json() as { success: boolean; data?: { student?: { name?: string }; sessions: { sessionId: string; passed: boolean; score: number }[] } };
      if (sbData.success && sbData.data) {
        if (sbData.data.student?.name) setStudentName(sbData.data.student.name);
        const sep = tabKey.indexOf('_');
        const sessId = sep >= 0 ? tabKey.slice(sep + 1) : tabKey;
        const finalId = tabKey.toUpperCase().startsWith('BVM') ? 'L7' : 'S18';
        const resolvedId = sessId === 'Final' ? finalId : sessId;
        const match = sbData.data.sessions.find(s => s.sessionId === resolvedId);
        if (match?.passed) {
          setStatus({ passed: true, lastScore: match.score, attempts: 1, maxAttempts: 3, canAttempt: false } as AttemptStatus);
          setPageState('blocked-passed');
          return;
        }
      }
    } catch { /* continue to normal load */ }

    // Fetch global shuffle settings (shared with live sessions — migration 108)
    let shuffleQ = true;
    let shuffleOpt = false;
    try {
      const settingsRes = await fetch('/api/training/assessment-settings');
      const settingsData = await settingsRes.json() as { shuffleQuestions?: boolean; shuffleOptions?: boolean };
      shuffleQ   = settingsData.shuffleQuestions !== false;
      shuffleOpt = settingsData.shuffleOptions === true;
    } catch { /* use defaults */ }
    setShuffleOptions(shuffleOpt);

    // Always ask Apps Script for unshuffled questions — shuffle is applied
    // client-side so one global setting drives both Apps Script-backed and
    // Supabase-backed assessments identically.
    const [statusRes, questionsRes] = await Promise.all([
      fetch(`/api/training/attempt-status?tabKey=${encodeURIComponent(tabKey)}&email=${encodeURIComponent(email)}&regId=${encodeURIComponent(regId)}`),
      fetch(`/api/training/questions?tabKey=${encodeURIComponent(tabKey)}&email=${encodeURIComponent(email)}&regId=${encodeURIComponent(regId)}&shuffle=false`),
    ]);

    const statusData  = await statusRes.json()    as { success: boolean; data?: AttemptStatus; error?: string };
    const questData   = await questionsRes.json() as { success: boolean; data?: AssessmentQuestionsData; error?: string };

    // ── Check attempt status FIRST - takes priority over question-load errors ──
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
      // Apps Script may reject getQuestions if student already passed - treat gracefully
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

    // Shuffle question ORDER client-side if enabled (Fisher-Yates)
    if (shuffleQ && Array.isArray(q.questions) && q.questions.length > 1) {
      for (let i = q.questions.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [q.questions[i], q.questions[j]] = [q.questions[j], q.questions[i]];
      }
    }

    // Shuffle options client-side if enabled
    if (shuffleOpt && q.questions?.length) {
      const maps: number[][] = [];
      for (const question of q.questions) {
        const indices = question.options.map((_: unknown, i: number) => i);
        // Fisher-Yates shuffle on index array
        for (let i = indices.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [indices[i], indices[j]] = [indices[j], indices[i]];
        }
        maps.push(indices);
        // Reorder options according to shuffled indices
        const origOptions = [...question.options];
        question.options = indices.map((idx: number) => origOptions[idx]);
        // Remap correctIndex to match new order
        if (typeof question.correctIndex === 'number') {
          question.correctIndex = indices.indexOf(question.correctIndex);
        }
      }
      setOptionMaps(maps);
    } else {
      setOptionMaps([]);
    }

    setQuestions(q);

    // Restore saved answers
    const savedAnswers = loadSavedAnswers(tabKey);
    setAnswers(savedAnswers);
    setCurrentQ(0);

    // Capture attempt number for THIS run; used as the in-progress key
    // alongside tabKey on every server call.
    const runAttempt = (statusData.data?.attempts ?? 0) + 1;
    setAttemptForRun(runAttempt);

    // ── Timer resume: ask the server whether an in-progress row already
    // exists for this (email, tabKey, attempt). If yes, jump straight to
    // taking state and use the server's authoritative remaining seconds.
    // If the row says expired or grace exhausted with no time left, auto
    // submit with whatever answers were saved in localStorage. ──────────
    const existing = await getAttemptStateApi({ tabKey, attemptNumber: runAttempt });
    if (existing) {
      setAttemptState(existing);
      setTimeLeft(existing.secondsRemaining);
      setPageState('taking');
      if (existing.secondsRemaining <= 0 && !existing.paused) {
        setTimeout(() => handleSubmitRef.current(), 50);
      }
      return;
    }

    setPageState('ready');
  }, [tabKey, router]);

  useEffect(() => { load(); }, [load]);

  // Warn students about losing their attempt if they try to leave mid-assessment.
  useEffect(() => {
    if (pageState !== 'taking') return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
      // Best-effort fire-and-forget pause on intentional close. Browsers
      // throttle synchronous fetches in beforeunload; keepalive lets the
      // request survive page tear-down. Nothing depends on the response.
      if (attemptForRun !== null && attemptState && !attemptState.isFinal && attemptState.pauseAllowed && !attemptState.paused) {
        firePauseOnUnload({ tabKey, attemptNumber: attemptForRun });
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [pageState, attemptForRun, attemptState, tabKey]);

  // ── Timer ──────────────────────────────────────────────────────────────────

  // Keep a stable ref to handleSubmit so the timer closure never captures a stale copy
  const handleSubmitRef = useRef<() => void>(() => { /* placeholder */ });

  // Display tick: re-computes timeLeft from attemptState.expiresAt every
  // second (when not paused). Server is the deadline source of truth, the
  // client just animates toward it. Auto-submits at zero.
  useEffect(() => {
    if (pageState !== 'taking' || !attemptState) return;

    if (attemptState.paused) {
      // Display freezes at the value secondsRemaining had when the row was
      // paused on the server. No tick needed.
      setTimeLeft(attemptState.secondsRemaining);
      return;
    }

    const expiresMs = new Date(attemptState.expiresAt).getTime();
    const recompute = () => {
      const remaining = Math.max(0, Math.floor((expiresMs - Date.now()) / 1000));
      setTimeLeft(remaining);
      if (remaining <= 0) {
        if (timerRef.current) clearInterval(timerRef.current);
        setTimeout(() => handleSubmitRef.current(), 0);
      }
    };
    recompute();
    timerRef.current = setInterval(recompute, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [pageState, attemptState]);

  // Visibility-change pause/resume. Tab hidden = best-effort POST /pause; tab
  // visible = POST /resume + sync state. Final exams skip pause; the wall
  // clock keeps running and we only re-fetch state on visible.
  useEffect(() => {
    if (pageState !== 'taking' || attemptForRun === null) return;
    const idn = { tabKey, attemptNumber: attemptForRun };

    const onVisChange = async () => {
      if (document.visibilityState === 'hidden') {
        if (!attemptState || attemptState.isFinal || !attemptState.pauseAllowed || attemptState.paused) return;
        const res = await pauseAttemptApi(idn);
        if (res.ok && res.state) setAttemptState(res.state);
      } else {
        // Whether or not we ever paused, sync state to the server view on focus.
        // Server returns updated row (with new expiresAt if a pause was in flight).
        const resumed = await resumeAttemptApi(idn);
        if (resumed) {
          setAttemptState(resumed);
        } else {
          const fresh = await getAttemptStateApi(idn);
          if (fresh) setAttemptState(fresh);
        }
      }
    };

    document.addEventListener('visibilitychange', onVisChange);
    return () => document.removeEventListener('visibilitychange', onVisChange);
  }, [pageState, attemptForRun, tabKey, attemptState]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  async function startAssessment() {
    if (attemptForRun === null) return;
    setCurrentQ(0);
    const timerMin = questions ? (questions.timeLimit || questions.questions.length) : null;
    const isFinalExam = questions?.isFinal ?? false;
    const state = await startAttemptApi({ tabKey, attemptNumber: attemptForRun }, timerMin, isFinalExam);
    if (state) setAttemptState(state);
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

    if (!questions?.questions?.length) {
      setErrorMsg('No questions loaded. Please refresh and try again.');
      setPageState('ready');
      return;
    }

    // ── Step 1: Score CLIENT-SIDE - compare answers to stored correctIndex ──
    const total = questions.questions.length;
    let correctCount = 0;
    console.log('[assessment] Scoring - first 3 questions correctIndex:', questions.questions.slice(0, 3).map(q => q.correctIndex));
    const results: QuestionResult[] = questions.questions.map((q, i) => {
      // Student's picked index (in current display order)
      const picked = answers[i] ?? -1;

      // If options were shuffled, map back to original index for scoring
      let originalPicked = picked;
      if (picked >= 0 && optionMaps.length > 0 && optionMaps[i]) {
        originalPicked = optionMaps[i][picked];
      }

      // correctIndex is already in display order (was remapped during shuffle)
      // so compare picked (display) vs correctIndex (display) directly
      const correct   = typeof q.correctIndex === 'number' ? q.correctIndex : -1;
      const isCorrect = correct >= 0 && picked === correct;
      if (isCorrect) correctCount++;

      return {
        index: i,
        q: q.q,
        type: undefined,
        options: q.options,
        submitted: picked,
        submittedText: picked >= 0 ? (q.options[picked] ?? '') : '',
        correct,
        correctText: correct >= 0 ? (q.options[correct] ?? '') : '',
        isCorrect,
        explanation: q.explanation ?? '',
      };
    });

    const score       = total > 0 ? Math.round((correctCount / total) * 100) : 0;
    const passScore   = questions.passingScore ?? 70;
    const passed      = score >= passScore;
    const maxAtt      = questions.maxAttempts ?? 3;
    const attemptNo   = (status?.attempts ?? 0) + 1;
    const canRetry    = !passed && attemptNo < maxAtt;
    const isFinalExam = questions.isFinal ?? false;

    const sessionLabel = getSessionTitleFromTabKey(tabKey);
    const submitPayload = {
      tabKey, regId, email, score, passed, isFinal: isFinalExam, attemptNo,
      maxAttempts: maxAtt, passingScore: passScore, sessionName: sessionLabel,
    };
    console.log('[assessment] Client-side score:', { correctCount, total });
    console.log('[assessment] Submit payload:', JSON.stringify(submitPayload));

    // ── Step 2: Send scored result to server API (which writes to Apps Script) ──
    try {
      const res = await fetch('/api/training/submit-assessment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(submitPayload),
      });
      const resData = await res.json();
      console.log('[assessment] Submit response:', resData);
    } catch (err) {
      console.error('[assessment] Submit to Apps Script failed:', err);
      // Non-fatal - show results anyway, score is calculated locally
    }

    // ── Step 3: Show results - NEVER re-fetch questions ──
    // Server-side cleanup of the in-progress row happens inside
    // /api/training/submit-assessment after the score is recorded.
    clearSavedAnswers(tabKey);
    setResult({
      tabKey,
      score,
      passed,
      correctCount,
      totalQuestions: total,
      attempts: attemptNo,
      maxAttempts: maxAtt,
      canRetry,
      results,
    });
    setPageState('results');
  }

  // Keep timer ref in sync with latest handleSubmit on every render
  handleSubmitRef.current = handleSubmit;

  // ── Render helpers ─────────────────────────────────────────────────────────

  const isFinal      = questions?.isFinal ?? false;
  const sessionName  = (questions?.sessionName && questions.sessionName !== tabKey)
    ? questions.sessionName
    : getSessionTitleFromTabKey(tabKey);
  const accentColor  = isFinal ? GOLD : GREEN;
  const totalQ       = questions?.questions.length ?? 0;
  const answered     = Object.keys(answers).length;
  const passingScore = questions?.passingScore ?? 70;
  // 1 minute per question; Apps Script timeLimit takes priority if provided
  const effectiveTimeLimit = questions ? (questions.timeLimit || totalQ) : 0;

  function formatTime(secs: number) {
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  // ── Render: loading ────────────────────────────────────────────────────────

  if (pageState === 'loading') {
    return (
      <div style={{ minHeight: '100vh', background: LIGHT_BG }}>
        <NavBar isFinal={false} sessionName="Loading…" dashUrl={dashUrl} />
        <Spinner />
      </div>
    );
  }

  // ── Render: blocked-passed ─────────────────────────────────────────────────

  if (pageState === 'blocked-passed') {
    return (
      <div style={{ minHeight: '100vh', background: LIGHT_BG }}>
        <NavBar isFinal={isFinal} sessionName={sessionName} dashUrl={dashUrl} />
        <div style={{ maxWidth: 560, margin: '80px auto', padding: '0 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 64, marginBottom: 16 }}>🎉</div>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: NAVY, marginBottom: 12 }}>
            You already passed!
          </h1>
          <p style={{ color: '#475569', marginBottom: 8 }}>
            You passed <strong>{sessionName}</strong> with a score of{' '}
            <strong style={{ color: GREEN }}>{status?.lastScore ?? '-'}%</strong>.
          </p>
          <p style={{ color: '#64748B', fontSize: 14, marginBottom: 32 }}>
            No need to retake - your progress is saved.
          </p>
          <Link href={dashUrl} style={{
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
        <NavBar isFinal={isFinal} sessionName={sessionName} dashUrl={dashUrl} />
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
          <Link href={dashUrl} style={{
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
          <NavBar isFinal={false} sessionName={sessionName} dashUrl={dashUrl} />
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
            <Link href={dashUrl} style={{
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
        <NavBar isFinal={isFinal} sessionName={sessionName} dashUrl={dashUrl} />
        <div style={{ maxWidth: 820, margin: '60px auto', padding: '0 24px' }}>

          {/* Error banner (non-fatal - questions loaded but submission failed) */}
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
                {questions?.course} - Assessment
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
                  ...(effectiveTimeLimit ? [{ label: 'Time Limit', value: `${effectiveTimeLimit} min` }] : []),
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
                  ⚠️ {isFinal ? 'This is the Final Exam - ' : ''}You have only 1 attempt. There is no retry once submitted.
                </div>
              )}

              {/* Previous attempt */}
              {status && status.attempts > 0 && (
                <div style={{
                  background: '#F1F5F9', borderRadius: 8, padding: '12px 16px',
                  marginBottom: 24, fontSize: 13, color: '#475569',
                }}>
                  Previous attempt: <strong>{status.lastScore ?? '-'}%</strong>
                  {status.lastCompletedAt && ` on ${new Date(status.lastCompletedAt).toLocaleDateString()}`}
                </div>
              )}

              {/* Instructions */}
              <ul style={{ color: '#475569', fontSize: 14, lineHeight: 1.7, paddingLeft: 20, marginBottom: 32 }}>
                <li>Select one answer per question.</li>
                <li>You can navigate between questions before submitting.</li>
                {effectiveTimeLimit ? <li>You have <strong>{effectiveTimeLimit} minutes</strong> total. Timer starts when you begin - assessment auto-submits when time runs out.</li> : null}
                <li>Your answers are saved as you go - refreshing is safe.</li>
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
      <div
        style={{ minHeight: '100vh', background: LIGHT_BG, position: 'relative' }}
        onCopy={e => e.preventDefault()}
        onCut={e => e.preventDefault()}
        onContextMenu={e => e.preventDefault()}
      >
        <NavBar isFinal={isFinal} sessionName={sessionName} dashUrl={dashUrl} />

        {/* Paused overlay — blocks interaction while attempt is paused on the
            server. Auto-dismisses when the visibility-change resume completes
            and attemptState.paused flips back to false. */}
        {attemptState?.paused && (
          <div style={{
            position: 'fixed', inset: 0, zIndex: 50,
            background: 'rgba(15, 23, 42, 0.55)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            backdropFilter: 'blur(2px)',
          }}>
            <div style={{
              background: WHITE, borderRadius: 14, padding: '28px 36px',
              maxWidth: 420, textAlign: 'center', boxShadow: '0 12px 40px rgba(0,0,0,0.25)',
              border: `2px solid #FDE68A`,
            }}>
              <div style={{ fontSize: 36, marginBottom: 8 }}>⏸</div>
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
                Grace remaining: {formatTime(attemptState.graceSecondsRemaining)}
              </div>
            </div>
          </div>
        )}

        {/* Progress + timer bar - sticky below navbar */}
        <div style={{
          position: 'sticky', top: 0, zIndex: 10,
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
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
              {attemptState?.paused ? (
                <div style={{
                  fontSize: 14, fontWeight: 800, color: '#92400E', background: '#FEF3C7',
                  border: '1px solid #FDE68A', padding: '6px 12px', borderRadius: 8,
                  fontVariantNumeric: 'tabular-nums',
                }}>
                  PAUSED (Grace remaining: {formatTime(attemptState.graceSecondsRemaining)})
                </div>
              ) : (
                <div style={{
                  fontSize: 20, fontWeight: 800, color: timeLeft < 120 ? '#DC2626' : NAVY,
                  fontVariantNumeric: 'tabular-nums',
                }}>
                  Time remaining: {formatTime(timeLeft)}
                </div>
              )}
              {attemptState && (
                <div style={{ fontSize: 11, color: '#64748B' }}>
                  {attemptState.isFinal
                    ? 'Final exam, no pauses allowed'
                    : attemptState.pauseCount > 0 && attemptState.graceSecondsRemaining > 0
                      ? `${attemptState.pauseCount} pause used (${formatTime(attemptState.graceSecondsRemaining)} grace remaining)`
                      : !attemptState.pauseAllowed && attemptState.pauseCount > 0
                        ? 'Grace exhausted'
                        : null}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Scrollable content - wider container, bottom padding clears sticky nav bar */}
        <div style={{ maxWidth: 1120, margin: '40px auto', padding: '0 24px 96px' }}>
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

          {/* Question card - copy/select disabled to prevent cheating */}
          <div style={{
            background: WHITE, borderRadius: 12, border: `1px solid ${BORDER}`,
            boxShadow: '0 2px 8px rgba(0,0,0,0.06)', padding: 32,
            userSelect: 'none', WebkitUserSelect: 'none',
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
        </div>

        {/* ── Sticky bottom navigation bar ───────────────────────────────────── */}
        <div style={{
          position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 10,
          background: WHITE, borderTop: `1px solid ${BORDER}`,
          padding: '12px 24px',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
        }}>
          <button
            onClick={() => setCurrentQ(q => Math.max(0, q - 1))}
            disabled={currentQ === 0}
            style={{
              padding: '10px 20px', borderRadius: 8, border: `1px solid ${BORDER}`,
              background: WHITE, color: NAVY, fontWeight: 600,
              cursor: currentQ === 0 ? 'not-allowed' : 'pointer',
              opacity: currentQ === 0 ? 0.4 : 1, fontSize: 14,
            }}
          >
            ← Previous
          </button>

          {/* Centre: answered count */}
          <span style={{ fontSize: 13, color: '#64748B', fontWeight: 500 }}>
            {answered}/{totalQ} answered
          </span>

          {currentQ < totalQ - 1 ? (
            <button
              onClick={() => setCurrentQ(q => q + 1)}
              style={{
                padding: '10px 20px', borderRadius: 8, border: 'none',
                background: NAVY, color: WHITE, fontWeight: 600, cursor: 'pointer', fontSize: 14,
              }}
            >
              Next →
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={!allAnswered}
              style={{
                padding: '10px 24px', borderRadius: 8, border: 'none',
                background: allAnswered ? accentColor : BORDER,
                color: allAnswered ? WHITE : '#94A3B8',
                fontWeight: 700, cursor: allAnswered ? 'pointer' : 'not-allowed', fontSize: 14,
              }}
            >
              {allAnswered ? 'Submit Assessment ✓' : `${totalQ - answered} left`}
            </button>
          )}
        </div>
      </div>
    );
  }

  // ── Render: submitting ─────────────────────────────────────────────────────

  if (pageState === 'submitting') {
    return (
      <div style={{ minHeight: '100vh', background: LIGHT_BG }}>
        <NavBar isFinal={isFinal} sessionName={sessionName} dashUrl={dashUrl} />
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
      <div
        style={{ minHeight: '100vh', background: LIGHT_BG }}
        onCopy={e => e.preventDefault()}
        onCut={e => e.preventDefault()}
        onContextMenu={e => e.preventDefault()}
      >
        <NavBar isFinal={isFinal} sessionName={sessionName} dashUrl={dashUrl} />

        <div style={{ maxWidth: 780, margin: '60px auto 32px', padding: '0 24px', textAlign: 'center' }}>
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
                You scored <strong style={{ color: '#DC2626' }}>{result.score}%</strong> - passing score is {passingScore}%.
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
                  : 'No attempts remaining - please contact your instructor.'}
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
              <button onClick={() => {
                // Store submitted score so dashboard can optimistically update localStorage cache
                try {
                  sessionStorage.setItem('fmp_last_submit', JSON.stringify({
                    tabKey,
                    score: result.score,
                    passed: result.passed,
                    attempts: result.attempts,
                  }));
                } catch { /* ignore */ }
                router.push(`/training/dashboard?course=${courseId}&refresh=1`);
              }} style={{
                display: 'block', width: '100%', background: NAVY, color: WHITE,
                padding: '14px', borderRadius: 8, fontWeight: 700,
                cursor: 'pointer', border: 'none', fontSize: 15,
                textAlign: 'center',
              }}>
                ← Back to Dashboard
              </button>
            </div>
          </div>
        </div>

        {/* Share achievement - only shown when student PASSES */}
        {passed && (() => {
          const passDate = formatShareDate(new Date());
          const courseName = courseId === 'bvm' ? 'Business Valuation Modeling' : '3-Statement Financial Modeling';
          const sess = getTrainingSession();
          const regIdVal = sess?.registrationId || '';
          const cardImgUrl = `/api/training/achievement-image?session=${encodeURIComponent(sessionName)}&score=${result.score}&course=${encodeURIComponent(courseName)}&date=${encodeURIComponent(passDate)}&name=${encodeURIComponent(studentName)}&regId=${encodeURIComponent(regIdVal)}`;
          const rendered = renderShareTemplate(shareTemplate, {
            studentName,
            sessionName,
            score:       result.score,
            course:      courseName,
            date:        passDate,
            regId:       regIdVal,
          });
          const shareText = rendered.text;
          const shareHashtags = rendered.hashtags;
          // The readonly preview shows exactly what `shareTo()` puts on the
          // clipboard — body + blank line + space-joined hashtags. Keeps
          // "what I see" and "what I paste" in sync with every other
          // share entry point across the platform.
          const previewText = shareHashtags.length
            ? `${shareText}\n\n${shareHashtags.map(h => `#${h.replace(/^#/, '')}`).join(' ')}`
            : shareText;
          const onShared = () => { setLinkCopied(true); setTimeout(() => setLinkCopied(false), 2500); };
          return (
            <div style={{ maxWidth: 780, margin: '0 auto 32px', padding: '0 24px' }}>
              <div style={{ background: WHITE, borderRadius: 12, border: '1px solid #E5E7EB', padding: '24px 28px' }}>
                <div style={{ fontSize: 13, color: '#6B7280', marginBottom: 6, textAlign: 'center' }}>📅 Passed on {passDate}</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: NAVY, marginBottom: 16, textAlign: 'center' }}>🎉 Share your achievement!</div>
                {/* Achievement card preview */}
                <div style={{ marginBottom: 12 }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={cardImgUrl} alt="Your Achievement Card"
                    style={{ width: '100%', maxWidth: 600, borderRadius: 12, border: '1px solid #E5E7EB', display: 'block', margin: '0 auto' }} />
                </div>
                {/* Download */}
                <div style={{ textAlign: 'center', marginBottom: 16 }}>
                  <a href={cardImgUrl} download="FMP-Achievement.png"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '12px 24px', background: '#1F3864', color: '#fff', borderRadius: 8, fontSize: 14, fontWeight: 600, textDecoration: 'none' }}>
                    ⬇️ Download Achievement Card
                  </a>
                </div>
                {/* Share text — includes hashtags so the preview matches what
                    the clipboard will contain after clicking Share on LinkedIn. */}
                <textarea readOnly value={previewText} rows={7}
                  style={{ width: '100%', padding: '10px 12px', border: '1px solid #D1D5DB', borderRadius: 8, fontSize: 12, fontFamily: 'Inter,sans-serif', resize: 'none', lineHeight: 1.6, boxSizing: 'border-box', marginBottom: 12, color: '#374151', background: '#F9FAFB' }} />
                {/* Instruction */}
                <div style={{ fontSize: 12, color: '#6B7280', background: '#F0F9FF', border: '1px solid #BAE6FD', borderRadius: 8, padding: '10px 14px', marginBottom: 12, lineHeight: 1.5 }}>
                  💡 Click <strong>Share on LinkedIn</strong> - your text is auto-copied. Just <strong>paste it (Ctrl+V)</strong> in LinkedIn and attach the downloaded card.
                </div>
                {/* Buttons (universal share utility handles auto-copy + open) */}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => shareTo('linkedin', { text: shareText, url: FMP_TRAINING_URL, hashtags: shareHashtags, onCopied: onShared })}
                    style={{ flex: 1, padding: '10px 14px', background: '#0077b5', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                    💼 Share on LinkedIn
                  </button>
                  <button onClick={() => shareTo('copy', { text: shareText, url: FMP_TRAINING_URL, hashtags: shareHashtags, onCopied: onShared })}
                    style={{ flex: 1, padding: '10px 14px', background: linkCopied ? '#F0FDF4' : '#F3F4F6', color: linkCopied ? '#16A34A' : '#374151', border: `1px solid ${linkCopied ? '#86EFAC' : '#E5E7EB'}`, borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                    {linkCopied ? '✓ Copied!' : '🔗 Copy Text'}
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Per-question review - only shown when student PASSES */}
        {passed && Array.isArray(result.results) && result.results.length > 0 && (
          <div style={{ maxWidth: 900, margin: '0 auto 60px', padding: '0 24px' }}>
            <h2 style={{ fontSize: 18, fontWeight: 800, color: NAVY, marginBottom: 16 }}>
              Question Review
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {(result.results as QuestionResult[]).map((qr, i) => {
                // Apps Script returns: correct (number index), submitted (number index), isCorrect (boolean)
                const questionText = qr?.q || `Question ${i + 1}`;
                const options      = Array.isArray(qr?.options) ? qr.options : [];
                const correctIdx   = typeof qr?.correct    === 'number' ? qr.correct    : -1;
                const yourIdx      = typeof qr?.submitted  === 'number' ? qr.submitted  : -1;
                const isCorrect    = qr?.isCorrect ?? false;

                return (
                  <div key={i} style={{
                    background: WHITE, borderRadius: 12,
                    border: `1px solid ${isCorrect ? '#BBF7D0' : '#FECACA'}`,
                    boxShadow: '0 1px 4px rgba(0,0,0,0.05)', overflow: 'hidden',
                  }}>
                    {/* Question header */}
                    <div style={{
                      background: isCorrect ? '#F0FDF4' : '#FEF2F2',
                      padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 10,
                      userSelect: 'none', WebkitUserSelect: 'none',
                    } as React.CSSProperties}>
                      <span style={{
                        width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                        background: isCorrect ? GREEN : '#DC2626', color: WHITE,
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 13, fontWeight: 800,
                      }}>
                        {i + 1}
                      </span>
                      <p style={{ fontSize: 14, fontWeight: 600, color: NAVY, margin: 0, lineHeight: 1.5 }}>
                        {questionText}
                      </p>
                    </div>

                    {/* Options - only rendered if the API returned them */}
                    {options.length > 0 && (
                      <div style={{ padding: '14px 20px', display: 'flex', flexDirection: 'column', gap: 8, userSelect: 'none', WebkitUserSelect: 'none' } as React.CSSProperties}>
                        {options.map((opt, oi) => {
                          const letter      = String.fromCharCode(65 + oi);
                          const optCorrect  = oi === correctIdx;
                          const optYours    = oi === yourIdx;
                          const optWrong    = optYours && !isCorrect;

                          let bg     = '#F8FAFC';
                          let bdr    = BORDER;
                          let color  = '#475569';
                          let label  = '';

                          if (optCorrect) { bg = '#F0FDF4'; bdr = '#86EFAC'; color = '#15803D'; label = '✓ Correct'; }
                          if (optWrong)   { bg = '#FEF2F2'; bdr = '#FCA5A5'; color = '#DC2626'; label = '✗ Your answer'; }

                          return (
                            <div key={oi} style={{
                              display: 'flex', alignItems: 'center', gap: 10,
                              padding: '10px 14px', borderRadius: 8,
                              border: `1.5px solid ${bdr}`, background: bg,
                            }}>
                              <span style={{
                                width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
                                background: optCorrect ? GREEN : optWrong ? '#DC2626' : BORDER,
                                color: (optCorrect || optWrong) ? WHITE : '#64748B',
                                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: 11, fontWeight: 700,
                              }}>
                                {letter}
                              </span>
                              <span style={{ fontSize: 13, color, flex: 1 }}>{opt ?? ''}</span>
                              {label && (
                                <span style={{ fontSize: 11, fontWeight: 700, color, flexShrink: 0 }}>{label}</span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Fallback when options not in API response: show correct/your answer as text */}
                    {options.length === 0 && (qr?.submittedText || qr?.correctText) && (
                      <div style={{ padding: '12px 20px', display: 'flex', flexDirection: 'column', gap: 6, userSelect: 'none', WebkitUserSelect: 'none' } as React.CSSProperties}>
                        {qr.submittedText && (
                          <div style={{ fontSize: 13, color: isCorrect ? '#15803D' : '#DC2626', fontWeight: 600 }}>
                            Your answer: {qr.submittedText}
                          </div>
                        )}
                        {!isCorrect && qr.correctText && (
                          <div style={{ fontSize: 13, color: '#15803D', fontWeight: 600 }}>
                            Correct answer: {qr.correctText}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Explanation */}
                    {qr?.explanation && (
                      <div style={{
                        margin: '0 20px 16px', padding: '10px 14px', borderRadius: 8,
                        background: '#F0F9FF', border: '1px solid #BAE6FD',
                        fontSize: 13, color: '#0369A1', lineHeight: 1.6,
                        userSelect: 'none', WebkitUserSelect: 'none',
                      } as React.CSSProperties}>
                        💡 {qr.explanation}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  }

  return null;
}
