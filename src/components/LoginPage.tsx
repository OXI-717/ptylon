'use client';

import { useState, FormEvent } from 'react';
import { useWorkspaceStore } from '@/stores/workspace-store';

const APP_LABEL = process.env.NEXT_PUBLIC_APP_LABEL || 'Web Console';
const BUILD_MARKER = 'cloudfarm-dns-only-20260612';

interface LoginPageProps {
  onServerSynced?: () => void;
}

export default function LoginPage({ onServerSynced }: LoginPageProps) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const setAuth = useWorkspaceStore((s) => s.setAuth);
  const syncFromServer = useWorkspaceStore((s) => s.syncFromServer);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      if (res.ok) {
        // Get wsToken from auth check
        const check = await fetch('/api/auth');
        const data = await check.json();
        if (data.authenticated) {
          await syncFromServer();
          setAuth(true, data.wsToken);
          onServerSynced?.();
        }
      } else {
        setError('Wrong password');
      }
    } catch {
      setError('Connection error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0e14]">
      <form
        onSubmit={handleSubmit}
        data-build={BUILD_MARKER}
        className="w-full max-w-sm p-8 rounded-xl bg-[#1a1e24] border border-[#2a2e34] shadow-2xl"
      >
        <div className="text-center mb-8">
          <div className="text-4xl mb-2 font-mono text-[#40E0D0]">⬡</div>
          <h1 className="text-xl font-mono text-white">Web Console</h1>
          <p className="text-sm text-gray-500 font-mono mt-1">{APP_LABEL}</p>
        </div>

        <div className="mb-4">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            autoFocus
            className="w-full px-4 py-3 rounded-lg bg-[#0a0e14] border border-[#2a2e34] text-white font-mono
                       placeholder-gray-600 focus:border-[#40E0D0] focus:outline-none focus:ring-1 focus:ring-[#40E0D0]
                       transition-colors"
          />
        </div>

        {error && (
          <div className="mb-4 text-red-400 text-sm font-mono text-center">{error}</div>
        )}

        <button
          type="submit"
          disabled={loading || !password}
          className="w-full py-3 rounded-lg bg-[#40E0D0] text-black font-mono font-bold
                     hover:bg-[#35c4b5] disabled:opacity-50 disabled:cursor-not-allowed
                     transition-colors"
        >
          {loading ? 'Connecting...' : 'Connect'}
        </button>
      </form>
    </div>
  );
}
