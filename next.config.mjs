/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Limit request body size to 10 MB (default is unlimited).
  // Bill-import PDF uploads are the largest payloads; 10 MB is generous.
  experimental: {
    serverActions: { bodySizeLimit: '10mb' },
  },
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173' },
          { key: 'Access-Control-Allow-Credentials', value: 'true' },
          { key: 'Access-Control-Allow-Methods', value: 'GET,POST,PUT,DELETE,OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type, Authorization' },
        ],
      },
    ];
  },
};

export default nextConfig;
