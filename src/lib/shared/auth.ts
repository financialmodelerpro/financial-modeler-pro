import type { AuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { cookies } from 'next/headers';
import { serverClient } from '@/src/lib/shared/supabase';
import { verifyPassword } from '@/src/lib/shared/password';
import { isDeviceTrusted, DEVICE_COOKIE_NAME } from '@/src/lib/shared/deviceTrust';
import { getModelingComingSoonState } from '@/src/lib/shared/modelingComingSoon';

export const authOptions: AuthOptions = {
  session: { strategy: 'jwt', maxAge: 60 * 60 }, // 1 hour
  pages: {
    signIn: '/admin/login',
    error:  '/admin/login',
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

        // Pre-launch gate: sign-in is blocked while the Modeling Hub is in
        // Coming Soon mode, even though registration stays open. Admins
        // bypass (they always did) so the platform can be set up before
        // launch. The thrown `ComingSoon` error is surfaced to the signin
        // UI; the signin page itself is also server-gated, so this only
        // matters for anyone calling /api/auth/callback/credentials directly.
        if (user.role !== 'admin') {
          const cs = await getModelingComingSoonState();
          if (cs.enabled) {
            throw new Error('ComingSoon');
          }
        }

        // Admin: skip email confirmation and device verification - return immediately
        if (user.role === 'admin') {
          return {
            id:                  user.id,
            email:               user.email,
            name:                user.name ?? null,
            role:                user.role,
            subscription_plan:   user.subscription_plan,
            subscription_status: user.subscription_status,
          };
        }

        // Block unconfirmed non-admin accounts
        if (!user.email_confirmed) {
          throw new Error('EmailNotConfirmed');
        }

        // Check device trust via next/headers cookies() - reliable in App Router context
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
  },
};
