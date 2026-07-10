'use client';

import { useCallback, useEffect, useState } from 'react';
import { API_URL, AUTH_URL, useAuth } from './auth';

export interface UseAuthQueryOptions {
  /** Which service to prefix a relative path with. Ignored for absolute URLs. Default 'auth'. */
  base?: 'auth' | 'api';
  /** Skip fetching while false (e.g. waiting on a dependency). Default true. */
  enabled?: boolean;
  /** Extra fetch init (headers, method, body, ...). */
  init?: RequestInit;
}

export interface UseAuthQueryResult<T> {
  data: T | null;
  error: string | null;
  isLoading: boolean;
  refetch: () => Promise<void>;
}

/**
 * Wraps authFetch with loading/error/data/refetch state so pages don't
 * re-implement the useState + useEffect + try/catch boilerplate.
 *
 *   const { data, error, isLoading, refetch } = useAuthQuery<UsageStats>('/usage/stats');
 *   const det = useAuthQuery<Result>('/detections?limit=50', { base: 'api' });
 *
 * `path` may be a relative path (prefixed by AUTH_URL / API_URL) or an absolute URL.
 */
export function useAuthQuery<T = unknown>(
  path: string,
  options: UseAuthQueryOptions = {}
): UseAuthQueryResult<T> {
  const { base = 'auth', enabled = true, init } = options;
  const { authFetch } = useAuth();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(enabled);

  const url = /^https?:\/\//.test(path)
    ? path
    : `${base === 'api' ? API_URL : AUTH_URL}${path.startsWith('/') ? '' : '/'}${path}`;

  const refetch = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await authFetch(url, init);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || `Request failed (${res.status})`);
      }
      setData((await res.json()) as T);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setIsLoading(false);
    }
    // ponytail: `init` intentionally excluded — inline object literals are unstable
    // refs and would loop. Pass a memoised init if you need it in the dep set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authFetch, url]);

  useEffect(() => {
    if (enabled) refetch();
  }, [enabled, refetch]);

  return { data, error, isLoading, refetch };
}
