import type { AuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { serverClient } from '@/src/lib/shared/supabase';
import { verifyPassword } from '@/src/lib/shared/password';

export const authOptions: AuthOptions = {
  session: { strategy: 'jwt' },
  pages: {
    signIn: '/login',
    error: '/login',
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
          .select('id, email, name, role, password_hash, subscription_plan, subscription_status')
          .eq('email', credentials.email.toLowerCase().trim())
          .single();

        if (error || !user) return null;
        if (!user.password_hash) return null;

        const valid = await verifyPassword(credentials.password, user.password_hash);
        if (!valid) return null;

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
