import type { NextConfig } from 'next';
const nextConfig: NextConfig = {
  experimental: { serverActions: { bodySizeLimit: '2mb' } },
eslint: { ignoreDuringBuilds: true },
};
export default nextConfig;
