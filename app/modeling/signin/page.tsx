import { isModelingComingSoon } from '@/src/lib/shared/modelingComingSoon';
import { NavbarServer } from '@/src/components/layout/NavbarServer';
import { SignInForm } from './SignInForm';
import { ModelingComingSoonWrapper } from './ComingSoonWrapper';

export const revalidate = 0;

export default async function ModelingSignInPage() {
  const comingSoon = await isModelingComingSoon();
  if (comingSoon) {
    return <ModelingComingSoonWrapper variant="signin" />;
  }
  return <><NavbarServer /><SignInForm /></>;
}
