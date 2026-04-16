import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import SessionProviderWrapper from '@/src/components/shared/SessionProviderWrapper';
import BrandingThemeApplier from '@/src/components/shared/BrandingThemeApplier';
import { ToastProvider } from '@/src/components/ui/Toaster';
import { getServerClient } from '@/src/lib/shared/supabase';

const inter = Inter({ subsets: ['latin'] });

const MAIN_URL  = process.env.NEXT_PUBLIC_MAIN_URL  ?? 'https://financialmodelerpro.com';
const OG_TITLE  = 'Financial Modeler Pro — Free Financial Modeling Certification';
const OG_DESC   = 'Build institutional-grade financial models. Free professional certification program with 3-Statement Financial Modeling and Business Valuation courses.';

export async function generateMetadata(): Promise<Metadata> {
  let iconUrl = '';
  let logoUrl = '';

  try {
    const sb = getServerClient();
    const { data } = await sb
      .from('cms_content')
      .select('key, value')
      .eq('section', 'header_settings')
      .in('key', ['icon_url', 'icon_as_favicon', 'logo_url']);
    const map: Record<string, string> = {};
    for (const row of (data ?? []) as { key: string; value: string }[]) map[row.key] = row.value;
    if (map.icon_as_favicon === 'true' && map.icon_url) iconUrl = map.icon_url;
    logoUrl = map.logo_url || '';
  } catch { /* use defaults */ }

  const ogImage = logoUrl || `${MAIN_URL}/api/training/achievement-image?session=Financial+Modeler+Pro&score=100&course=Professional+Certification`;

  const base: Metadata = {
    title: OG_TITLE,
    description: OG_DESC,
    openGraph: {
      type: 'website',
      title: OG_TITLE,
      description: OG_DESC,
      siteName: 'Financial Modeler Pro',
      url: MAIN_URL,
      images: [{ url: ogImage, width: 1200, height: 630, alt: 'Financial Modeler Pro' }],
    },
    twitter: {
      card: 'summary_large_image',
      title: OG_TITLE,
      description: OG_DESC,
      images: [ogImage],
    },
  };

  if (iconUrl) base.icons = { icon: iconUrl };

  return base;
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className} suppressHydrationWarning>
        <SessionProviderWrapper>
          <ToastProvider>
            <BrandingThemeApplier />
            {children}
          </ToastProvider>
        </SessionProviderWrapper>
      </body>
    </html>
  );
}
