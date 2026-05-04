/**
 * M1.8 wizard reproduction fixture.
 *
 * Mounts RealEstatePlatform inside a stubbed NextAuth SessionProvider so
 * Playwright can drive the wizard without the production /refm auth gate
 * + Coming-Soon layout guard. NextAuth's `useSession()` returns
 * `fakeSession` immediately because `<SessionProvider session={...}>`
 * skips the network fetch when a session prop is supplied.
 *
 * Only available when NODE_ENV !== 'production' so this fixture is never
 * exposed to real users.
 */

'use client';

import { SessionProvider } from 'next-auth/react';
import { notFound } from 'next/navigation';
import RealEstatePlatform from '@/src/hubs/modeling/platforms/refm/components/RealEstatePlatform';

const fakeSession = {
  user: {
    id:    '00000000-0000-0000-0000-000000000000',
    email: 'fixture@local',
    name:  'Fixture User',
    role:  'admin',
    subscription_plan:   'enterprise',
    subscription_status: 'active',
  },
  expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
};

export default function M18WizardFixture() {
  if (process.env.NODE_ENV === 'production') notFound();
  return (
    <SessionProvider session={fakeSession as never}>
      <RealEstatePlatform />
    </SessionProvider>
  );
}
