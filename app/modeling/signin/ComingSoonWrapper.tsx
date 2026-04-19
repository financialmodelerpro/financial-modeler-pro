'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { ModelingComingSoon } from '../ComingSoon';
import { SignInForm } from './SignInForm';

function Inner({ variant, launchDate }: { variant: 'signin' | 'register'; launchDate: string | null }) {
  const searchParams = useSearchParams();
  const bypass = searchParams.get('bypass') === 'true';
  if (bypass) return <SignInForm />;
  return <ModelingComingSoon variant={variant} launchDate={launchDate} />;
}

export function ModelingComingSoonWrapper({ variant, launchDate }: { variant: 'signin' | 'register'; launchDate: string | null }) {
  return (
    <Suspense>
      <Inner variant={variant} launchDate={launchDate} />
    </Suspense>
  );
}
