/**
 * A live-course session's page content (2026-11-10, mig 253): eight bullet
 * lists, stored together in `live_sessions.content_sections` (jsonb). Pure.
 *
 *   overview        Overview
 *   learnConcepts   What you will learn: Concepts
 *   learnHandsOn    What you will learn: Hands-on in Excel
 *   flow            Session flow (numbered)
 *   build           What you will build
 *   claude          Build with Claude
 *   before          Before the session
 *   after           After the session
 *
 * `sessionSections` is THE reader: the session page, the editor, the page
 * metadata and the calendar file all call it. A session with no new content
 * falls back to the mig 251 fields (overview paragraph, learn list, outcome,
 * Claude), so a course that never filled the new lists renders as before.
 */

export const SECTION_KEYS = ['overview', 'learnConcepts', 'learnHandsOn', 'flow', 'build', 'claude', 'before', 'after'] as const;
export type SectionKey = typeof SECTION_KEYS[number];
export type SessionSections = Record<SectionKey, string[]>;

/** The editor's label for each list. */
export const SECTION_LABELS: Record<SectionKey, string> = {
  overview: 'Overview',
  learnConcepts: 'What you will learn: Concepts',
  learnHandsOn: 'What you will learn: Hands-on in Excel',
  flow: 'Session flow (numbered)',
  build: 'What you will build',
  claude: 'Build with Claude',
  before: 'Before the session',
  after: 'After the session',
};

export function emptySections(): SessionSections {
  return { overview: [], learnConcepts: [], learnHandsOn: [], flow: [], build: [], claude: [], before: [], after: [] };
}

/** One list item: trimmed, with a typed bullet or number marker removed. */
function cleanItem(raw: unknown): string {
  return String(raw ?? '').replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim();
}

/** One bullet per line (the editor's textarea). Blank lines and markers dropped. */
export function linesToList(text: string): string[] {
  return String(text ?? '').split(/\r?\n/).map(cleanItem).filter(Boolean);
}

export function listToLines(list: string[]): string {
  return (list ?? []).join('\n');
}

/** A stored or posted value as clean lists; anything unknown is dropped. */
export function normaliseSections(raw: unknown): SessionSections {
  const out = emptySections();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const r = raw as Record<string, unknown>;
  for (const k of SECTION_KEYS) {
    const v = r[k];
    out[k] = Array.isArray(v) ? v.map(cleanItem).filter(Boolean) : typeof v === 'string' ? linesToList(v) : [];
  }
  return out;
}

export function hasAnySection(s: SessionSections): boolean {
  return SECTION_KEYS.some((k) => s[k].length > 0);
}

export interface SessionContentRow {
  content_sections?: unknown;
  content_overview?: string | null;
  content_learn?: string[] | null;
  content_outcome?: string | null;
  content_claude?: string | null;
}

/**
 * THE content of a session. New lists win as a whole; with none, the mig 251
 * fields map in: the overview paragraph becomes one Overview item, the learn
 * list the Concepts group, the outcome What you will build, Claude its own.
 */
export function sessionSections(row: SessionContentRow): SessionSections {
  const stored = normaliseSections(row.content_sections);
  if (hasAnySection(stored)) return stored;
  const legacy = emptySections();
  const para = (v: string | null | undefined) => (v && v.trim() ? [v.trim().replace(/\s+/g, ' ')] : []);
  legacy.overview = para(row.content_overview);
  legacy.learnConcepts = (row.content_learn ?? []).map(cleanItem).filter(Boolean);
  legacy.build = para(row.content_outcome);
  legacy.claude = para(row.content_claude);
  return legacy;
}

/** A one-paragraph summary (page metadata, calendar description). */
export function overviewText(row: SessionContentRow): string {
  return sessionSections(row).overview.join('; ');
}

// ── The founder's content file (docs/<COURSE>_Live_Course_Materials/*_Session_Content.md) ──

const HEADING_TO_KEY: Record<string, SectionKey | 'learn'> = {
  'overview': 'overview',
  'what you will learn': 'learn',
  'session flow': 'flow',
  'what you will build': 'build',
  'build with claude': 'claude',
  'before the session': 'before',
  'after the session': 'after',
};

export interface ParsedSession { no: number; title: string; date: string | null; sections: SessionSections }

/**
 * Parse the content file: "## Session N: Title", then "### <Section>" headings
 * with "- " or "1. " items; under "What you will learn", the lines "Concepts"
 * and "Hands-on in Excel" switch the group. Pure.
 */
export function parseSessionContentMd(md: string): ParsedSession[] {
  const out: ParsedSession[] = [];
  let cur: ParsedSession | null = null;
  let key: SectionKey | null = null;
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trim();
    const sess = /^##\s+Session\s+(\d+)\s*:\s*(.+)$/i.exec(line);
    if (sess) {
      cur = { no: Number(sess[1]), title: sess[2].trim(), date: null, sections: emptySections() };
      out.push(cur);
      key = null;
      continue;
    }
    if (!cur) continue;
    const date = /^Date:\s*(.+)$/i.exec(line);
    if (date && !key) { cur.date = date[1].trim(); continue; }
    const h = /^###\s+(.+)$/.exec(line);
    if (h) {
      const k = HEADING_TO_KEY[h[1].trim().toLowerCase()];
      key = k === 'learn' ? 'learnConcepts' : k ?? null;
      continue;
    }
    if (key === 'learnConcepts' || key === 'learnHandsOn') {
      if (/^concepts$/i.test(line)) { key = 'learnConcepts'; continue; }
      if (/^hands-on in excel$/i.test(line)) { key = 'learnHandsOn'; continue; }
    }
    if (key && /^(?:[-*]|\d+[.)])\s+/.test(line)) cur.sections[key].push(cleanItem(line));
  }
  return out;
}
