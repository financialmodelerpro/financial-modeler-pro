'use client';

/**
 * /modeling/choose-plan
 *
 * The get-access screen for a user with NO plan (subscription_plan = 'none').
 * A none user has zero platform access, so this is where they choose a plan or
 * start a free trial. Access comes only from an approved trial or a purchase.
 *
 * Actions:
 *   - View plans and pricing -> /modeling/pricing.
 *   - Start free trial -> POST /api/refm/trial. Self-serve by default (granted
 *     instantly, then into the platform); if the admin toggle "Trial requires
 *     approval" is on, it submits a request for admin approval.
 *
 * Resume: if the user arrived here after a logged-out pricing click (intent
 * persisted in localStorage during register), we forward to /modeling/pricing
 * with that intent so the original action resumes. No dead ends.
 *
 * Guard: only a none, non-admin user sees this; admins and real/unknown-plan
 * users are sent to the dashboard. Unauthenticated visitors go to sign-in.
 *
 * No em dashes in this file.
 */
import { useEffect, useState, useCallback } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEntitlements } from '@/src/hubs/modeling/platforms/refm/lib/useEntitlements';
import { NONE_PLAN_KEY } from '@/src/shared/entitlements/gate';
import { readPlanIntent, planIntentQuery } from '@/src/hubs/modeling/lib/planIntent';

const NAVY = '#0D2E5A';
const GOLD = '#C9A84C';
const GOLD_LIGHT = '#FDF6E3';

export default function ChoosePlanPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const ent = useEntitlements();
  const [trialMsg, setTrialMsg] = useState<string | null>(null);
  const [trialBusy, setTrialBusy] = useState(false);

  useEffect(() => {
    if (status === 'unauthenticated') router.replace('/signin?bypass=true');
  }, [status, router]);

  // Resume a logged-out pricing click: forward to pricing with the saved intent.
  useEffect(() => {
    if (status !== 'authenticated' || !ent.loaded) return;
    if (ent.isAdmin || (ent.planKey !== NONE_PLAN_KEY && ent.planKey !== '')) return;
    const intent = readPlanIntent();
    if (intent) router.replace(`/modeling/pricing?${planIntentQuery(intent)}`);
  }, [status, ent.loaded, ent.isAdmin, ent.planKey, router]);

  // Non-none users (admin / real / unknown) belong on the dashboard.
  useEffect(() => {
    if (!ent.loaded || ent.error) return;
    if (ent.isAdmin || (ent.planKey !== NONE_PLAN_KEY && ent.planKey !== '')) {
      router.replace('/modeling/dashboard');
    }
  }, [ent.loaded, ent.error, ent.isAdmin, ent.planKey, router]);

  const startTrial = useCallback(async () => {
    setTrialBusy(true);
    setTrialMsg(null);
    try {
      const res = await fetch('/api/refm/trial', { method: 'POST', credentials: 'same-origin' }).then((r) => r.json());
      if (res.status === 'granted') {
        // Full navigation so the /refm server gate sees the freshly granted plan.
        window.location.href = '/refm';
        return;
      }
      if (res.status === 'requested') {
        setTrialMsg('Your free trial request has been submitted. An admin will review it shortly.');
      } else {
        setTrialMsg(res.error ? `Could not start the trial: ${res.error}` : 'Could not start the trial. Please try again or contact the team.');
      }
    } catch {
      setTrialMsg('Could not start the trial. Please try again.');
    } finally {
      setTrialBusy(false);
    }
  }, []);

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
          Your account is ready, but you need a plan to use the modeling platform. Choose a plan to purchase, or start a free trial.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 360, margin: '0 auto' }}>
          <a href="/modeling/pricing" data-testid="choose-plan-view-plans"
            style={{ display: 'block', textAlign: 'center', textDecoration: 'none', padding: '14px 0', borderRadius: 12, fontWeight: 800, fontSize: 15, background: GOLD, color: NAVY, boxShadow: '0 12px 28px -8px rgba(201,168,76,0.55)' }}>
            View plans and pricing
          </a>
          <button onClick={startTrial} disabled={trialBusy} data-testid="choose-plan-start-trial"
            style={{ display: 'block', textAlign: 'center', padding: '13px 0', borderRadius: 12, fontWeight: 700, fontSize: 14.5, background: 'transparent', color: '#fff', border: '1.5px solid rgba(255,255,255,0.35)', cursor: trialBusy ? 'default' : 'pointer', fontFamily: 'inherit' }}>
            {trialBusy ? 'Starting...' : 'Start free trial'}
          </button>
        </div>

        {trialMsg && (
          <div data-testid="trial-message" style={{ marginTop: 18, fontSize: 13, color: GOLD_LIGHT, background: 'rgba(201,168,76,0.12)', border: '1px solid rgba(201,168,76,0.4)', borderRadius: 10, padding: '10px 14px', maxWidth: 460, margin: '18px auto 0' }}>
            {trialMsg}
          </div>
        )}

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
