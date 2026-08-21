/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Typed routes are re-enabled once the full route tree exists; while pages
  // are still being added they reject every href that has no page yet.
  typedRoutes: false,
};
export default nextConfig;
