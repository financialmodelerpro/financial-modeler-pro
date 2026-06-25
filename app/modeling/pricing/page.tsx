import type { Metadata } from 'next';
import PricingPageBody from '@/app/pricing/PricingPageBody';

export const revalidate = 0;

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.financialmodelerpro.com';

export const metadata: Metadata = {
  title: 'Plans & Pricing | Financial Modeler Pro',
  description: 'Choose the plan that fits your modeling needs. Prices are live from the platform plan catalog.',
  alternates: { canonical: `${APP_URL}/pricing` },
};

/**
 * In-app pricing route. Physically lives under /modeling so the app subdomain
 * can serve it at the clean URL /pricing (next.config rewrite), while the old
 * /modeling/pricing path 308s to /pricing. It renders the SAME PricingPageBody
 * as the public marketing pricing page (one design, one data source). The
 * shared interactive island detects the logged-in session and runs in-app
 * checkout / trial + resume; logged-out visitors get the register handoff.
 */
export default function InAppPricingPage() {
  return <PricingPageBody />;
}
