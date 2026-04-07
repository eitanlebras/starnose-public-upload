/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  experimental: {
    serverComponentsExternalPackages: ['better-sqlite3', '@google-cloud/firestore'],
  },
  async rewrites() {
    // Only proxy /internal/health to a local daemon when one is configured.
    // In cloud deployments there is no daemon, so we leave the route
    // unrouted (the client probe will fail and the "open dashboard" link
    // will stay hidden, which is the desired behavior).
    const daemon = process.env.STARNOSE_DAEMON_URL || (process.env.NODE_ENV !== 'production' ? 'http://localhost:3399' : '');
    if (!daemon) return [];
    return [
      { source: '/internal/health', destination: `${daemon}/internal/health` },
    ];
  },
};

module.exports = nextConfig;
