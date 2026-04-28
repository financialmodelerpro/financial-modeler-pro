import 'next-auth';
import 'next-auth/jwt';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      email: string;
      name?: string | null;
      role: 'user' | 'admin';
      subscription_plan: 'free' | 'professional' | 'enterprise';
      subscription_status: 'active' | 'trial' | 'expired' | 'cancelled';
    };
  }

  interface User {
    id: string;
    email: string;
    name?: string | null;
    role: 'user' | 'admin';
    subscription_plan: 'free' | 'professional' | 'enterprise';
    subscription_status: 'active' | 'trial' | 'expired' | 'cancelled';
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id: string;
    role: 'user' | 'admin';
    subscription_plan: 'free' | 'professional' | 'enterprise';
    subscription_status: 'active' | 'trial' | 'expired' | 'cancelled';
  }
}
