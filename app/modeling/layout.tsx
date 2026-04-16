import type { Metadata } from 'next';

const APP_URL   = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.financialmodelerpro.com';
const OG_TITLE  = 'Financial Modeler Pro — Professional Modeling Hub';
const OG_DESC   = 'Access professional financial modeling tools, templates and resources. Build institutional-grade models with expert guidance. Real Estate, Business Valuation, FP&A and more.';

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: OG_TITLE,
  description: OG_DESC,
  openGraph: {
    type: 'website',
    title: OG_TITLE,
    description: OG_DESC,
    siteName: 'Financial Modeler Pro',
    url: APP_URL,
    images: [{ url: `${APP_URL}/api/og/modeling`, width: 1200, height: 627, alt: OG_TITLE }],
  },
  twitter: {
    card: 'summary_large_image',
    title: OG_TITLE,
    description: OG_DESC,
    images: [`${APP_URL}/api/og/modeling`],
  },
};

export default function ModelingLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
