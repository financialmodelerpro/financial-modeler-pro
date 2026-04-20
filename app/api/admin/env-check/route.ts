import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/shared/auth';

interface EnvCheck {
  key:        string;
  label:      string;
  required:   boolean;
  present:    boolean;
  /** Populated when the primary key is missing but a fallback satisfied
   *  the runtime requirement. Shown in the UI so admins don't think the
   *  system is broken when it isn't. */
  note?:      string;
}

/**
 * `SUPABASE_URL` satisfied by either key — mirror `src/lib/shared/
 * supabase.ts:getServerClient`, which falls back to the public URL when
 * the server-only var isn't set. If the fallback is in play, `SUPABASE_URL`
 * gets a note instead of a scary "MISSING" label.
 */
interface EnvSpec {
  key:        string;
  label:      string;
  required:   boolean;
  /** Additional env-var names that also satisfy this requirement. */
  fallbacks?: string[];
}

const ENV_VARS: EnvSpec[] = [
  { key: 'NEXT_PUBLIC_SUPABASE_URL',      label: 'Supabase URL (public)',      required: true  },
  { key: 'NEXT_PUBLIC_SUPABASE_ANON_KEY', label: 'Supabase Anon Key (public)', required: true  },
  { key: 'SUPABASE_URL',                  label: 'Supabase URL (server)',      required: true, fallbacks: ['NEXT_PUBLIC_SUPABASE_URL'] },
  { key: 'SUPABASE_SERVICE_ROLE_KEY',     label: 'Service Role Key',           required: true  },
  { key: 'NEXTAUTH_SECRET',               label: 'NextAuth Secret',            required: true  },
  { key: 'NEXTAUTH_URL',                  label: 'NextAuth URL',               required: true  },
  { key: 'ANTHROPIC_API_KEY',             label: 'Anthropic API Key',          required: false },
  { key: 'NEXT_PUBLIC_APP_URL',           label: 'Public App URL',             required: false },
  { key: 'NEXT_PUBLIC_LEARN_URL',         label: 'Public Learn URL',           required: false },
  { key: 'NEXT_PUBLIC_MAIN_URL',          label: 'Public Main URL',            required: false },
  { key: 'RESEND_API_KEY',                label: 'Resend API Key',             required: false },
  { key: 'CRON_SECRET',                   label: 'Cron Secret',                required: false },
];

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  }

  const checks: EnvCheck[] = ENV_VARS.map((v) => {
    const primarySet = !!process.env[v.key];
    if (primarySet) {
      return { key: v.key, label: v.label, required: v.required, present: true };
    }
    // Primary missing — check fallbacks. If any fallback is set, the
    // runtime requirement is satisfied; surface a note so the admin
    // knows the server client is reading the fallback.
    const matchedFallback = v.fallbacks?.find((f) => !!process.env[f]);
    if (matchedFallback) {
      return {
        key:      v.key,
        label:    v.label,
        required: v.required,
        present:  true,
        note:     `using fallback: ${matchedFallback}`,
      };
    }
    return { key: v.key, label: v.label, required: v.required, present: false };
  });

  return NextResponse.json({ checks });
}
