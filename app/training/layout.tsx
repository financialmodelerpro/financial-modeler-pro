import type { Metadata } from 'next';

const LEARN_URL = process.env.NEXT_PUBLIC_LEARN_URL ?? 'https://learn.financialmodelerpro.com';
const OG_TITLE  = 'Financial Modeler Pro - Free Financial Modeling Certification';
const OG_DESC   = 'Build institutional-grade financial models. Free certification program with 3-Statement Financial Modeling and Business Valuation courses. Start free - no credit card required.';

export const metadata: Metadata = {
  metadataBase: new URL(LEARN_URL),
  title: OG_TITLE,
  description: OG_DESC,
  openGraph: {
    type: 'website',
    title: OG_TITLE,
    description: OG_DESC,
    siteName: 'Financial Modeler Pro',
    url: LEARN_URL,
    images: [{ url: `${LEARN_URL}/api/og`, width: 1200, height: 630, alt: OG_TITLE }],
  },
  twitter: {
    card: 'summary_large_image',
    title: OG_TITLE,
    description: OG_DESC,
    images: [`${LEARN_URL}/api/og`],
  },
};

export default function TrainingLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
