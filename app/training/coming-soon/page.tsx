import { NavbarServer } from '@/src/components/layout/NavbarServer';
import { getTrainingComingSoonState } from '@/src/lib/shared/trainingComingSoon';
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
