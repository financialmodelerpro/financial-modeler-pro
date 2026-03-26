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
  { id: 'S1',  title: 'Session 1: Introduction & Framework Overview',             youtubeUrl: 'https://youtu.be/JiitBxI1DD0', quizFormUrl: '', questionCount: 10, passingScore: 70, maxAttempts: 3, isFinal: false },
  { id: 'S2',  title: 'Session 2: Project Overview & Timeline',                   youtubeUrl: '', quizFormUrl: '', questionCount: 10, passingScore: 70, maxAttempts: 3, isFinal: false },
  { id: 'S3',  title: 'Session 3: Capex & Funding Requirement',                   youtubeUrl: '', quizFormUrl: '', questionCount: 10, passingScore: 70, maxAttempts: 3, isFinal: false },
  { id: 'S4',  title: 'Session 4: Plant Capacity & Production Plan',              youtubeUrl: '', quizFormUrl: '', questionCount: 10, passingScore: 70, maxAttempts: 3, isFinal: false },
  { id: 'S5',  title: 'Session 5: Revenue & Inventory Modeling',                  youtubeUrl: '', quizFormUrl: '', questionCount: 10, passingScore: 70, maxAttempts: 3, isFinal: false },
  { id: 'S6',  title: 'Session 6: COGS & Raw Material Cost Modeling',             youtubeUrl: '', quizFormUrl: '', questionCount: 10, passingScore: 70, maxAttempts: 3, isFinal: false },
  { id: 'S7',  title: 'Session 7: Other Direct Costs',                            youtubeUrl: '', quizFormUrl: '', questionCount: 10, passingScore: 70, maxAttempts: 3, isFinal: false },
  { id: 'S8',  title: 'Session 8: General & Admin Expenses',                      youtubeUrl: '', quizFormUrl: '', questionCount: 10, passingScore: 70, maxAttempts: 3, isFinal: false },
  { id: 'S9',  title: 'Session 9: Salaries & Payroll Modeling',                   youtubeUrl: '', quizFormUrl: '', questionCount: 10, passingScore: 70, maxAttempts: 3, isFinal: false },
  { id: 'S10', title: 'Session 10: Product Wise Cost Allocation',                 youtubeUrl: '', quizFormUrl: '', questionCount: 10, passingScore: 70, maxAttempts: 3, isFinal: false },
  { id: 'S11', title: 'Session 11: Staff Overtime Calculation',                   youtubeUrl: '', quizFormUrl: '', questionCount: 10, passingScore: 70, maxAttempts: 3, isFinal: false },
  { id: 'S12', title: 'Session 12: PPE Linkage & Working Capital',                youtubeUrl: '', quizFormUrl: '', questionCount: 10, passingScore: 70, maxAttempts: 3, isFinal: false },
  { id: 'S13', title: 'Session 13: Zakat & Tax Modeling',                         youtubeUrl: '', quizFormUrl: '', questionCount: 10, passingScore: 70, maxAttempts: 3, isFinal: false },
  { id: 'S14', title: 'Session 14: Debt Schedule & Finance Cost',                 youtubeUrl: '', quizFormUrl: '', questionCount: 10, passingScore: 70, maxAttempts: 3, isFinal: false },
  { id: 'S15', title: 'Session 15: Pre-Operating Costs Amortization',             youtubeUrl: '', quizFormUrl: '', questionCount: 10, passingScore: 70, maxAttempts: 3, isFinal: false },
  { id: 'S16', title: 'Session 16: Equity & Balancing the Balance Sheet',         youtubeUrl: '', quizFormUrl: '', questionCount: 10, passingScore: 70, maxAttempts: 3, isFinal: false },
  { id: 'S17', title: 'Session 17: Cash Flow Statement & Valuation',              youtubeUrl: '', quizFormUrl: '', questionCount: 10, passingScore: 70, maxAttempts: 3, isFinal: false },
  { id: 'S18', title: 'Session 18: 3SFM Final Certification Exam',                youtubeUrl: '', quizFormUrl: '', questionCount: 50, passingScore: 70, maxAttempts: 1, isFinal: true  },
];

// ── BVM — Business Valuation Modeling ────────────────────────────────────────

const BVM_SESSIONS: Session[] = [
  { id: 'L1', title: 'Lesson 1: DCF Valuation Overview & Framework',              youtubeUrl: 'https://youtu.be/lRdrLAHqPto', quizFormUrl: '', questionCount: 10, passingScore: 70, maxAttempts: 3, isFinal: false },
  { id: 'L2', title: 'Lesson 2: DCF Valuation Model in Excel — FCFF and FCFE',   youtubeUrl: '', quizFormUrl: '', questionCount: 10, passingScore: 70, maxAttempts: 3, isFinal: false },
  { id: 'L3', title: 'Lesson 3: Rolling WACC Explained — FCFF vs FCFE Reconciliation', youtubeUrl: '', quizFormUrl: '', questionCount: 10, passingScore: 70, maxAttempts: 3, isFinal: false },
  { id: 'L4', title: 'Lesson 4: Comps Valuation Overview & Framework',            youtubeUrl: '', quizFormUrl: '', questionCount: 10, passingScore: 70, maxAttempts: 3, isFinal: false },
  { id: 'L5', title: 'Lesson 5: Comps Valuation Model in Excel — Comps Multiples', youtubeUrl: '', quizFormUrl: '', questionCount: 10, passingScore: 70, maxAttempts: 3, isFinal: false },
  { id: 'L6', title: 'Lesson 6: Final Business Valuation — Football Field Chart', youtubeUrl: '', quizFormUrl: '', questionCount: 10, passingScore: 70, maxAttempts: 3, isFinal: false },
  { id: 'L7', title: 'Lesson 7: BVM Final Certification Exam',                    youtubeUrl: '', quizFormUrl: '', questionCount: 30, passingScore: 70, maxAttempts: 1, isFinal: true  },
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
