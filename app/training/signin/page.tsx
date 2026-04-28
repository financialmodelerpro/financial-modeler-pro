import { NavbarServer } from '@/src/shared/components/layout/NavbarServer';
import { getTrainingComingSoonState } from '@/src/hubs/training/lib/comingSoon';
import { TrainingSignInForm } from './SignInForm';
import { TrainingComingSoonWrapper } from './ComingSoonWrapper';

export const revalidate = 0;

export default async function TrainingSignInPage() {
  const state = await getTrainingComingSoonState();
  if (state.enabled) {
    return (
      <>
        <NavbarServer />
        <TrainingComingSoonWrapper variant="signin" launchDate={state.launchDate} />
      </>
    );
  }
  return <><NavbarServer /><TrainingSignInForm /></>;
}
