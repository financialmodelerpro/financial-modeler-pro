import type { Metadata } from 'next';

const LEARN_URL = process.env.NEXT_PUBLIC_LEARN_URL ?? 'https://learn.financialmodelerpro.com';

/**
 * Verify pages live on the learn. subdomain by design — QR codes,
 * share previews, and canonical URLs all point here. Without this
 * layout the root `metadataBase` (main domain) would make OG images
 * resolve to financialmodelerpro.com, so LinkedIn / WhatsApp previews
 * would display the main domain in the card footer even though the
 * shared URL was learn. This layout pins metadataBase to learn so
 * every relative OG image URL resolves correctly.
 */
export const metadata: Metadata = {
  metadataBase: new URL(LEARN_URL),
};

export default function VerifyLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
