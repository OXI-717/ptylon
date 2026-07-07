'use client';

import dynamic from 'next/dynamic';

// SSR disabled entirely — Zustand loads from localStorage which doesn't exist on server.
// This prevents React hydration error #310 (server HTML ≠ client HTML).
const HomeClient = dynamic(() => import('./HomeClient'), {
  ssr: false,
  loading: () => (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0e14]">
      <div className="text-[#40E0D0] font-mono animate-pulse">Loading...</div>
    </div>
  ),
});

export default function Page() {
  return <HomeClient />;
}
