import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/shared/auth';
import { getModelingRegisterComingSoonState } from '@/src/lib/shared/modelingComingSoon';
import { isEmailWhitelisted } from '@/src/lib/shared/modelingAccess';
import { NavbarServer } from '@/src/components/layout/NavbarServer';
import { RegisterForm } from './RegisterForm';
import { ModelingRegisterComingSoonWrapper } from './ComingSoonWrapper';

export const revalidate = 0;

/**
 * Register page gating (migration 136 + 137):
 *
 * 1. Toggle OFF (register CS disabled)
 *      -> everyone sees the form.
 *
 * 2. Toggle ON + `?email=whitelisted@address`
 *      -> whitelisted invitee arrived via admin-shared link. Render the
 *         form with the email pre-filled and locked, so the API-side
 *         whitelist check can't be sidestepped by editing the input.
 *
 * 3. Toggle ON, no `?email=` (or email not whitelisted)
 *      -> render the Coming Soon wrapper. The wrapper still honours
 *         `?bypass=true` so admins can preview the form during testing
 *         and whitelisted users who forgot the email-prefilled link can
 *         still reach the form (the API is the real gate in that case).
 *
 * In all paths, /api/auth/register + /api/auth/confirm-email also run
 * the whitelist check so none of the above is a single point of failure.
 */
interface PageProps {
  searchParams: Promise<{ email?: string | string[]; bypass?: string | string[] }>;
}

export default async function ModelingRegisterPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const state = await getModelingRegisterComingSoonState();

  // Already-authenticated users have no business on a registration page;
  // shunt them to the dashboard. Most importantly this means a logged-in
  // admin clicking a stale Register link doesn't hit a wall of "Launching
  // Soon" while their JWT is perfectly valid.
  const session = await getServerSession(authOptions);
  if (session?.user) {
    redirect('/modeling/dashboard');
  }

  if (!state.enabled) {
    return (
      <>
        <NavbarServer />
        <RegisterForm preLaunch={false} launchDate={null} />
      </>
    );
  }

  const rawEmail = Array.isArray(sp.email) ? sp.email[0] : sp.email;
  const invitedEmail = (rawEmail ?? '').trim().toLowerCase();
  if (invitedEmail && await isEmailWhitelisted(invitedEmail)) {
    return (
      <>
        <NavbarServer />
        <RegisterForm
          preLaunch={true}
          launchDate={state.launchDate}
          invitedEmail={invitedEmail}
        />
      </>
    );
  }

  return (
    <>
      <NavbarServer />
      <ModelingRegisterComingSoonWrapper launchDate={state.launchDate} />
    </>
  );
}
