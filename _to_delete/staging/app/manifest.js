export default function manifest() {
  return {
    name: 'Personal Finance Manager',
    short_name: 'Finance',
    description: 'Statements, dues, forecasts, budgets and net worth for your Daily Spent sheet',
    start_url: '/',
    display: 'standalone',
    background_color: '#0e1116',
    theme_color: '#0e1116',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
