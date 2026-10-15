import type { NextConfig } from 'next';

// `'use cache'` (used for the reference date in app/page.tsx) is a Cache
// Components feature and only compiles with this flag.
const nextConfig: NextConfig = { cacheComponents: true };

export default nextConfig;
