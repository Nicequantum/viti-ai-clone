'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import type { TechnicianSession } from '@/types';

export function useSession() {
  const [session, setSession] = useState<TechnicianSession | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const { session: s } = await api.me();
      setSession(s);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setSession(null);
      } else {
        setSession(null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const login = useCallback(async (d7Number: string, password: string) => {
    const { session: s } = await api.login(d7Number, password);
    setSession(s);
    return s;
  }, []);

  const logout = useCallback(async () => {
    await api.logout();
    setSession(null);
  }, []);

  const acceptConsent = useCallback(async () => {
    const { consentAt } = await api.acceptConsent();
    setSession((prev) => (prev ? { ...prev, consentAt } : prev));
  }, []);

  return { session, loading, login, logout, acceptConsent, refresh };
}