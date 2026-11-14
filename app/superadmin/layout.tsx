import type { Metadata } from 'next';

// Not linked from anywhere and kept out of search engines. The API behind it also needs SUPERADMIN_KEY.
export const metadata: Metadata = { title: 'GymPilot', robots: { index: false, follow: false } };

export default function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  return children;
}
