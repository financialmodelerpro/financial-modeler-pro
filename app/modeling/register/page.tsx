import { getModelingComingSoonState } from '@/src/lib/shared/modelingComingSoon';
import { NavbarServer } from '@/src/components/layout/NavbarServer';
import { RegisterForm } from './RegisterForm';
import { ModelingComingSoon } from '../ComingSoon';

export const revalidate = 0;

export default async function ModelingRegisterPage() {
  const state = await getModelingComingSoonState();
  if (state.enabled) {
    return (
      <>
        <NavbarServer />
        <ModelingComingSoon variant="register" launchDate={state.launchDate} />
      </>
    );
  }
  return <><NavbarServer /><RegisterForm /></>;
}
