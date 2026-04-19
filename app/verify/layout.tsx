import type { Metadata } from 'next';

const LEARN_URL = process.env.NEXT_PUBLIC_LEARN_URL ?? 'https://learn.financialmodelerpro.com';

/**
 * Verify pages live on the learn. subdomain by design — QR codes,
 * share previews, and canonical URLs all point here. This layout pins
 * every metadata field that might otherwise inherit a main-domain
 * value from the root layout:
 *
 * - `metadataBase`        → LEARN_URL (relative OG image URLs resolve here)
 * - `alternates.canonical`→ LEARN_URL (per-page generateMetadata overrides
 *                           with the specific /verify/[id] URL)
 * - `openGraph.url`       → LEARN_URL (same, overridden per page)
 *
 * Without these defaults, sharing a verify URL on LinkedIn/WhatsApp could
 * surface main-domain metadata in the preview footer because the root
 * layout sets those fields to `financialmodelerpro.com`.
 */
export const metadata: Metadata = {
  metadataBase: new URL(LEARN_URL),
  alternates: { canonical: LEARN_URL },
  openGraph: {
    type: 'website',
    url: LEARN_URL,
    siteName: 'Financial Modeler Pro',
  },
};

export default function VerifyLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
