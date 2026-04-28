import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Please log in to submit a testimonial.' }, { status: 401 });
    }

    const body = await req.json() as {
      name: string;
      role?: string;
      company?: string;
      linkedin_url?: string;
      rating?: number;
      testimonial_type: 'written' | 'video';
      text?: string;
      video_url?: string;
    };

    const { name, testimonial_type } = body;

    if (!name?.trim() || !testimonial_type) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    if (testimonial_type === 'written' && !body.text?.trim()) {
      return NextResponse.json({ error: 'Testimonial text is required' }, { status: 400 });
    }
    if (testimonial_type === 'video' && !body.video_url?.trim()) {
      return NextResponse.json({ error: 'Video URL is required' }, { status: 400 });
    }

    const sb = getServerClient();

    const { error } = await sb.from('testimonials').insert({
      name:             name.trim(),
      role:             body.role?.trim() ?? null,
      company:          body.company?.trim() ?? null,
      linkedin_url:     body.linkedin_url?.trim() ?? null,
      rating:           body.rating ?? null,
      text:             body.text?.trim() ?? null,
      video_url:        body.video_url?.trim() ?? null,
      testimonial_type,
      hub:              'modeling',
      status:           'pending',
      show_on_landing:  false,
    });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
