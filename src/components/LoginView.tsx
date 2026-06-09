'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { DealershipBranding } from '@/components/DealershipBranding';
import { toast } from 'sonner';

interface LoginViewProps {
  onLogin: (email: string, password: string) => Promise<unknown>;
}

interface SecurityStatus {
  usingDefaultSeedPasswords: boolean;
  warnings: string[];
}

export function LoginView({ onLogin }: LoginViewProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [securityStatus, setSecurityStatus] = useState<SecurityStatus | null>(null);

  useEffect(() => {
    fetch('/api/auth/security-status', { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) setSecurityStatus(data as SecurityStatus);
      })
      .catch(() => undefined);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await onLogin(email, password);
      toast.success('Signed in');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-shell">
      <div className="w-full max-w-sm">
        {securityStatus?.usingDefaultSeedPasswords && (
          <div className="mb-4 ios-card p-3 border border-[#ff9f0a]/50 bg-[#ff9f0a]/10 flex items-start gap-2">
            <AlertTriangle size={16} className="text-[#ff9f0a] mt-0.5 shrink-0" />
            <div>
              <p className="text-xs font-semibold text-[#ff9f0a]">Default Seed Passwords Detected</p>
              <ul className="text-[10px] text-[#8e8e93] mt-1 leading-relaxed space-y-1 list-disc pl-4">
                {securityStatus.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
              <p className="text-[10px] text-[#666] mt-2">
                Rotate all seed account passwords in Settings before production use.
              </p>
            </div>
          </div>
        )}

        <div className="text-center mb-8">
          <div className="w-20 h-20 mx-auto rounded-2xl bg-gradient-to-br from-[#0a84ff] to-[#0066cc] flex items-center justify-center mb-4 p-1">
            <img src="/icon-512.png" alt="Benz Tech" className="w-full h-full rounded-2xl" />
          </div>
          <DealershipBranding size="lg" />
        </div>

        <form onSubmit={handleSubmit} className="ios-card p-6 space-y-4">
          <div>
            <label className="text-xs text-[#8e8e93] block mb-1">Technician Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="tech@dealership.com"
              required
              className="w-full bg-[#2c2c2e] border border-[#38383a] rounded-xl px-4 py-3 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-[#8e8e93] block mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              className="w-full bg-[#2c2c2e] border border-[#38383a] rounded-xl px-4 py-3 text-sm"
            />
          </div>
          <button type="submit" disabled={loading} className="primary-btn w-full h-12 text-sm font-semibold">
            {loading ? 'SIGNING IN...' : 'SIGN IN'}
          </button>
        </form>

        <p className="text-center text-[10px] text-[#666] mt-6 leading-relaxed px-4">Authorized dealership personnel only.</p>
      </div>
    </div>
  );
}