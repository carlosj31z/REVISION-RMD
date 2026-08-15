/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ["unpdf"],
  },
};

module.exports = nextConfig;
