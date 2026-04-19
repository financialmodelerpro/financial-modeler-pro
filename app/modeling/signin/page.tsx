import { getModelingComingSoonState } from '@/src/lib/shared/modelingComingSoon';
import { NavbarServer } from '@/src/components/layout/NavbarServer';
import { SignInForm } from './SignInForm';
import { ModelingComingSoonWrapper } from './ComingSoonWrapper';

export const revalidate = 0;

export default async function ModelingSignInPage() {
  const state = await getModelingComingSoonState();
  if (state.enabled) {
    return (
      <>
        <NavbarServer />
        <ModelingComingSoonWrapper variant="signin" launchDate={state.launchDate} />
      </>
    );
  }
  return <><NavbarServer /><SignInForm /></>;
}
