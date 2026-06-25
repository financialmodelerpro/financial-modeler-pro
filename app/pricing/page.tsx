import type { Metadata } from 'next';
import PricingPageBody from './PricingPageBody';

export const revalidate = 0;

const MAIN_URL_PR = process.env.NEXT_PUBLIC_MAIN_URL ?? 'https://financialmodelerpro.com';

export const metadata: Metadata = {
  title: 'Pricing | Financial Modeler Pro',
  description: 'Flexible pricing for Financial Modeler Pro Training Hub and Modeling Hub platforms. Professional financial modeling training and institutional-grade modeling tools. Start free, upgrade when ready.',
  alternates: { canonical: `${MAIN_URL_PR}/pricing` },
};

// Public marketing pricing route (apex). Shares ONE body with the in-app pricing
// route (app/modeling/pricing) so both look identical and read the same plans.
// The body's interactive island is session-aware (logged-out -> register
// handoff; logged-in -> in-app checkout/trial), so no branching is needed here.
export default function PricingPage() {
  return <PricingPageBody />;
}
