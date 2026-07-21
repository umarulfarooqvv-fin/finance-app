/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['better-sqlite3'],
  // Lint runs via `npm run lint` and CI; style nits must never block a deploy.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
