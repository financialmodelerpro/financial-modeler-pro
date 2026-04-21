import { getModelingRegisterComingSoonState } from '@/src/lib/shared/modelingComingSoon';
import { NavbarServer } from '@/src/components/layout/NavbarServer';
import { RegisterForm } from './RegisterForm';

export const revalidate = 0;

/**
 * Register page stays rendered even while the register Coming Soon toggle
 * is on so whitelisted invitees can still see and submit the form. The
 * /api/auth/register endpoint is the actual gate (migration 136): it
 * rejects non-admin, non-whitelisted submissions with a 403. When the
 * toggle is off, the banner disappears and anyone can register.
 */
export default async function ModelingRegisterPage() {
  const state = await getModelingRegisterComingSoonState();
  return (
    <>
      <NavbarServer />
      <RegisterForm preLaunch={state.enabled} launchDate={state.launchDate} />
    </>
  );
}
