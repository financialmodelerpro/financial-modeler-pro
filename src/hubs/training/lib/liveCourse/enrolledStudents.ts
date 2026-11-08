/**
 * Every student enrolled in a live course, with their email and name.
 * Paged explicitly: PostgREST returns at most 1000 rows silently (TRAPS 2.1).
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export interface EnrolledStudent { registrationId: string; email: string; name: string }

const PAGE = 1000;

export async function listEnrolledStudents(sb: SupabaseClient, courseCode: string): Promise<EnrolledStudent[]> {
  const regIds: string[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from('training_enrollments')
      .select('registration_id')
      .eq('course_code', courseCode)
      .order('registration_id')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`enrolments read failed: ${error.message}`);
    for (const r of data ?? []) regIds.push(r.registration_id as string);
    if (!data || data.length < PAGE) break;
  }
  const out: EnrolledStudent[] = [];
  for (let i = 0; i < regIds.length; i += 200) {
    const slice = regIds.slice(i, i + 200);
    const { data, error } = await sb
      .from('training_registrations_meta')
      .select('registration_id, email, name')
      .in('registration_id', slice);
    if (error) throw new Error(`student read failed: ${error.message}`);
    for (const m of data ?? []) {
      if (m.email) out.push({ registrationId: m.registration_id as string, email: String(m.email).toLowerCase(), name: (m.name as string | null) ?? '' });
    }
  }
  return out;
}
