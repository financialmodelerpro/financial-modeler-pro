import type { Metadata } from 'next';
import PwaClient from '@/src/hubs/modeling/components/pwa/PwaClient';
import InstalledAppFooter from '@/src/hubs/modeling/components/pwa/InstalledAppFooter';

const APP_URL   = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.financialmodelerpro.com';
const OG_TITLE  = 'Financial Modeler Pro - Professional Modeling Hub';
const OG_DESC   = 'Access professional financial modeling tools, templates and resources. Build institutional-grade models with expert guidance. Real Estate, Business Valuation, FP&A and more.';

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: OG_TITLE,
  description: OG_DESC,
  // Override the root layout's MAIN_URL canonical so modeling-hub pages
  // default to app.* rather than inheriting the main-domain canonical.
  alternates: { canonical: APP_URL },
  // INSTALLABLE APP: no manifest here (2026-11-11). PwaClient adds it, with the
  // iOS tags, only for a signed-in user on a signed-in page (installApps.ts).

  openGraph: {
    type: 'website',
    title: OG_TITLE,
    description: OG_DESC,
    siteName: 'Financial Modeler Pro',
    url: APP_URL,
    images: [{ url: `${APP_URL}/api/og/modeling`, width: 1200, height: 630, alt: OG_TITLE }],
  },
  twitter: {
    card: 'summary_large_image',
    title: OG_TITLE,
    description: OG_DESC,
    images: [`${APP_URL}/api/og/modeling`],
  },
};

export default function ModelingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PwaClient />
      {children}
      <InstalledAppFooter />
    </>
  );
}
