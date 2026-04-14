'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { ModelingComingSoon } from '../ComingSoon';
import { SignInForm } from './SignInForm';

function Inner({ variant }: { variant: 'signin' | 'register' }) {
  const searchParams = useSearchParams();
  const bypass = searchParams.get('bypass') === 'true';
  if (bypass) return <SignInForm />;
  return <ModelingComingSoon variant={variant} />;
}

export function ModelingComingSoonWrapper({ variant }: { variant: 'signin' | 'register' }) {
  return (
    <Suspense>
      <Inner variant={variant} />
    </Suspense>
  );
}
