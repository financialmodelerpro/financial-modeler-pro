/**
 * The testimonials an admin picked for a course page, from the EXISTING
 * testimonials system (both tables: `testimonials` and `student_testimonials`),
 * approved only, in the admin's order, mapped to the shared `Testimonial` shape
 * so the existing carousel renders them. A pick is "source:id".
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Testimonial } from '@/src/shared/cms';

export function parsePick(p: string): { source: 'manual' | 'student'; id: string } | null {
  const m = /^(manual|student):([0-9a-f-]{36})$/i.exec(p.trim());
  return m ? { source: m[1].toLowerCase() as 'manual' | 'student', id: m[2] } : null;
}

export async function loadPickedTestimonials(sb: SupabaseClient, picks: string[]): Promise<Testimonial[]> {
  const parsed = picks.map(parsePick).filter((x): x is { source: 'manual' | 'student'; id: string } => !!x);
  if (!parsed.length) return [];
  const manualIds = parsed.filter((p) => p.source === 'manual').map((p) => p.id);
  const studentIds = parsed.filter((p) => p.source === 'student').map((p) => p.id);
  const [m, st] = await Promise.all([
    manualIds.length ? sb.from('testimonials').select('id, name, role, company, text, rating, created_at, linkedin_url, video_url').in('id', manualIds).eq('status', 'approved') : Promise.resolve({ data: [] }),
    studentIds.length ? sb.from('student_testimonials').select('id, student_name, job_title, company, written_content, rating, created_at, testimonial_type, location, linkedin_url, video_url, course_name, is_featured').in('id', studentIds).eq('status', 'approved') : Promise.resolve({ data: [] }),
  ]);
  const byKey = new Map<string, Testimonial>();
  for (const r of (m.data ?? []) as Record<string, unknown>[]) {
    byKey.set(`manual:${r.id}`, {
      id: String(r.id), name: String(r.name ?? ''), role: String(r.role ?? ''), company: String(r.company ?? ''),
      text: String(r.text ?? ''), rating: Number(r.rating ?? 5), created_at: String(r.created_at ?? ''), source: 'manual',
      linkedin_url: (r.linkedin_url as string | null) ?? undefined, video_url: (r.video_url as string | null) ?? undefined,
    } as Testimonial);
  }
  for (const r of (st.data ?? []) as Record<string, unknown>[]) {
    byKey.set(`student:${r.id}`, {
      id: String(r.id), name: String(r.student_name ?? ''), role: String(r.job_title ?? ''), company: String(r.company ?? ''),
      text: String(r.written_content ?? ''), rating: Number(r.rating ?? 5), created_at: String(r.created_at ?? ''), source: 'student',
      testimonial_type: (r.testimonial_type as string) ?? undefined, location: (r.location as string | null) ?? undefined,
      linkedin_url: (r.linkedin_url as string | null) ?? undefined, video_url: (r.video_url as string | null) ?? undefined,
      course_name: (r.course_name as string | null) ?? undefined, is_featured: r.is_featured === true,
    } as Testimonial);
  }
  return parsed.map((p) => byKey.get(`${p.source}:${p.id}`)).filter((t): t is Testimonial => !!t);
}
