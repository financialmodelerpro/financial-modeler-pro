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
  minutesRemaining: number;
  started: boolean;
}

/**
 * Start (or resume) a timer for a session.
 * Does NOT restart if the timer is currently running.
 * Re-starts if the timer has already expired (e.g. retake scenario).
 */
export function startTimer(regId: string, tabKey: string, durationMinutes: number): void {
  if (!durationMinutes || durationMinutes === 0) return;
  const key = TIMER_PREFIX + regId + '_' + tabKey;
  const existing = localStorage.getItem(key);
  if (existing) {
    const { startTime } = JSON.parse(existing) as TimerEntry;
    const elapsed = (Date.now() - startTime) / 1000 / 60;
    if (elapsed < durationMinutes) return; // already running, do not restart
  }
  localStorage.setItem(key, JSON.stringify({ startTime: Date.now(), durationMinutes }));
}

/**
 * Get current timer status for a session.
 */
export function getTimerStatus(regId: string, tabKey: string, durationMinutes: number): TimerStatus {
  if (!durationMinutes || durationMinutes === 0)
    return { locked: false, minutesRemaining: 0, started: false };
  const key = TIMER_PREFIX + regId + '_' + tabKey;
  const stored = localStorage.getItem(key);
  if (!stored)
    return { locked: true, minutesRemaining: durationMinutes, started: false };
  const { startTime } = JSON.parse(stored) as TimerEntry;
  const remaining = durationMinutes - (Date.now() - startTime) / 1000 / 60;
  if (remaining <= 0) return { locked: false, minutesRemaining: 0, started: true };
  return { locked: true, minutesRemaining: Math.ceil(remaining), started: true };
}

/**
 * Format remaining minutes as a human-readable countdown string.
 */
export function formatCountdown(minutes: number): string {
  if (minutes <= 0) return 'Unlocking...';
  if (minutes < 60) return `Available in ${minutes} min`;
  const hrs  = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0
    ? `Available in ${hrs} hr ${mins} min`
    : `Available in ${hrs} hr`;
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
  if (passed) return true;                        // already passed
  if (!hasVideo || !durationMinutes) return true; // no video or no lock
  return !getTimerStatus(regId, tabKey, durationMinutes).locked;
}
