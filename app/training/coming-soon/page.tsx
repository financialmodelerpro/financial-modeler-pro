import { NavbarServer } from '@/src/shared/components/layout/NavbarServer';
import { getTrainingComingSoonState } from '@/src/hubs/training/lib/comingSoon';
import { TrainingComingSoon } from '../ComingSoon';

export const revalidate = 0;

export default async function TrainingComingSoonPage() {
  const state = await getTrainingComingSoonState();
  return (
    <>
      <NavbarServer />
      <TrainingComingSoon variant="signin" launchDate={state.launchDate} />
    </>
  );
}
