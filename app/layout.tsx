import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';
import './globals.css';
import SessionProviderWrapper from '@/src/components/shared/SessionProviderWrapper';
import BrandingThemeApplier from '@/src/components/shared/BrandingThemeApplier';
import { ToastProvider } from '@/src/components/ui/Toaster';
import { getServerClient } from '@/src/lib/shared/supabase';
import { OrganizationJsonLd, WebSiteJsonLd } from '@/src/components/seo/StructuredData';

const inter = Inter({ subsets: ['latin'] });

const MAIN_URL  = process.env.NEXT_PUBLIC_MAIN_URL  ?? 'https://financialmodelerpro.com';
const OG_TITLE  = 'Financial Modeler Pro | Professional Financial Modeling Training & Platform';
const OG_DESC   = 'Practitioner-built financial modeling platform. Professional training in 3-Statement Modeling, Business Valuation, Real Estate, Project Finance, and Corporate Finance. Built for analysts across KSA, GCC, Pakistan, and global markets.';

const KEYWORDS = [
  'financial modeling training',
  'financial modeling course',
  '3 statement financial modeling',
  'business valuation',
  'real estate financial modeling',
  'corporate finance training',
  'transaction advisory training',
  'financial modeling KSA',
  'financial modeling Saudi Arabia',
  'financial modeling GCC',
  'financial modeling Pakistan',
  'financial modeling online course',
  'professional financial modeling training',
  'FMVA prep',
  'ACCA financial modeling',
  'investment modeling',
  'valuation training',
  'LBO modeling',
  'project finance modeling',
  'FP&A modeling',
  'Excel financial modeling',
  'practitioner financial modeling',
];

export async function generateMetadata(): Promise<Metadata> {
  let iconUrl = '';

  try {
    const sb = getServerClient();
    const { data } = await sb
      .from('cms_content')
      .select('key, value')
      .eq('section', 'header_settings')
      .in('key', ['icon_url', 'icon_as_favicon']);
    const map: Record<string, string> = {};
    for (const row of (data ?? []) as { key: string; value: string }[]) map[row.key] = row.value;
    if (map.icon_as_favicon === 'true' && map.icon_url) iconUrl = map.icon_url;
  } catch { /* use defaults */ }

  const ogImage = `${MAIN_URL}/api/og/main`;

  const base: Metadata = {
    metadataBase: new URL(MAIN_URL),
    title: {
      default: OG_TITLE,
      template: '%s | Financial Modeler Pro',
    },
    description: OG_DESC,
    keywords: KEYWORDS,
    alternates: { canonical: MAIN_URL },
    authors: [{ name: 'Ahmad Din', url: `${MAIN_URL}/about/ahmad-din` }],
    creator: 'Financial Modeler Pro',
    publisher: 'Financial Modeler Pro',
    category: 'Financial Services Education',
    formatDetection: { email: false, address: false, telephone: false },
    openGraph: {
      type: 'website',
      locale: 'en_US',
      url: MAIN_URL,
      siteName: 'Financial Modeler Pro',
      title: OG_TITLE,
      description: OG_DESC,
      images: [{ url: ogImage, width: 1200, height: 630, alt: 'Financial Modeler Pro — Structured Modeling. Real-World Finance.' }],
    },
    twitter: {
      card: 'summary_large_image',
      title: OG_TITLE,
      description: OG_DESC,
      images: [ogImage],
    },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        'max-video-preview': -1,
        'max-image-preview': 'large',
        'max-snippet': -1,
      },
    },
  };

  if (iconUrl) base.icons = { icon: iconUrl };

  return base;
}

export const viewport: Viewport = {
  themeColor: '#0D2E5A',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className} suppressHydrationWarning>
        <OrganizationJsonLd />
        <WebSiteJsonLd />
        <SessionProviderWrapper>
          <ToastProvider>
            <BrandingThemeApplier />
            {children}
          </ToastProvider>
        </SessionProviderWrapper>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
