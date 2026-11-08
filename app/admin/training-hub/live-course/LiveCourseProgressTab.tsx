'use client';

/** Per-student certification progress for a live course (filled in by the eligibility unit). */
export function LiveCourseProgressTab({ courseCode }: { courseCode: string }) {
  return <div style={{ color: '#5A6675', fontSize: 13 }}>Progress for {courseCode} appears here.</div>;
}
