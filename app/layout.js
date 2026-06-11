import './globals.css';
import Nav from '@/components/Nav';

export const metadata = {
  title: 'Personal Finance Manager',
  description: 'Daily Spent — statements, reconciliation, dues',
};

export const viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <Nav />
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
