import type { NextConfig } from 'next';

/* ===========================================================================
   Security headers follow the blueprint's L10 set, tightened for a finance
   app: this one has no camera, microphone or geolocation feature at all, so
   all three are denied outright rather than allowed for self.

   Referrer-Policy matters more here than it looks. It is the header that stops
   a token-bearing URL leaking into a third party's referrer log.
   =========================================================================== */

const securityHeaders = [
  // The app is never legitimately embedded. Both headers, because older
  // browsers honour only the first and modern ones only the second.
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()' },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Re-enable once the route tree stops moving; while pages are being added
  // typed routes reject every href that has no page yet.
  typedRoutes: false,

  // Loaded with Node's own require rather than bundled: it carries a large
  // embedded WebAssembly decoder that gains nothing from bundling.
  serverExternalPackages: ['heic-convert'],

  experimental: {
    // Skeleton-first navigation: a route re-visited inside 30s renders from
    // the client cache with no server round-trip, and any revalidatePath from
    // a write busts it immediately. Pairs with the loading.tsx files.
    staleTimes: { dynamic: 30, static: 180 },
  },

  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
