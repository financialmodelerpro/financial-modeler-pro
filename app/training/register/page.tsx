import { NavbarServer } from '@/src/components/layout/NavbarServer';
import { getTrainingComingSoonState } from '@/src/lib/shared/trainingComingSoon';
import { TrainingRegisterForm } from './RegisterForm';
import { TrainingRegisterComingSoonWrapper } from './ComingSoonWrapper';

export const revalidate = 0;

/**
 * Registration is gated by the same Training Hub Coming Soon toggle as
 * signin. When the toggle is on, new visitors see the launch countdown
 * instead of the registration form. The `?bypass=true` query param is
 * the pre-launch escape hatch for QA (handled by TrainingRegisterComingSoonWrapper).
 * The API route `/api/training/register` enforces the same gate server-side
 * so direct POSTs can't sidestep it.
 */
export default async function TrainingRegisterPage() {
  const state = await getTrainingComingSoonState();
  if (state.enabled) {
    return (
      <>
        <NavbarServer />
        <TrainingRegisterComingSoonWrapper launchDate={state.launchDate} />
      </>
    );
  }
  return <><NavbarServer /><TrainingRegisterForm /></>;
}
