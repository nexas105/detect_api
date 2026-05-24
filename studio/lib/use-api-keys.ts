import { useCallback, useEffect, useState } from 'react';
import { AUTH_URL, useAuth } from './auth';

export interface ApiKeyOption {
  id: string;
  name: string;
  key: string;
  is_own: boolean;
  is_master: boolean;
}

export function useApiKeys() {
  const { authFetch } = useAuth();
  const [keys, setKeys] = useState<ApiKeyOption[]>([]);
  const [selectedKey, setSelectedKey] = useState('');
  const [selectedKeyId, setSelectedKeyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchKeys = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch(`${AUTH_URL}/api-keys`);
      if (!res.ok) {
        setError('Failed to load API keys');
        return;
      }
      const data = await res.json();
      const normalized: ApiKeyOption[] = (data.keys || data).map((k: Record<string, unknown>) => ({
        id: k.id as string,
        name: k.name as string,
        key: k.key as string,
        is_own: (k.is_own as boolean) ?? true,
        is_master: k.is_master as boolean,
      }));
      setKeys(normalized);
      // Auto-select first own key with full key visible
      const ownKeys = normalized.filter((k) => k.is_own && !k.key.endsWith('...'));
      if (ownKeys.length >= 1 && !selectedKey) {
        setSelectedKeyId(ownKeys[0].id);
        setSelectedKey(ownKeys[0].key);
      } else if (normalized.length === 1 && !selectedKey) {
        setSelectedKeyId(normalized[0].id);
      }
    } catch {
      setError('Failed to load API keys');
    } finally {
      setLoading(false);
    }
  }, [authFetch]);

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  const selectKey = useCallback((keyId: string | null) => {
    setSelectedKeyId(keyId);
    const found = keys.find((k) => k.id === keyId);
    if (found && found.is_own && !found.key.endsWith('...')) {
      setSelectedKey(found.key);
    }
  }, [keys]);

  return { keys, selectedKey, setSelectedKey, selectedKeyId, selectKey, loading, error, refetch: fetchKeys };
}
