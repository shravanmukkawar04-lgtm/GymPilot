import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ['pg', 'bcryptjs', 'nodemailer'],
};

export default nextConfig;
