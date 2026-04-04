import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import SessionProviderWrapper from '@/src/components/shared/SessionProviderWrapper';
import BrandingThemeApplier from '@/src/components/shared/BrandingThemeApplier';
import { ToastProvider } from '@/src/components/ui/Toaster';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Financial Modeler Pro — Platform Hub',
  description: 'Professional financial modeling and planning platform suite.',
};

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
