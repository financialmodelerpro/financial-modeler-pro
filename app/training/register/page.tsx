import { getTrainingComingSoonState } from '@/src/lib/shared/trainingComingSoon';
import { TrainingRegisterForm } from './RegisterForm';
import { TrainingComingSoon } from '../ComingSoon';

export const revalidate = 0;

export default async function TrainingRegisterPage() {
  const state = await getTrainingComingSoonState();
  if (state.enabled) {
    return <TrainingComingSoon variant="register" launchDate={state.launchDate} />;
  }
  return <TrainingRegisterForm />;
}
