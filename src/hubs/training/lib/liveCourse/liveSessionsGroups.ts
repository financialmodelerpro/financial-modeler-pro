/**
 * Live Sessions page (2026-11-10, founder): course sessions are grouped under
 * a heading with the course name and its session count ("Real Estate
 * Financial Modeling, 8 sessions"); single sessions keep their own list. Pure.
 */
export interface GroupableSession { id: string; course_code?: string | null; course_session_no?: number | null; scheduled_datetime?: string | null }

export function courseGroupHeading(title: string, sessionCount: number): string {
  return `${title}, ${sessionCount} session${sessionCount === 1 ? '' : 's'}`;
}

export function groupCourseSessions<T extends GroupableSession>(
  sessions: T[],
  courses: { courseCode: string; title: string; sessionCount: number }[],
): { courses: { courseCode: string; heading: string; sessions: T[] }[]; singles: T[] } {
  const singles: T[] = [];
  const byCode = new Map<string, T[]>();
  for (const s of sessions) {
    if (!s.course_code) { singles.push(s); continue; }
    const code = s.course_code.toUpperCase();
    byCode.set(code, [...(byCode.get(code) ?? []), s]);
  }
  const groups = [...byCode.entries()].map(([code, list]) => {
    const info = courses.find((c) => c.courseCode.toUpperCase() === code);
    return {
      courseCode: code,
      heading: courseGroupHeading(info?.title ?? code, info?.sessionCount ?? list.length),
      sessions: [...list].sort((a, b) => (a.course_session_no ?? 1e9) - (b.course_session_no ?? 1e9)),
    };
  });
  return { courses: groups, singles };
}
