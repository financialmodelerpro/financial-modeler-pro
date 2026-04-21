'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { ModelingComingSoon } from '../ComingSoon';
import { RegisterForm } from './RegisterForm';

/**
 * Register-side Coming Soon wrapper for the Modeling Hub.
 *
 * Mirrors the signin-side wrapper (app/modeling/signin/ComingSoonWrapper.tsx)
 * and the Training Hub's register wrapper. During Coming Soon the page
 * renders the launch countdown; `?bypass=true` is the QA escape hatch
 * and is also the "I have an invite" path for whitelisted users who
 * clicked an admin-shared link without the `?email=` hint.
 *
 * The whitelist-email short-circuit happens in the server page BEFORE
 * this wrapper renders, so any request that reaches this component and
 * lacks `?bypass=true` is genuinely meant to see the CS screen.
 */
function Inner({ launchDate }: { launchDate: string | null }) {
  const searchParams = useSearchParams();
  const bypass = searchParams.get('bypass') === 'true';
  if (bypass) return <RegisterForm preLaunch={true} launchDate={launchDate} />;
  return <ModelingComingSoon variant="register" launchDate={launchDate} />;
}

export function ModelingRegisterComingSoonWrapper({ launchDate }: { launchDate: string | null }) {
  return (
    <Suspense>
      <Inner launchDate={launchDate} />
    </Suspense>
  );
}
