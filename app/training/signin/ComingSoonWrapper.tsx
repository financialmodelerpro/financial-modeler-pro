'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { TrainingComingSoon } from '../ComingSoon';
import { TrainingSignInForm } from './SignInForm';

function Inner({ variant, launchDate }: { variant: 'signin' | 'register'; launchDate: string | null }) {
  const searchParams = useSearchParams();
  const bypass = searchParams.get('bypass') === 'true';
  if (bypass) return <TrainingSignInForm />;
  return <TrainingComingSoon variant={variant} launchDate={launchDate} />;
}

export function TrainingComingSoonWrapper({ variant, launchDate }: { variant: 'signin' | 'register'; launchDate: string | null }) {
  return (
    <Suspense>
      <Inner variant={variant} launchDate={launchDate} />
    </Suspense>
  );
}
