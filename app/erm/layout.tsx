import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@shared/auth/nextauth';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Equity Research Financial Modeling',
  description: 'The Equity Research Financial Modeling workspace within Financial Modeler Pro.',
  robots: { index: false, follow: false },
};

export default async function ErmLayout({ children }: { children: ReactNode }) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    redirect('/modeling/signin?bypass=true');
  }

  // Unit 1 exposes only the foundation screen to authenticated FMP users.
  // Research permissions and entitlements belong to separately approved units.
  return <>{children}</>;
}
