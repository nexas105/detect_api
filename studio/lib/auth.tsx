'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

// Dynamic host: use same hostname as browser, just different port
// Empty env vars are treated as unset — enables network access via any hostname
function getServiceUrl(envVar: string | undefined, defaultPort: string): string {
  if (envVar && envVar.trim()) return envVar;
  if (typeof window !== 'undefined') {
    return `http://${window.location.hostname}:${defaultPort}`;
  }
  return `http://localhost:${defaultPort}`;
}

const AUTH_PORT = process.env.NEXT_PUBLIC_AUTH_PORT || '8001';
const API_PORT = process.env.NEXT_PUBLIC_API_PORT || '8000';

const AUTH_URL = getServiceUrl(process.env.NEXT_PUBLIC_AUTH_URL, AUTH_PORT);

interface User {
  id: string;
  email: string;
  role: string;
  tenant_id: string;
  is_active: boolean;
}

interface AuthState {
  user: User | null;
  token: string | null;
  tenant_name: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  authFetch: (url: string, init?: RequestInit) => Promise<Response>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState<string | null>(null);
  const [tenantName, setTenantName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const logout = useCallback(() => {
    setUser(null);
    setToken(null);
    setRefreshToken(null);
    setTenantName(null);
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('tenant_name');
  }, []);

  const fetchUser = useCallback(async (accessToken: string) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch(`${AUTH_URL}/me`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: controller.signal,
      });
      if (!res.ok) throw new Error('Unauthorized');
      return res.json();
    } finally {
      clearTimeout(timeout);
    }
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await fetch(`${AUTH_URL}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ username: email, password }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Login failed');
    }
    const data = await res.json();
    localStorage.setItem('access_token', data.access_token);
    localStorage.setItem('refresh_token', data.refresh_token);
    if (data.tenant_name) {
      localStorage.setItem('tenant_name', data.tenant_name);
      setTenantName(data.tenant_name);
    }
    setToken(data.access_token);
    setRefreshToken(data.refresh_token);
    const me = await fetchUser(data.access_token);
    setUser(me);
  }, [fetchUser]);

  const authFetch = useCallback(async (url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    if (token) headers.set('Authorization', `Bearer ${token}`);
    return fetch(url, { ...init, headers });
  }, [token]);

  useEffect(() => {
    const stored = localStorage.getItem('access_token');
    const storedRefresh = localStorage.getItem('refresh_token');
    const storedTenantName = localStorage.getItem('tenant_name');
    if (storedTenantName) setTenantName(storedTenantName);
    if (!stored) {
      setLoading(false);
      return;
    }
    setToken(stored);
    setRefreshToken(storedRefresh);
    fetchUser(stored)
      .then(setUser)
      .catch(() => {
        // Try refresh
        if (storedRefresh) {
          fetch(`${AUTH_URL}/refresh`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refresh_token: storedRefresh }),
          })
            .then((r) => (r.ok ? r.json() : Promise.reject()))
            .then((data) => {
              localStorage.setItem('access_token', data.access_token);
              localStorage.setItem('refresh_token', data.refresh_token);
              if (data.tenant_name) {
                localStorage.setItem('tenant_name', data.tenant_name);
                setTenantName(data.tenant_name);
              }
              setToken(data.access_token);
              setRefreshToken(data.refresh_token);
              return fetchUser(data.access_token);
            })
            .then(setUser)
            .catch(logout);
        } else {
          logout();
        }
      })
      .finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const value = useMemo(
    () => ({ user, token, tenant_name: tenantName, loading, login, logout, authFetch }),
    [user, token, tenantName, loading, login, logout, authFetch]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

const API_URL = getServiceUrl(process.env.NEXT_PUBLIC_API_URL, API_PORT);

export { AUTH_URL, API_URL };
