import './globals.css';
import { cookies } from 'next/headers';
import Nav from '@/components/Nav';
import RegisterSW from '@/components/RegisterSW';

export const metadata = {
  title: 'Personal Finance Manager',
  description: 'Daily Spent — statements, reconciliation, dues, forecasts, budgets, net worth',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'Finance' },
  icons: { icon: '/icon-192.png', apple: '/apple-touch-icon.png' },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0a0d13',
  viewportFit: 'cover',
};

export default async function RootLayout({ children }) {
  const theme = (await cookies()).get('theme')?.value === 'light' ? 'light' : 'dark';
  return (
    <html lang="en" data-theme={theme}>
      <body>
        <RegisterSW />
        <div className="appshell">
          <Nav />
          <main className="main">
            <div className="container">{children}</div>
          </main>
        </div>
      </body>
    </html>
  );
}
