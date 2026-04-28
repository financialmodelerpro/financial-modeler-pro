import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/core/db/supabase';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      registration_id: string;
      email: string;
      student_name: string;
      job_title?: string;
      company?: string;
      location?: string;
      rating?: number;
      testimonial_type: 'written' | 'video';
      written_content?: string;
      video_url?: string;
      linkedin_url?: string;
      course_name?: string;
    };

    const { registration_id, email, student_name, testimonial_type } = body;

    if (!registration_id || !email || !student_name || !testimonial_type) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    if (testimonial_type === 'written' && !body.written_content?.trim()) {
      return NextResponse.json({ error: 'Written content is required' }, { status: 400 });
    }
    if (testimonial_type === 'video' && !body.video_url?.trim()) {
      return NextResponse.json({ error: 'Video URL is required' }, { status: 400 });
    }

    const sb = getServerClient();

    // Prevent duplicate submissions from same registration_id for same course
    const { data: existing } = await sb
      .from('student_testimonials')
      .select('id')
      .eq('registration_id', registration_id)
      .eq('course_name', body.course_name ?? '')
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ error: 'You have already submitted a testimonial for this course.' }, { status: 409 });
    }

    const { error } = await sb.from('student_testimonials').insert({
      registration_id,
      student_name:    student_name.trim(),
      job_title:       body.job_title?.trim() ?? null,
      company:         body.company?.trim() ?? null,
      location:        body.location?.trim() ?? null,
      rating:          body.rating ?? null,
      testimonial_type,
      written_content: body.written_content?.trim() ?? null,
      video_url:       body.video_url?.trim() ?? null,
      linkedin_url:    body.linkedin_url?.trim() ?? null,
      course_name:     body.course_name?.trim() ?? null,
      hub:             'training',
      status:          'pending',
      show_on_landing: false,
      is_featured:     false,
    });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
