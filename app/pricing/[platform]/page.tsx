import type { Metadata } from 'next';
import PricingPageBody from '@/app/pricing/PricingPageBody';
import { platformSlugForSegment, getPlatform } from '@/src/hubs/modeling/config/platforms';

export const revalidate = 0;

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.financialmodelerpro.com';

/**
 * /pricing/<segment> - per-platform pricing on a clean path.
 *
 * <segment> is the source-derived URL segment (platform shortName lowercased,
 * e.g. REFM -> refm), resolved back to a platform slug via the platform config
 * source (platformSlugForSegment), never hardcoded. The page renders the SAME
 * shared PricingPageBody used by bare /pricing and the in-app pricing, with the
 * platform pre-selected so its Trial / Professional / Firm plans + comparison
 * show directly (skipping the picker). The shared PricingExplorer stays
 * session-aware (logged-out register handoff; logged-in in-app checkout / trial).
 *
 * Unknown / unresolvable segment -> initialPlatform is undefined, so the body
 * falls back to the platform picker (graceful, not an error). One canonical URL
 * per platform, used by the dashboard and marketing alike.
 *
 * No em dashes in this file.
 */
export async function generateMetadata({ params }: { params: Promise<{ platform: string }> }): Promise<Metadata> {
  const { platform } = await params;
  const slug = platformSlugForSegment(platform);
  const p = slug ? getPlatform(slug) : undefined;
  return {
    title: p ? `${p.name} Pricing | Financial Modeler Pro` : 'Plans & Pricing | Financial Modeler Pro',
    description: p ? `Plans and pricing for ${p.name}. ${p.tagline}` : 'Choose the plan that fits your modeling needs.',
    alternates: { canonical: `${APP_URL}/pricing/${platform}` },
  };
}

export default async function PlatformPricingPage({ params }: { params: Promise<{ platform: string }> }) {
  const { platform } = await params;
  const slug = platformSlugForSegment(platform);
  return <PricingPageBody initialPlatform={slug ?? undefined} />;
}
