'use client';

import React, { useCallback, useRef, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Group,
  Paper,
  Progress,
  Stack,
  Text,
  Textarea,
} from '@mantine/core';
import { IconAlertCircle, IconFileUpload, IconTag, IconUpload } from '@tabler/icons-react';
import { useTranslations } from 'next-intl';
import { DashboardShell } from '@/components/DashboardShell/DashboardShell';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { API_URL } from '@/lib/auth';
import { useApiKeys } from '@/lib/use-api-keys';
import { ApiKeySelect } from '@/components/ApiKeySelect';

const ACCEPTED_IMAGE = '.jpg,.jpeg,.png,.webp';

interface TagItem {
  label: string;
  score: number;
}

interface TagResult {
  image_id: string;
  tags: TagItem[];
  model: string;
}

export default function TagPage() {
  const { keys, selectedKey, setSelectedKey, selectedKeyId, selectKey, error: keysError } = useApiKeys();
  const t = useTranslations('tag');

  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [labels, setLabels] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<TagResult | null>(null);

  const handleTag = useCallback(async () => {
    if (!file || !selectedKey.trim() || !labels.trim()) return;
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('labels', labels.trim());
      const res = await fetch(`${API_URL}/tag`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${selectedKey.trim()}` },
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Request failed (${res.status})`);
      }
      setResult(await res.json());
    } catch (err: any) {
      setError(err.message || 'Tagging failed');
    } finally {
      setLoading(false);
    }
  }, [file, selectedKey, labels]);

  return (
    <DashboardShell>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />

      <Paper withBorder p="lg" radius="md" mb="xl">
        <Stack>
          {/* API Key selection */}
          <ApiKeySelect
            keys={keys}
            selectedKey={selectedKey}
            setSelectedKey={setSelectedKey}
            selectedKeyId={selectedKeyId}
            selectKey={selectKey}
            label={t('apiKey')}
            placeholder={t('selectKey')}
          />

          {/* File picker */}
          <div>
            <Text size="sm" fw={500} mb={4}>File</Text>
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPTED_IMAGE}
              onChange={(e) => { setFile(e.target.files?.[0] ?? null); setResult(null); setError(''); }}
              style={{ display: 'none' }}
            />
            <Group>
              <Button variant="light" leftSection={<IconFileUpload size={16} />} onClick={() => fileRef.current?.click()}>
                {file ? 'Change file' : 'Choose file'}
              </Button>
              {file && <Text size="sm" c="dimmed">{file.name} ({(file.size / 1024).toFixed(1)} KB)</Text>}
            </Group>
            <Text size="xs" c="dimmed" mt={4}>Supported: JPG, PNG, WebP</Text>
          </div>

          {/* Labels textarea */}
          <Textarea
            label={t('labelsLabel')}
            description={t('labelsDescription')}
            placeholder={t('labelsPlaceholder')}
            value={labels}
            onChange={(e) => setLabels(e.currentTarget.value)}
            minRows={3}
          />

          <Button
            leftSection={<IconTag size={16} />}
            onClick={handleTag}
            loading={loading}
            disabled={!file || !selectedKey.trim() || !labels.trim()}
            fullWidth
          >
            {t('tagButton')}
          </Button>
        </Stack>
      </Paper>

      {keysError && (
        <Alert icon={<IconAlertCircle size={16} />} color="orange" mb="xl" title="API Keys">
          {keysError}
        </Alert>
      )}

      {error && (
        <Paper withBorder p="lg" radius="md" mb="xl" style={{ borderColor: 'var(--mantine-color-red-6)' }}>
          <Text c="red">{error}</Text>
        </Paper>
      )}

      {result && (
        <Paper withBorder p="lg" radius="md" mb="xl">
          <Group justify="space-between" mb="md">
            <Text fw={600} fz="lg">{t('results')}</Text>
            <Badge variant="light" color="violet">{result.model}</Badge>
          </Group>
          <Stack gap="sm">
            {result.tags
              .sort((a, b) => b.score - a.score)
              .map((tag) => (
                <div key={tag.label}>
                  <Group justify="space-between" mb={4}>
                    <Text size="sm" fw={500}>{tag.label}</Text>
                    <Text size="sm" fw={600}>{(tag.score * 100).toFixed(1)}%</Text>
                  </Group>
                  <Progress
                    value={tag.score * 100}
                    color={tag.score > 0.7 ? 'green' : tag.score > 0.4 ? 'yellow' : 'gray'}
                    size="md"
                    radius="xl"
                  />
                </div>
              ))}
          </Stack>
        </Paper>
      )}
    </DashboardShell>
  );
}
