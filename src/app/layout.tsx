import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import type { ReactNode } from 'react';
import { BottomBar, SideRail } from '@/components/layout/nav';
import { VisitTracker } from '@/components/layout/command-palette';
import { ToastProvider } from '@/components/ui/toast';
import { PrivacyProvider } from '@/contexts/privacy-context';
import './globals.css';

export const metadata: Metadata = {
  title: 'Finance',
  description: 'Personal finance manager — cards, spending, ledgers and forecasting.',
  applicationName: 'Finance',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'Finance' },
  /* Required for Web Push on iOS. Apple only delivers push to a web app that
     was added to the Home Screen, and only one with a manifest declaring
     display: standalone — without it the permission prompt never appears. */
  manifest: '/manifest.webmanifest',
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // The app is installed to the home screen; letting the viewport zoom on
  // input focus makes number entry jump around.
  maximumScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#121318' },
  ],
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Read the theme server-side so the first paint is already correct — a
  // client-side toggle would flash the wrong palette before hydrating.
  const theme = (await cookies()).get('theme')?.value;
  const themeAttr = theme === 'light' || theme === 'dark' ? theme : undefined;

  return (
    <html lang="en-IN" data-theme={themeAttr} suppressHydrationWarning>
      <body className="min-h-dvh">
        {/* Every write reports its outcome through this provider — a save must
            never be left ambiguous. */}
        <PrivacyProvider>
          <ToastProvider>
            <div className="flex">
              <SideRail />
              {/* Bottom padding clears the fixed tab bar on phones. */}
              <main className="min-w-0 flex-1 pb-24 lg:pb-8">{children}</main>
              <VisitTracker />
            </div>
            <BottomBar />
          </ToastProvider>
        </PrivacyProvider>
      </body>
    </html>
  );
}
