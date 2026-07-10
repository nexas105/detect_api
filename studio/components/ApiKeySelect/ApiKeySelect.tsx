'use client';

import { useMemo } from 'react';
import { Paper, Select, Text, TextInput } from '@mantine/core';
import type { ApiKeyOption } from '@/lib/use-api-keys';

interface ApiKeySelectProps {
  keys: ApiKeyOption[];
  selectedKey: string;
  setSelectedKey: (value: string) => void;
  selectedKeyId: string | null;
  selectKey: (id: string | null) => void;
  label: string;
  placeholder: string;
}

/**
 * Shared API-key picker: a Select of the user's keys plus a paste field.
 * Extracted from the ~8 pages that duplicated this exact block.
 */
export function ApiKeySelect({
  keys,
  selectedKey,
  setSelectedKey,
  selectedKeyId,
  selectKey,
  label,
  placeholder,
}: ApiKeySelectProps) {
  const data = useMemo(
    () =>
      keys.map((k) => ({
        value: k.id,
        label: `${k.name}${k.is_master ? ' [master]' : ''} — ${
          k.is_own && !k.key.endsWith('...') ? 'ready' : k.key
        }`,
      })),
    [keys]
  );

  return (
    <Paper withBorder p="sm" radius="md">
      <Text size="sm" fw={500} mb={4}>
        {label} <Text span c="red">*</Text>
      </Text>
      <Select
        placeholder={placeholder}
        data={data}
        value={selectedKeyId}
        onChange={selectKey}
        clearable
        mb="xs"
      />
      <TextInput
        placeholder="Paste your full API key (ehk_...)"
        value={selectedKey}
        onChange={(e) => setSelectedKey(e.currentTarget.value)}
      />
    </Paper>
  );
}
