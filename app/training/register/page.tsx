import { getTrainingComingSoonState } from '@/src/lib/shared/trainingComingSoon';
import { TrainingRegisterForm } from './RegisterForm';

export const revalidate = 0;

/**
 * Registration stays open during Coming Soon. Students register early,
 * confirm email, and are ready to log in the moment the hub goes live
 * (manual toggle or auto-launch cron). Sign-in + authed surfaces remain
 * gated via their own layouts / API checks.
 */
export default async function TrainingRegisterPage() {
  const state = await getTrainingComingSoonState();
  return (
    <TrainingRegisterForm
      preLaunch={state.enabled}
      launchDate={state.launchDate}
    />
  );
}
