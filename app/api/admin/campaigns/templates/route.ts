/**
 * /api/admin/campaigns/templates - the reusable campaign template set.
 *
 *   GET    -> every template, newest first, plus the merge-field list so the
 *             editor documents itself from ONE definition.
 *   POST   -> create (used both by "New template" and by "save this edit as a
 *             new template" at send time).
 *   PATCH  -> update an existing template.
 *   DELETE -> remove one.
 *
 * Admin only. No em dashes in this file.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';
import { MERGE_FIELDS, DEFAULT_MEETING_LINK } from '@/src/shared/email/campaigns';

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return { error: 'Unauthorized', status: 401, adminId: null };
  if ((session.user as { role?: string }).role !== 'admin') return { error: 'Forbidden', status: 403, adminId: null };
  return { error: null, status: 200, adminId: session.user.id as string };
}

const UNAVAILABLE = 'Campaign templates are unavailable. Apply migration 225.';

export async function GET() {
  const { error, status } = await requireAdmin();
  if (error) return NextResponse.json({ error }, { status });

  const sb = getServerClient();
  const { data, error: dbErr } = await sb
    .from('admin_campaign_templates')
    .select('id, name, description, subject, body_html, is_seed, created_at, updated_at')
    .order('created_at', { ascending: false });
  if (dbErr) return NextResponse.json({ error: UNAVAILABLE, code: 'MIGRATION_PENDING', detail: dbErr.message }, { status: 503 });

  return NextResponse.json({ templates: data ?? [], mergeFields: MERGE_FIELDS, defaultMeetingLink: DEFAULT_MEETING_LINK });
}

export async function POST(req: NextRequest) {
  const { error, status, adminId } = await requireAdmin();
  if (error || !adminId) return NextResponse.json({ error }, { status });

  const body = await req.json().catch(() => ({})) as { name?: string; description?: string; subject?: string; bodyHtml?: string };
  const name = (body.name ?? '').trim();
  const subject = (body.subject ?? '').trim();
  const bodyHtml = (body.bodyHtml ?? '').trim();
  if (!name || !subject || !bodyHtml) {
    return NextResponse.json({ error: 'name, subject and bodyHtml are required' }, { status: 400 });
  }

  const sb = getServerClient();
  const { data, error: dbErr } = await sb
    .from('admin_campaign_templates')
    .insert({ name, description: (body.description ?? '').trim() || null, subject, body_html: bodyHtml, created_by: adminId })
    .select('id, name, description, subject, body_html, is_seed, created_at, updated_at')
    .single();
  if (dbErr) {
    const dup = /duplicate key|unique/i.test(dbErr.message);
    return NextResponse.json(
      { error: dup ? 'A template with that name already exists.' : dbErr.message },
      { status: dup ? 409 : 500 },
    );
  }
  return NextResponse.json({ template: data });
}

export async function PATCH(req: NextRequest) {
  const { error, status } = await requireAdmin();
  if (error) return NextResponse.json({ error }, { status });

  const body = await req.json().catch(() => ({})) as { id?: string; name?: string; description?: string; subject?: string; bodyHtml?: string };
  if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim();
  if (typeof body.description === 'string') patch.description = body.description.trim() || null;
  if (typeof body.subject === 'string' && body.subject.trim()) patch.subject = body.subject.trim();
  if (typeof body.bodyHtml === 'string' && body.bodyHtml.trim()) patch.body_html = body.bodyHtml.trim();

  const sb = getServerClient();
  const { data, error: dbErr } = await sb
    .from('admin_campaign_templates')
    .update(patch)
    .eq('id', body.id)
    .select('id, name, description, subject, body_html, is_seed, created_at, updated_at')
    .single();
  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 });
  return NextResponse.json({ template: data });
}

export async function DELETE(req: NextRequest) {
  const { error, status } = await requireAdmin();
  if (error) return NextResponse.json({ error }, { status });
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const sb = getServerClient();
  const { error: dbErr } = await sb.from('admin_campaign_templates').delete().eq('id', id);
  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
