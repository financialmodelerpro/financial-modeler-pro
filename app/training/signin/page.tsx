import { NavbarServer } from '@/src/components/layout/NavbarServer';
import { getTrainingComingSoonState } from '@/src/lib/shared/trainingComingSoon';
import { TrainingSignInForm } from './SignInForm';
import { TrainingComingSoonWrapper } from './ComingSoonWrapper';

export const revalidate = 0;

export default async function TrainingSignInPage() {
  const state = await getTrainingComingSoonState();
  if (state.enabled) {
    return <TrainingComingSoonWrapper variant="signin" launchDate={state.launchDate} />;
  }
  return <><NavbarServer /><TrainingSignInForm /></>;
}
