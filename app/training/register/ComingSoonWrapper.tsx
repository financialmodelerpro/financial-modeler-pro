'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { TrainingComingSoon } from '../ComingSoon';
import { TrainingRegisterForm } from './RegisterForm';

/**
 * Register-side Coming Soon wrapper. Same shape as the signin-side wrapper
 * (app/training/signin/ComingSoonWrapper.tsx). During Coming Soon the
 * register page renders the launch countdown; `?bypass=true` is the escape
 * hatch for pre-launch QA, mirroring the signin behaviour. The API route
 * `/api/training/register` has its own bypass-list check so this isn't the
 * only line of defence.
 */
function Inner({ launchDate }: { launchDate: string | null }) {
  const searchParams = useSearchParams();
  const bypass = searchParams.get('bypass') === 'true';
  if (bypass) return <TrainingRegisterForm />;
  return <TrainingComingSoon variant="register" launchDate={launchDate} />;
}

export function TrainingRegisterComingSoonWrapper({ launchDate }: { launchDate: string | null }) {
  return (
    <Suspense>
      <Inner launchDate={launchDate} />
    </Suspense>
  );
}
