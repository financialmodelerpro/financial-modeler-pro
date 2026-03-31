// ── Video Duration Time Lock ───────────────────────────────────────────────────
// localStorage-based soft timer: starts when student clicks Watch Video,
// unlocks the assessment button after the video duration has elapsed.

const TIMER_PREFIX = 'fmp_timer_';

interface TimerEntry {
  startTime: number;
  durationMinutes: number;
}

export interface TimerStatus {
  locked: boolean;
  secondsRemaining: number;
  started: boolean;
}

/**
 * Start (or resume) a timer for a session.
 * Does NOT restart if the timer is currently running.
 */
export function startTimer(regId: string, tabKey: string, durationMinutes: number): void {
  if (!durationMinutes || durationMinutes === 0) return;
  const key = TIMER_PREFIX + regId + '_' + tabKey;
  const existing = localStorage.getItem(key);
  if (existing) {
    const { startTime } = JSON.parse(existing) as TimerEntry;
    const elapsedSeconds = (Date.now() - startTime) / 1000;
    if (elapsedSeconds < durationMinutes * 60) return; // already running, do not restart
  }
  localStorage.setItem(key, JSON.stringify({ startTime: Date.now(), durationMinutes }));
}

/**
 * Get current timer status for a session (second-level precision).
 */
export function getTimerStatus(regId: string, tabKey: string, durationMinutes: number): TimerStatus {
  if (!durationMinutes || durationMinutes === 0)
    return { locked: false, secondsRemaining: 0, started: false };
  const key = TIMER_PREFIX + regId + '_' + tabKey;
  const stored = localStorage.getItem(key);
  if (!stored)
    return { locked: true, secondsRemaining: durationMinutes * 60, started: false };
  const { startTime } = JSON.parse(stored) as TimerEntry;
  const remainingSeconds = Math.ceil(durationMinutes * 60 - (Date.now() - startTime) / 1000);
  if (remainingSeconds <= 0) return { locked: false, secondsRemaining: 0, started: true };
  return { locked: true, secondsRemaining: remainingSeconds, started: true };
}

/**
 * Format remaining seconds as MM:SS countdown string.
 */
export function formatCountdown(totalSeconds: number): string {
  if (totalSeconds <= 0) return 'Unlocking...';
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  if (h > 0) return `Available in ${h}:${mm}:${ss}`;
  return `Available in ${mm}:${ss}`;
}

/**
 * Returns true if the student may access the assessment.
 */
export function isSessionUnlocked(
  regId: string,
  tabKey: string,
  durationMinutes: number,
  passed: boolean,
  hasVideo: boolean,
): boolean {
  if (passed) return true;
  if (!hasVideo || !durationMinutes) return true;
  return !getTimerStatus(regId, tabKey, durationMinutes).locked;
}
