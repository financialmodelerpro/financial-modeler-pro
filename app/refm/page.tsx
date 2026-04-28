'use client';

import { useRequireAuth } from '@/src/shared/hooks/useRequireAuth';
import RealEstatePlatform from '@/src/components/refm/RealEstatePlatform';

export default function RefmPage() {
  const { loading } = useRequireAuth();
  if (loading) return null;
  return <RealEstatePlatform />;
}
