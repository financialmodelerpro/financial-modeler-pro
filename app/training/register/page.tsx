import { NavbarServer } from '@/src/shared/components/layout/NavbarServer';
import { getTrainingRegisterComingSoonState } from '@/src/hubs/training/lib/comingSoon';
import { TrainingRegisterForm } from './RegisterForm';
import { TrainingRegisterComingSoonWrapper } from './ComingSoonWrapper';

export const revalidate = 0;

/**
 * Registration is gated by its OWN Coming Soon toggle (migration 135),
 * independent from the signin toggle. Admins can hold register closed
 * while keeping signin open, or vice versa. The `?bypass=true` query
 * param is the pre-launch escape hatch for QA (handled by
 * TrainingRegisterComingSoonWrapper). The API route
 * `/api/training/register` enforces the same gate server-side so direct
 * POSTs can't sidestep it.
 */
export default async function TrainingRegisterPage() {
  const state = await getTrainingRegisterComingSoonState();
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
