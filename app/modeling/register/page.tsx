import { getModelingComingSoonState } from '@/src/lib/shared/modelingComingSoon';
import { NavbarServer } from '@/src/components/layout/NavbarServer';
import { RegisterForm } from './RegisterForm';

export const revalidate = 0;

/**
 * Registration stays open during Coming Soon. Students register early,
 * confirm email, and are ready to log in the moment the hub goes live
 * (manual toggle or auto-launch cron). Sign-in + authed surfaces remain
 * gated via their own layouts / NextAuth authorize() check.
 */
export default async function ModelingRegisterPage() {
  const state = await getModelingComingSoonState();
  return (
    <>
      <NavbarServer />
      <RegisterForm preLaunch={state.enabled} launchDate={state.launchDate} />
    </>
  );
}
