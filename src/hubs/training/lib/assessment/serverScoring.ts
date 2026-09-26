/**
 * serverScoring.ts (2026-09-26)
 *
 * THE SERVER SCORES AN ASSESSMENT, AND THE ANSWER KEY NEVER LEAVES IT.
 *
 * Until 2026-09-26 the browser was sent every question WITH its correct
 * answer and explanation, scored itself, and posted the score and the pass
 * flag to submit-assessment, which recorded them for whatever email the body
 * named and, on a final-exam pass, issued a CERTIFICATE. So anyone could read
 * the answers before answering, and anyone could post a pass for anyone.
 *
 * Now:
 *   - the questions the browser receives carry a key, the text and the
 *     options, and NOTHING else (publicQuestion);
 *   - the browser posts only { key, choice } per question, the choice being
 *     the TEXT of the option picked, so shuffling questions or options in the
 *     browser can never make an index mean something else;
 *   - the server re-reads the questions from the source and scores
 *     (scoreSubmission); a key it does not recognise is refused, never guessed;
 *   - the limits (attempts, pass mark, final or not) are the server's.
 *
 * Pure: no I/O. The route does the reading and the recording.
 *
 * No em dashes in this file.
 */

export interface SourceQuestion {
  questionId?: unknown; q?: unknown; question?: unknown; questionText?: unknown;
  options?: unknown; correctIndex?: unknown; correctAnswer?: unknown; answer?: unknown;
  explanation?: unknown; hint?: unknown; rationale?: unknown; points?: unknown;
}

export interface PublicQuestion { key: string; q: string; options: string[]; points?: number }
export interface SubmittedAnswer { key: string; choice: string }

const norm = (s: unknown): string => (typeof s === 'string' ? s : s == null ? '' : String(s)).replace(/\s+/g, ' ').trim();

export function questionText(src: SourceQuestion): string {
  return norm(src.q) || norm(src.question) || norm(src.questionText);
}

/** The stable key of a question: its id when the source gives one, else its text. */
export function questionKey(src: SourceQuestion): string {
  const id = norm(src.questionId);
  return id ? `id:${id}` : `q:${questionText(src).toLowerCase()}`;
}

export function questionOptions(src: SourceQuestion): string[] {
  return Array.isArray(src.options) ? src.options.map((o) => norm(o)) : [];
}

/** The 0-based correct option, from whichever field the source used; -1 when absent. */
export function correctOptionIndex(src: SourceQuestion): number {
  const raw = src.correctIndex ?? src.correctAnswer ?? src.answer;
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
  return Number.isInteger(n) && n >= 0 && n < questionOptions(src).length ? n : -1;
}

export function explanationOf(src: SourceQuestion): string {
  return norm(src.explanation) || norm(src.hint) || norm(src.rationale);
}

/** What the browser may see of a question. Never the key, never the explanation. */
export function publicQuestion(src: SourceQuestion): PublicQuestion {
  const points = typeof src.points === 'number' ? src.points : undefined;
  return { key: questionKey(src), q: questionText(src), options: questionOptions(src), ...(points !== undefined ? { points } : {}) };
}

export interface QuestionOutcome {
  key: string;
  isCorrect: boolean;
  /** Revealed only after the final attempt is used. */
  correctText: string;
  explanation: string;
}

export interface ScoreResult {
  total: number;
  correctCount: number;
  score: number;             // percentage 0-100, rounded
  outcomes: QuestionOutcome[];
  unknownKeys: string[];     // submitted keys the source does not have: refuse, never guess
  unanswered: number;
}

export function scoreSubmission(source: SourceQuestion[], answers: SubmittedAnswer[]): ScoreResult {
  const byKey = new Map<string, SubmittedAnswer>();
  for (const a of answers) if (a && typeof a.key === 'string') byKey.set(a.key, a);
  const known = new Set(source.map(questionKey));
  const unknownKeys = [...byKey.keys()].filter((k) => !known.has(k));
  let correctCount = 0, unanswered = 0;
  const outcomes = source.map((q) => {
    const key = questionKey(q);
    const opts = questionOptions(q);
    const ci = correctOptionIndex(q);
    const picked = byKey.get(key);
    if (!picked || !norm(picked.choice)) unanswered++;
    const isCorrect = ci >= 0 && !!picked && norm(picked.choice) === opts[ci];
    if (isCorrect) correctCount++;
    return { key, isCorrect, correctText: ci >= 0 ? opts[ci] : '', explanation: explanationOf(q) };
  });
  const total = source.length;
  return { total, correctCount, score: total > 0 ? Math.round((correctCount / total) * 100) : 0, outcomes, unknownKeys, unanswered };
}

/**
 * The correct answers are shown ONLY once the final attempt is used (founder,
 * 2026-09-26): the student sees their score, pass or fail and which questions
 * were wrong on every attempt, and the answer key only when no attempt is left.
 */
export function revealAnswerKey(attemptsUsed: number, maxAttempts: number): boolean {
  return attemptsUsed >= maxAttempts;
}
