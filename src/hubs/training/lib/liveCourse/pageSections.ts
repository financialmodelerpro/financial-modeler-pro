/**
 * The live course landing page: its sections, their order and their content.
 * ONE definition for the public page, the admin "Page sections" tab and the
 * verifier. Stored per course in training_course_settings.page_sections
 * (mig 252) and merged over DEFAULT_PAGE (resolvePage), so every future
 * course gets the same layout and a section added here appears with its
 * default. Pure.
 */

export const ICONS = [
  'layers', 'grid', 'banknote', 'hotel', 'trending-up', 'bot', 'building', 'briefcase', 'users', 'graduation-cap',
  'file-spreadsheet', 'video', 'monitor', 'award', 'check-circle', 'calendar', 'clock', 'target', 'shield-check', 'star',
] as const;
export type IconName = (typeof ICONS)[number];

export interface IconItem { icon: IconName; title: string; text: string }
export interface Step { title: string; text: string }
export interface FaqItem { q: string; a: string }

export interface PageSections {
  hero: { enabled: boolean; facts: string[]; countdown: boolean };
  sideCard: { enabled: boolean; enrolledThreshold: number };
  about: { enabled: boolean };
  curriculum: { enabled: boolean; heading: string };
  skills: { enabled: boolean; heading: string; items: IconItem[] };
  whoFor: { enabled: boolean; heading: string; items: IconItem[] };
  certification: { enabled: boolean; heading: string; steps: Step[]; showSamples: boolean };
  tools: { enabled: boolean; heading: string; items: IconItem[] };
  /** shortBio: the course's two to three line instructor bio (empty = first two sentences of the full bio). */
  instructor: { enabled: boolean; heading: string; shortBio: string };
  testimonials: { enabled: boolean; heading: string; ids: string[] };
  faq: { enabled: boolean; heading: string; items: FaqItem[] };
  cta: { enabled: boolean; text: string };
}

export type SectionKey = keyof PageSections;

/** Sections placed in the page body, in their default order (hero and side card are fixed in place). */
export const BODY_SECTIONS: SectionKey[] = ['about', 'curriculum', 'skills', 'whoFor', 'certification', 'tools', 'instructor', 'testimonials', 'faq', 'cta'];

export const SECTION_LABELS: Record<SectionKey, string> = {
  hero: 'Hero', sideCard: 'Side card and mobile Register bar', about: 'About (description, who it is for, prerequisites)',
  curriculum: 'Sessions table', skills: 'Skills you will gain', whoFor: 'Who it is for (cards)', certification: 'How certification works',
  tools: 'Tools you will use', instructor: 'Instructor', testimonials: 'Testimonials', faq: 'FAQ', cta: 'Final call to action',
};

export interface PageConfig { order: SectionKey[]; sections: PageSections }

export const DEFAULT_PAGE: PageConfig = {
  order: [...BODY_SECTIONS],
  sections: {
    hero: { enabled: true, facts: [], countdown: true },
    sideCard: { enabled: true, enrolledThreshold: 25 },
    about: { enabled: true },
    curriculum: { enabled: true, heading: 'Sessions' },
    skills: { enabled: false, heading: 'Skills you will gain', items: [] },
    whoFor: { enabled: false, heading: 'Who it is for', items: [] },
    certification: { enabled: true, heading: 'How certification works', steps: [], showSamples: true },
    tools: { enabled: false, heading: 'Tools you will use', items: [] },
    instructor: { enabled: true, heading: 'Your instructor', shortBio: '' },
    testimonials: { enabled: true, heading: 'What participants say', ids: [] },
    faq: { enabled: false, heading: 'Frequently asked questions', items: [] },
    cta: { enabled: true, text: '' },
  },
};

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, d: string) => (typeof v === 'string' ? v : d);
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
const iconOf = (v: unknown): IconName => ((ICONS as readonly string[]).includes(String(v)) ? (v as IconName) : 'check-circle');
const items = (v: unknown, d: IconItem[]): IconItem[] => (Array.isArray(v)
  ? v.filter(isObj).map((x) => ({ icon: iconOf(x.icon), title: str(x.title, ''), text: str(x.text, '') })).filter((x) => x.title)
  : d);

/** Stored JSON merged over the defaults; anything malformed falls back. */
export function resolvePage(stored: unknown): PageConfig {
  const s = isObj(stored) ? stored : {};
  const sec = isObj(s.sections) ? s.sections : {};
  const g = (k: SectionKey) => (isObj(sec[k]) ? (sec[k] as Record<string, unknown>) : {});
  const D = DEFAULT_PAGE.sections;
  const sections: PageSections = {
    hero: { enabled: bool(g('hero').enabled, D.hero.enabled), facts: Array.isArray(g('hero').facts) ? (g('hero').facts as unknown[]).map(String).filter(Boolean) : D.hero.facts, countdown: bool(g('hero').countdown, D.hero.countdown) },
    sideCard: { enabled: bool(g('sideCard').enabled, D.sideCard.enabled), enrolledThreshold: Number.isFinite(Number(g('sideCard').enrolledThreshold)) && g('sideCard').enrolledThreshold !== null ? Math.max(0, Math.round(Number(g('sideCard').enrolledThreshold))) : D.sideCard.enrolledThreshold },
    about: { enabled: bool(g('about').enabled, D.about.enabled) },
    curriculum: { enabled: bool(g('curriculum').enabled, D.curriculum.enabled), heading: str(g('curriculum').heading, D.curriculum.heading) },
    skills: { enabled: bool(g('skills').enabled, D.skills.enabled), heading: str(g('skills').heading, D.skills.heading), items: items(g('skills').items, D.skills.items) },
    whoFor: { enabled: bool(g('whoFor').enabled, D.whoFor.enabled), heading: str(g('whoFor').heading, D.whoFor.heading), items: items(g('whoFor').items, D.whoFor.items) },
    certification: {
      enabled: bool(g('certification').enabled, D.certification.enabled), heading: str(g('certification').heading, D.certification.heading),
      steps: Array.isArray(g('certification').steps) ? (g('certification').steps as unknown[]).filter(isObj).map((x) => ({ title: str(x.title, ''), text: str(x.text, '') })).filter((x) => x.title) : D.certification.steps,
      showSamples: bool(g('certification').showSamples, D.certification.showSamples),
    },
    tools: { enabled: bool(g('tools').enabled, D.tools.enabled), heading: str(g('tools').heading, D.tools.heading), items: items(g('tools').items, D.tools.items) },
    instructor: { enabled: bool(g('instructor').enabled, D.instructor.enabled), heading: str(g('instructor').heading, D.instructor.heading), shortBio: str(g('instructor').shortBio, D.instructor.shortBio) },
    testimonials: { enabled: bool(g('testimonials').enabled, D.testimonials.enabled), heading: str(g('testimonials').heading, D.testimonials.heading), ids: Array.isArray(g('testimonials').ids) ? (g('testimonials').ids as unknown[]).map(String) : D.testimonials.ids },
    faq: { enabled: bool(g('faq').enabled, D.faq.enabled), heading: str(g('faq').heading, D.faq.heading), items: Array.isArray(g('faq').items) ? (g('faq').items as unknown[]).filter(isObj).map((x) => ({ q: str(x.q, ''), a: str(x.a, '') })).filter((x) => x.q && x.a) : D.faq.items },
    cta: { enabled: bool(g('cta').enabled, D.cta.enabled), text: str(g('cta').text, D.cta.text) },
  };
  const order = Array.isArray(s.order) ? (s.order as unknown[]).map(String).filter((k): k is SectionKey => (BODY_SECTIONS as string[]).includes(k)) : [];
  const fullOrder = [...new Set([...order, ...BODY_SECTIONS])];
  return { order: fullOrder, sections };
}

/** Body sections to render, in order: switched on AND with something to show. */
export function visibleSections(p: PageConfig, has: { testimonials: number; sessions: number; instructors: number }): SectionKey[] {
  return p.order.filter((k) => {
    const s = p.sections[k] as { enabled: boolean };
    if (!s.enabled) return false;
    if (k === 'skills' || k === 'whoFor' || k === 'tools') return (p.sections[k] as { items: unknown[] }).items.length > 0;
    if (k === 'faq') return p.sections.faq.items.length > 0;
    if (k === 'certification') return p.sections.certification.steps.length > 0;
    if (k === 'testimonials') return has.testimonials > 0 && p.sections.testimonials.ids.length > 0;
    if (k === 'curriculum') return has.sessions > 0;
    if (k === 'instructor') return has.instructors > 0;
    return true;
  });
}

/** Show the enrolled count only once it reaches the admin's threshold. */
export function showEnrolledCount(count: number, threshold: number): boolean {
  return count >= Math.max(1, threshold);
}

/** "12 days 4 hours" until a start, or null once it has passed. Pure. */
export function countdownText(startIso: string | null | undefined, now: number = Date.now()): string | null {
  if (!startIso) return null;
  const ms = new Date(startIso).getTime() - now;
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const mins = Math.floor(ms / 60_000);
  const d = Math.floor(mins / 1440), h = Math.floor((mins % 1440) / 60), m = mins % 60;
  const part = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
  if (d > 0) return `${part(d, 'day')} ${part(h, 'hour')}`;
  if (h > 0) return `${part(h, 'hour')} ${part(m, 'minute')}`;
  return part(Math.max(1, m), 'minute');
}

/** The next session not yet started (the countdown's target). */
export function nextSession<T extends { scheduled_datetime: string | null }>(sessions: T[], now: number = Date.now()): T | null {
  return sessions.filter((s) => s.scheduled_datetime && new Date(s.scheduled_datetime).getTime() > now)
    .sort((a, b) => new Date(a.scheduled_datetime!).getTime() - new Date(b.scheduled_datetime!).getTime())[0] ?? null;
}

/**
 * THE course-length line (founder, 2026-11-13): "8 instructor-led sessions ·
 * 20 hours of structured learning", the hours summed from the live schedule.
 * When any session has no length the hours are left out rather than guessed.
 * The hero, the side card and the announcement all read this. Pure.
 */
export function courseLengthFact(sessions: { duration_minutes?: number | null; scheduled_datetime?: string | null }[]): string | null {
  if (!sessions.length) return null;
  const count = `${sessions.length} instructor-led session${sessions.length === 1 ? '' : 's'}`;
  const mins = sessions.map((s) => s.duration_minutes ?? 0);
  if (mins.some((m) => !(m > 0))) return count;
  return `${count} · ${hoursText(mins.reduce((a, b) => a + b, 0))} of structured learning`;
}

/** One session's length as the session card states it: "2.5 hours of structured learning". */
export function structuredLearningText(minutes: number | null | undefined): string | null {
  return minutes && minutes > 0 ? `${hoursText(minutes)} of structured learning` : null;
}

/** "20 hours", "2.5 hours", "1 hour", "45 minutes". */
function hoursText(min: number): string {
  if (min < 60) return `${min} minutes`;
  const h = Math.round((min / 60) * 100) / 100;
  return `${h} hour${h === 1 ? '' : 's'}`;
}

/** Shown beside every Register button on the course page. */
export const RECORDINGS_COUNT_LINE = "Can't attend live? Recordings count toward the certificate.";

/** Hero key facts from the live schedule (used when the admin sets none). */
export function autoFacts(sessions: { scheduled_datetime: string | null; duration_minutes?: number | null }[]): string[] {
  const dated = sessions.filter((s) => s.scheduled_datetime).map((s) => new Date(s.scheduled_datetime!)).sort((a, b) => a.getTime() - b.getTime());
  const facts: string[] = [];
  const length = courseLengthFact(sessions);
  if (length) facts.push(length);
  if (dated.length) {
    const days = new Set(dated.map((d) => d.toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'Asia/Riyadh' })));
    const time = dated[0].toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Riyadh' });
    if (days.size === 1) facts.push(`${[...days][0]}s ${time} KSA`);
    facts.push(`Starts ${dated[0].toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Riyadh' })}`);
  }
  facts.push('Free', 'Certificate');
  return facts;
}

const KSA = 'Asia/Riyadh';
// ICU puts a narrow no-break space before AM / PM; normalise it to a plain space.
const clock = (d: Date) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: KSA }).replace(/[  ]/g, ' ');

/** The side card's next line: "Next: Session 1, Tue 1 Dec 2026, 7:00 PM KSA". */
export function nextSessionLine(next: { no: number | null; startIso: string }): string {
  const d = new Date(next.startIso);
  const date = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: KSA }).replace(',', '');
  return `Next: ${next.no != null ? `Session ${next.no}, ` : ''}${date}, ${clock(d)} KSA`;
}

/** "2.5 hours", "2 hours", "90 minutes". */
function durationText(min: number): string {
  if (min % 30 !== 0 || min < 60) return `${min} minutes`;
  const h = min / 60;
  return `${Number.isInteger(h) ? h : h.toFixed(1)} hour${h === 1 ? '' : 's'}`;
}

/**
 * The side card's key facts from the live schedule, e.g. "8 instructor-led
 * sessions · 20 hours of structured learning",
 * "2.5 hours each", "Tuesdays 7:00 to 9:30 PM KSA", "Free", "Certificate". A
 * fact the schedule does not support (mixed lengths, days or times) is left out.
 */
export function scheduleFacts(sessions: { scheduled_datetime: string | null; duration_minutes?: number | null }[]): string[] {
  const facts: string[] = [];
  const length = courseLengthFact(sessions);
  if (length) facts.push(length);
  const mins = [...new Set(sessions.map((s) => s.duration_minutes ?? 0))];
  const dur = mins.length === 1 && mins[0] > 0 ? mins[0] : null;
  if (dur) facts.push(`${durationText(dur)} each`);
  const dated = sessions.filter((s) => s.scheduled_datetime).map((s) => new Date(s.scheduled_datetime!));
  if (dated.length) {
    const days = new Set(dated.map((d) => d.toLocaleDateString('en-GB', { weekday: 'long', timeZone: KSA })));
    const starts = new Set(dated.map(clock));
    if (days.size === 1 && starts.size === 1) {
      const start = clock(dated[0]);
      let when = start;
      if (dur) {
        const end = clock(new Date(dated[0].getTime() + dur * 60_000));
        const [sT, sM] = start.split(' '), [eT, eM] = end.split(' ');
        when = sM === eM ? `${sT} to ${eT} ${eM}` : `${start} to ${end}`;
      }
      facts.push(`${[...days][0]}s ${when} KSA`);
    }
  }
  facts.push('Free', 'Certificate');
  return facts;
}

/** Validate an admin save: the same merge, so what is stored is what renders. */
export function pageFromBody(body: unknown): { ok: boolean; page: PageConfig; errors: string[] } {
  const page = resolvePage(body);
  const errors: string[] = [];
  if (page.sections.faq.items.length > 50) errors.push('At most 50 FAQ items.');
  if (JSON.stringify(page).length > 100_000) errors.push('The page content is too long.');
  return { ok: errors.length === 0, page, errors };
}
