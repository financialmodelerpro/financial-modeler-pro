/**
 * courses.ts — Static course/session configuration
 * This is the single source of truth for course structure.
 * YouTube URLs and quiz form URLs are filled in as content is ready.
 */

export interface Session {
  id: string;              // e.g. "S1", "S18", "L1", "L5"
  title: string;
  youtubeUrl: string;
  quizFormUrl: string;
  questionCount: number;
  passingScore: number;    // percentage, e.g. 70
  maxAttempts: number;
  isFinal: boolean;
}

export interface CourseConfig {
  id: string;
  title: string;
  shortTitle: string;
  description: string;
  sessions: Session[];
}

// ── 3SFM — 3-Statement Financial Modeling ────────────────────────────────────

const SFM_SESSIONS: Session[] = [
  { id: 'S1',  title: 'Session 1 — Introduction to Financial Modeling',           youtubeUrl: 'https://youtu.be/JiitBxI1DD0', quizFormUrl: '', questionCount: 10, passingScore: 70, maxAttempts: 3, isFinal: false },
  { id: 'S2',  title: 'Session 2 — Excel Best Practices',                         youtubeUrl: '', quizFormUrl: '', questionCount: 10, passingScore: 70, maxAttempts: 3, isFinal: false },
  { id: 'S3',  title: 'Session 3 — Income Statement Fundamentals',                youtubeUrl: '', quizFormUrl: '', questionCount: 10, passingScore: 70, maxAttempts: 3, isFinal: false },
  { id: 'S4',  title: 'Session 4 — Balance Sheet Fundamentals',                   youtubeUrl: '', quizFormUrl: '', questionCount: 10, passingScore: 70, maxAttempts: 3, isFinal: false },
  { id: 'S5',  title: 'Session 5 — Cash Flow Statement',                          youtubeUrl: '', quizFormUrl: '', questionCount: 10, passingScore: 70, maxAttempts: 3, isFinal: false },
  { id: 'S6',  title: 'Session 6 — Linking the Three Statements',                 youtubeUrl: '', quizFormUrl: '', questionCount: 10, passingScore: 70, maxAttempts: 3, isFinal: false },
  { id: 'S7',  title: 'Session 7 — Revenue Modeling',                             youtubeUrl: '', quizFormUrl: '', questionCount: 10, passingScore: 70, maxAttempts: 3, isFinal: false },
  { id: 'S8',  title: 'Session 8 — Cost Structure & COGS',                        youtubeUrl: '', quizFormUrl: '', questionCount: 10, passingScore: 70, maxAttempts: 3, isFinal: false },
  { id: 'S9',  title: 'Session 9 — Operating Expenses & EBITDA',                  youtubeUrl: '', quizFormUrl: '', questionCount: 10, passingScore: 70, maxAttempts: 3, isFinal: false },
  { id: 'S10', title: 'Session 10 — Debt Schedules & Interest',                   youtubeUrl: '', quizFormUrl: '', questionCount: 10, passingScore: 70, maxAttempts: 3, isFinal: false },
  { id: 'S11', title: 'Session 11 — Working Capital Modeling',                    youtubeUrl: '', quizFormUrl: '', questionCount: 10, passingScore: 70, maxAttempts: 3, isFinal: false },
  { id: 'S12', title: 'Session 12 — Capital Expenditure & Depreciation',          youtubeUrl: '', quizFormUrl: '', questionCount: 10, passingScore: 70, maxAttempts: 3, isFinal: false },
  { id: 'S13', title: 'Session 13 — Equity Schedule & Retained Earnings',         youtubeUrl: '', quizFormUrl: '', questionCount: 10, passingScore: 70, maxAttempts: 3, isFinal: false },
  { id: 'S14', title: 'Session 14 — Scenario & Sensitivity Analysis',             youtubeUrl: '', quizFormUrl: '', questionCount: 10, passingScore: 70, maxAttempts: 3, isFinal: false },
  { id: 'S15', title: 'Session 15 — Valuation Basics & DCF',                      youtubeUrl: '', quizFormUrl: '', questionCount: 10, passingScore: 70, maxAttempts: 3, isFinal: false },
  { id: 'S16', title: 'Session 16 — Model Audit & Error Checking',                youtubeUrl: '', quizFormUrl: '', questionCount: 10, passingScore: 70, maxAttempts: 3, isFinal: false },
  { id: 'S17', title: 'Session 17 — Presentation & Storytelling with Models',     youtubeUrl: '', quizFormUrl: '', questionCount: 10, passingScore: 70, maxAttempts: 3, isFinal: false },
  { id: 'S18', title: 'Session 18 — Conclusion & Final Exam',                     youtubeUrl: '', quizFormUrl: '', questionCount: 50, passingScore: 70, maxAttempts: 1, isFinal: true  },
];

// ── BVM — Business Valuation Modeling ────────────────────────────────────────

const BVM_SESSIONS: Session[] = [
  { id: 'L1', title: 'Lesson 1 — Introduction to Business Valuation',             youtubeUrl: 'https://youtu.be/lRdrLAHqPto', quizFormUrl: '', questionCount: 10, passingScore: 70, maxAttempts: 3, isFinal: false },
  { id: 'L2', title: 'Lesson 2 — Comparable Company Analysis',                    youtubeUrl: '', quizFormUrl: '', questionCount: 10, passingScore: 70, maxAttempts: 3, isFinal: false },
  { id: 'L3', title: 'Lesson 3 — Precedent Transaction Analysis',                 youtubeUrl: '', quizFormUrl: '', questionCount: 10, passingScore: 70, maxAttempts: 3, isFinal: false },
  { id: 'L4', title: 'Lesson 4 — DCF Valuation in Practice',                      youtubeUrl: '', quizFormUrl: '', questionCount: 10, passingScore: 70, maxAttempts: 3, isFinal: false },
  { id: 'L5', title: 'Lesson 5 — LBO & Leveraged Buyout Modeling',                youtubeUrl: '', quizFormUrl: '', questionCount: 10, passingScore: 70, maxAttempts: 3, isFinal: false },
  { id: 'L6', title: 'Lesson 6 — Conclusion & Final Exam',                        youtubeUrl: '', quizFormUrl: '', questionCount: 30, passingScore: 70, maxAttempts: 1, isFinal: true  },
];

// ── Exported config ───────────────────────────────────────────────────────────

export const COURSES: Record<string, CourseConfig> = {
  '3sfm': {
    id: '3sfm',
    title: '3-Statement Financial Modeling',
    shortTitle: '3SFM',
    description: 'Master the complete 3-statement financial model from scratch — Income Statement, Balance Sheet, and Cash Flow Statement — with professional Excel techniques.',
    sessions: SFM_SESSIONS,
  },
  'bvm': {
    id: 'bvm',
    title: 'Business Valuation Modeling',
    shortTitle: 'BVM',
    description: 'Learn professional business valuation methods including DCF, comparable company analysis, and precedent transactions.',
    sessions: BVM_SESSIONS,
  },
};

/**
 * Builds a pre-filled Google Form URL.
 * @param googleFormUrl  Base Google Form URL (empty string = quiz not yet configured)
 * @param entryId        Google Form entry field ID for the registration ID field
 * @param registrationId Student registration ID to pre-fill
 */
export function buildFormUrl(googleFormUrl: string, entryId: string, registrationId: string): string {
  if (!googleFormUrl) return '';
  const url = new URL(googleFormUrl);
  url.searchParams.set(entryId, registrationId);
  return url.toString();
}
