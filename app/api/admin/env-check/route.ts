import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/shared/auth';

interface EnvCheck {
  key:      string;
  label:    string;
  required: boolean;
  present:  boolean;
}

const ENV_VARS: Omit<EnvCheck, 'present'>[] = [
  { key: 'NEXT_PUBLIC_SUPABASE_URL',      label: 'Supabase URL (public)',    required: true  },
  { key: 'NEXT_PUBLIC_SUPABASE_ANON_KEY', label: 'Supabase Anon Key (public)', required: true },
  { key: 'SUPABASE_URL',                  label: 'Supabase URL (server)',    required: true  },
  { key: 'SUPABASE_SERVICE_ROLE_KEY',     label: 'Service Role Key',         required: true  },
  { key: 'NEXTAUTH_SECRET',               label: 'NextAuth Secret',          required: true  },
  { key: 'NEXTAUTH_URL',                  label: 'NextAuth URL',             required: true  },
  { key: 'ANTHROPIC_API_KEY',             label: 'Anthropic API Key',        required: false },
  { key: 'NEXT_PUBLIC_APP_URL',           label: 'Public App URL',           required: false },
];

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  }

  const checks: EnvCheck[] = ENV_VARS.map((v) => ({
    ...v,
    present: !!process.env[v.key],
  }));

  return NextResponse.json({ checks });
}
