'use client';

/**
 * /modeling/choose-plan
 *
 * The post-login landing for a user with NO plan (subscription_plan = 'none',
 * the signup default). A none user has zero platform access, so instead of the
 * modeling tool they land here to view plans / purchase or request a trial.
 *
 * Access comes only from an approved trial or a purchase (a plan change). This
 * screen does NOT grant anything; it routes the user to those flows.
 *
 * Guard: only a none, non-admin user sees this. An admin or any user with a real
 * plan (trial/solo/pro/firm, or the access-preserving unknown-plan safety net)
 * is sent on to the dashboard. Unauthenticated visitors go to sign-in.
 *
 * No em dashes in this file.
 */
import { useEffect } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEntitlements } from '@/src/hubs/modeling/platforms/refm/lib/useEntitlements';
import { NONE_PLAN_KEY } from '@/src/shared/entitlements/gate';

const NAVY = '#0D2E5A';
const GOLD = '#C9A84C';
const GOLD_LIGHT = '#FDF6E3';
const MAIN_URL = process.env.NEXT_PUBLIC_MAIN_URL ?? 'https://financialmodelerpro.com';

export default function ChoosePlanPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const ent = useEntitlements();

  // Unauthenticated -> sign in.
  useEffect(() => {
    if (status === 'unauthenticated') router.replace('/signin?bypass=true');
  }, [status, router]);

  // Anyone who is NOT a none user (admin, or a real/unknown plan) belongs on the
  // dashboard, not here. Only a none, non-admin user stays on this screen.
  useEffect(() => {
    if (ent.loaded && !ent.error && !ent.isAdmin && ent.planKey !== NONE_PLAN_KEY && ent.planKey !== '') {
      router.replace('/modeling/dashboard');
    }
    if (ent.loaded && ent.isAdmin) {
      router.replace('/modeling/dashboard');
    }
  }, [ent.loaded, ent.error, ent.isAdmin, ent.planKey, router]);

  if (status === 'loading' || !ent.loaded) {
    return (
      <div style={{ fontFamily: "'Inter', sans-serif", background: NAVY, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: 14 }}>Loading...</div>
      </div>
    );
  }
  if (!session?.user) return null;

  const email = session.user.email ?? '';

  return (
    <div data-testid="choose-plan-screen" style={{ fontFamily: "'Inter', sans-serif", background: 'radial-gradient(1200px 500px at 50% -10%, #163a6b 0%, #0D2E5A 45%, #0A2448 100%)', minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', color: '#fff' }}>
      <div style={{ width: 4, height: 44, background: GOLD, borderRadius: 2, marginBottom: 22 }} aria-hidden />
      <div style={{ maxWidth: 560, width: '100%', textAlign: 'center' }}>
        <div style={{ display: 'inline-block', fontSize: 11, fontWeight: 800, color: '#F4E6BC', letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 16, padding: '6px 14px', borderRadius: 999, background: 'rgba(201,168,76,0.16)', border: '1px solid rgba(201,168,76,0.4)' }}>
          Choose a plan
        </div>
        <h1 style={{ fontSize: 'clamp(26px, 4vw, 38px)', fontWeight: 900, lineHeight: 1.1, letterSpacing: '-0.02em', margin: '0 0 14px' }}>
          You do not have an active plan yet
        </h1>
        <p style={{ fontSize: 15.5, color: 'rgba(255,255,255,0.74)', lineHeight: 1.65, margin: '0 auto 32px', maxWidth: 460 }}>
          Your account is ready, but you need a plan to use the modeling platform. Choose a plan to purchase, or request a free trial and an admin will set you up.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 360, margin: '0 auto' }}>
          <a href="/modeling/pricing" data-testid="choose-plan-view-plans"
            style={{ display: 'block', textAlign: 'center', textDecoration: 'none', padding: '14px 0', borderRadius: 12, fontWeight: 800, fontSize: 15, background: GOLD, color: NAVY, boxShadow: '0 12px 28px -8px rgba(201,168,76,0.55)' }}>
            View plans and pricing
          </a>
          <a href={`${MAIN_URL}/contact`} data-testid="choose-plan-request-trial"
            style={{ display: 'block', textAlign: 'center', textDecoration: 'none', padding: '13px 0', borderRadius: 12, fontWeight: 700, fontSize: 14.5, background: 'transparent', color: '#fff', border: '1.5px solid rgba(255,255,255,0.35)' }}>
            Request a free trial
          </a>
        </div>

        <div style={{ marginTop: 22, fontSize: 12.5, color: GOLD_LIGHT }}>
          A free trial is reviewed and approved by an admin before access is granted.
        </div>

        <div style={{ marginTop: 36, paddingTop: 20, borderTop: '1px solid rgba(255,255,255,0.12)', fontSize: 12.5, color: 'rgba(255,255,255,0.55)' }}>
          Signed in as <span style={{ color: '#fff', fontWeight: 600 }}>{email}</span>
          {' '}&middot;{' '}
          <button onClick={() => signOut({ callbackUrl: '/' })}
            style={{ background: 'none', border: 'none', color: GOLD, fontWeight: 700, fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
