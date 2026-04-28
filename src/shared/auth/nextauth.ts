import type { AuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { cookies } from 'next/headers';
import { serverClient } from '@/src/core/db/supabase';
import { verifyPassword } from '@/src/shared/auth/password';
import { isDeviceTrusted, DEVICE_COOKIE_NAME } from '@/src/shared/auth/deviceTrust';
import { getModelingSigninComingSoonState } from '@/src/hubs/modeling/lib/comingSoon';
import { isEmailWhitelisted } from '@/src/hubs/modeling/lib/access';

export const authOptions: AuthOptions = {
  session: { strategy: 'jwt', maxAge: 60 * 60 }, // 1 hour
  pages: {
    // Single-page admin auth (FIX 1, 2026-04-23). NextAuth used to
    // bounce unauthed /admin/* hits to /admin/login (a separate
    // welcome page); now /admin itself renders the credential form
    // and admins land directly on the dashboard once authed.
    signIn: '/admin',
    error:  '/admin',
  },
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        email:    { label: 'Email',    type: 'email'    },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const { data: user, error } = await serverClient
          .from('users')
          .select('id, email, name, role, password_hash, subscription_plan, subscription_status, email_confirmed')
          .eq('email', credentials.email.toLowerCase().trim())
          .single();

        if (error || !user) return null;
        if (!user.password_hash) return null;

        const valid = await verifyPassword(credentials.password, user.password_hash);
        if (!valid) return null;

        // Pre-launch gate (migration 136): sign-in is blocked while the
        // Modeling Hub signin toggle is on. Admins always bypass; the
        // modeling_access_whitelist gives individually-invited emails a
        // bypass too. The thrown `ComingSoon` error is surfaced to the
        // signin UI; the signin page itself is also server-gated so this
        // only matters for anyone calling /api/auth/callback/credentials
        // directly.
        if (user.role !== 'admin') {
          const cs = await getModelingSigninComingSoonState();
          if (cs.enabled) {
            const whitelisted = await isEmailWhitelisted(user.email);
            if (!whitelisted) {
              throw new Error('ComingSoon');
            }
          }
        }

        // Email confirmation gate. Admin accounts are pre-confirmed in
        // the DB so the gate just hard-fails for any unconfirmed
        // non-admin trying to sign in.
        if (user.role !== 'admin' && !user.email_confirmed) {
          throw new Error('EmailNotConfirmed');
        }

        // Device trust gate. Applies to ALL roles including admins
        // (FIX 2, 2026-04-23). Previously the admin role bypassed
        // this entirely, which left Ahmad locked out during the
        // launch - he hit /admin from a new device and there was no
        // OTP path to recover. Now admins go through the same OTP +
        // 30-day-trust flow as students; the trust cookie is keyed on
        // the user's email so it works across all hubs the
        // device-verify route writes to.
        const cookieStore = await cookies();
        const deviceToken = cookieStore.get(DEVICE_COOKIE_NAME)?.value ?? null;

        const trusted = deviceToken
          ? await isDeviceTrusted(deviceToken, user.email, 'modeling')
          : false;

        if (!trusted) {
          throw new Error('DEVICE_VERIFICATION_REQUIRED');
        }

        return {
          id:                  user.id,
          email:               user.email,
          name:                user.name ?? null,
          role:                user.role,
          subscription_plan:   user.subscription_plan,
          subscription_status: user.subscription_status,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id                  = user.id;
        token.role                = user.role;
        token.subscription_plan   = user.subscription_plan;
        token.subscription_status = user.subscription_status;
      }
      return token;
    },
    async session({ session, token }) {
      session.user.id                  = token.id;
      session.user.role                = token.role;
      session.user.subscription_plan   = token.subscription_plan;
      session.user.subscription_status = token.subscription_status;
      return session;
    },
    /**
     * Post-signin destination. NextAuth invokes this when it needs to
     * redirect after a successful signin or when it constructs its own
     * fallback URLs. Hard-coded to /admin/dashboard (successful signin)
     * for admins; anything that resolves to an auth-cycle path or an
     * off-origin URL collapses to /admin instead. Eliminates every
     * callbackUrl loop vector at the framework layer.
     */
    async redirect({ url, baseUrl }) {
      // Off-origin URL → force back to safe default.
      if (!url.startsWith(baseUrl) && !url.startsWith('/')) {
        return `${baseUrl}/admin/dashboard`;
      }
      const path = url.startsWith(baseUrl) ? url.slice(baseUrl.length) || '/' : url;
      // Auth-cycle paths: don't bounce back to the login surface.
      if (path === '/admin' || path === '/admin/login' || path === '/login' || path === '/') {
        return `${baseUrl}/admin/dashboard`;
      }
      // Same-origin legitimate destination.
      return url.startsWith(baseUrl) ? url : `${baseUrl}${path}`;
    },
  },
};
