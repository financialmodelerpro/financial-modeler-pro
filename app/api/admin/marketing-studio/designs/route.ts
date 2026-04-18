import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/shared/auth';
import { getServerClient } from '@/src/lib/shared/supabase';

export const runtime = 'nodejs';

/** GET /api/admin/marketing-studio/designs — list saved designs (newest first) */
export async function GET() {
  const session = await getServerSession(authOptions);
  if ((session?.user as { role?: string } | undefined)?.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sb = getServerClient();
  const { data, error } = await sb
    .from('marketing_designs')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(200);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ designs: data ?? [] });
}

interface CreateBody {
  name?: string;
  template_type?: string;
  dimensions?: { width: number; height: number };
  background?: Record<string, unknown>;
  elements?: unknown[];
  ai_captions?: Record<string, string>;
}

/** POST /api/admin/marketing-studio/designs — create new design (canvas-based) */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const user = session?.user as { role?: string; email?: string; name?: string } | undefined;
  if (user?.role !== 'admin') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: CreateBody;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  if (!body.template_type) return NextResponse.json({ error: 'template_type required' }, { status: 400 });

  const sb = getServerClient();
  const { data, error } = await sb
    .from('marketing_designs')
    .insert({
      name: body.name || 'Untitled Design',
      template_type: body.template_type,
      dimensions: body.dimensions ?? { width: 1280, height: 720 },
      background: body.background ?? { type: 'color', color: '#1B4F72' },
      elements: body.elements ?? [],
      ai_captions: body.ai_captions ?? {},
      created_by: user.email || user.name || null,
    })
    .select('*')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ design: data });
}
