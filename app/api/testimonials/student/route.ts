import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/lib/shared/supabase';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as Record<string, string | number | undefined>;
    const {
      registrationId, studentName, studentEmail,
      courseCode, courseName, type, content,
      rating, videoUrl, jobTitle, company, location, linkedinUrl,
    } = body;

    if (!registrationId || !studentEmail || !type) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }
    if (type === 'written') {
      const text = String(content ?? '').trim();
      if (text.length < 50) {
        return NextResponse.json({ error: 'Written testimonial must be at least 50 characters' }, { status: 400 });
      }
    }
    if (type === 'video' && !String(videoUrl ?? '').trim()) {
      return NextResponse.json({ error: 'Video URL is required' }, { status: 400 });
    }

    const sb = getServerClient();
    const cc = String(courseCode ?? '').trim().toLowerCase();

    // Prevent duplicate submissions per student per course
    const { data: existing } = await sb
      .from('student_testimonials')
      .select('id')
      .eq('registration_id', String(registrationId).trim())
      .eq('course_code', cc)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ error: 'already_submitted' }, { status: 409 });
    }

    await sb.from('student_testimonials').insert({
      registration_id:  String(registrationId).trim(),
      student_name:     String(studentName ?? '').trim(),
      student_email:    String(studentEmail).trim().toLowerCase(),
      course_code:      cc,
      course_name:      String(courseName ?? '').trim(),
      testimonial_type: String(type),
      written_content:  type === 'written' ? String(content ?? '').trim() : null,
      rating:           type === 'written' ? Math.min(5, Math.max(1, parseInt(String(rating ?? 5), 10) || 5)) : null,
      video_url:        type === 'video'   ? String(videoUrl ?? '').trim() : null,
      job_title:        String(jobTitle   ?? '').trim() || null,
      company:          String(company    ?? '').trim() || null,
      location:         String(location   ?? '').trim() || null,
      linkedin_url:     String(linkedinUrl ?? '').trim() || null,
    });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Failed to submit' }, { status: 500 });
  }
}
