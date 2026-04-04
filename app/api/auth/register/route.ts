import { NextRequest, NextResponse } from 'next/server';
import { serverClient } from '@/src/lib/shared/supabase';
import { hashPassword } from '@/src/lib/shared/password';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.email || !body?.password) {
    return NextResponse.json({ error: 'email and password are required' }, { status: 400 });
  }

  const email = (body.email as string).toLowerCase().trim();

  // Check duplicate
  const { data: existing } = await serverClient
    .from('users')
    .select('id')
    .eq('email', email)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ error: 'An account with that email already exists' }, { status: 409 });
  }

  const password_hash = await hashPassword(body.password as string);

  const { data: user, error } = await serverClient
    .from('users')
    .insert({
      email,
      name:          body.name ?? null,
      password_hash,
      role:                'user',
      subscription_plan:   'free',
      subscription_status: 'trial',
      projects_limit:      3,
    })
    .select('id, email, name, role, subscription_plan, subscription_status')
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ user }, { status: 201 });
}
