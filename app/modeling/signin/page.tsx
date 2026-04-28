import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getModelingSigninComingSoonState } from '@/src/lib/shared/modelingComingSoon';
import { isEmailWhitelisted } from '@/src/lib/shared/modelingAccess';
import { NavbarServer } from '@/src/shared/components/layout/NavbarServer';
import { SignInForm } from './SignInForm';
import { ModelingComingSoonWrapper } from './ComingSoonWrapper';

export const revalidate = 0;

export default async function ModelingSignInPage() {
  const state = await getModelingSigninComingSoonState();

  // If already authenticated as admin or whitelisted user, skip the signin
  // page entirely and land on the dashboard. Without this, a logged-in
  // admin who lands on /signin (via a link, the dashboard's stale-session
  // redirect, or a browser refresh) would see "Launching Soon" while
  // their JWT cookie is perfectly valid.
  const session = await getServerSession(authOptions);
  if (session?.user) {
    const role  = (session.user as { role?: string }).role;
    const email = session.user.email ?? null;
    if (role === 'admin') redirect('/modeling/dashboard');
    if (!state.enabled) redirect('/modeling/dashboard');
    if (email && await isEmailWhitelisted(email)) redirect('/modeling/dashboard');
  }

  if (state.enabled) {
    return (
      <>
        <NavbarServer />
        <ModelingComingSoonWrapper variant="signin" launchDate={state.launchDate} />
      </>
    );
  }
  return <><NavbarServer /><SignInForm /></>;
}
