'use client';

import React, { useCallback, useRef, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Code,
  CopyButton,
  Group,
  Paper,
  RingProgress,
  SegmentedControl,
  Select,
  Stack,
  Text,
  TextInput,
  Center,
} from '@mantine/core';
import {
  IconAlertCircle,
  IconCopy,
  IconCheck,
  IconFileUpload,
  IconUpload,
  IconVectorBezier2,
} from '@tabler/icons-react';
import { useTranslations } from 'next-intl';
import { DashboardShell } from '@/components/DashboardShell/DashboardShell';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { API_URL } from '@/lib/auth';
import { useApiKeys } from '@/lib/use-api-keys';

const ACCEPTED_IMAGE = '.jpg,.jpeg,.png,.webp';

interface EmbedResult {
  image_id: string;
  embedding: number[];
  dimensions: number;
  model: string;
  normalized: boolean;
}

interface CompareResult {
  similarity: number;
  is_similar: boolean;
  embedding_model: string;
}

export default function EmbedPage() {
  const { keys, selectedKey, setSelectedKey, selectedKeyId, selectKey, error: keysError } = useApiKeys();
  const t = useTranslations('embed');

  const [tab, setTab] = useState<'embed' | 'compare'>('embed');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Embed state
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [embedResult, setEmbedResult] = useState<EmbedResult | null>(null);

  // Compare state
  const file1Ref = useRef<HTMLInputElement>(null);
  const file2Ref = useRef<HTMLInputElement>(null);
  const [file1, setFile1] = useState<File | null>(null);
  const [file2, setFile2] = useState<File | null>(null);
  const [compareResult, setCompareResult] = useState<CompareResult | null>(null);

  const handleEmbed = useCallback(async () => {
    if (!file || !selectedKey.trim()) return;
    setLoading(true);
    setError('');
    setEmbedResult(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      let res: Response;
      try {
        res = await fetch(`${API_URL}/embed`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${selectedKey.trim()}` },
          body: formData,
        });
      } catch {
        throw new Error('Cannot reach API server. The CLIP model may still be loading or the server is unavailable.');
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Request failed (${res.status})`);
      }
      setEmbedResult(await res.json());
    } catch (err: any) {
      setError(err.message || 'Embedding failed');
    } finally {
      setLoading(false);
    }
  }, [file, selectedKey]);

  const handleCompare = useCallback(async () => {
    if (!file1 || !file2 || !selectedKey.trim()) return;
    setLoading(true);
    setError('');
    setCompareResult(null);
    try {
      const formData = new FormData();
      formData.append('file1', file1);
      formData.append('file2', file2);
      let res: Response;
      try {
        res = await fetch(`${API_URL}/compare`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${selectedKey.trim()}` },
          body: formData,
        });
      } catch {
        throw new Error('Cannot reach API server. The CLIP model may still be loading or the server is unavailable.');
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Request failed (${res.status})`);
      }
      setCompareResult(await res.json());
    } catch (err: any) {
      setError(err.message || 'Comparison failed');
    } finally {
      setLoading(false);
    }
  }, [file1, file2, selectedKey]);

  const handleTabChange = (value: string) => {
    setTab(value as 'embed' | 'compare');
    setError('');
    setEmbedResult(null);
    setCompareResult(null);
  };

  return (
    <DashboardShell>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />

      <Center mb="xl">
        <SegmentedControl
          value={tab}
          onChange={handleTabChange}
          data={[
            { label: t('embedTab'), value: 'embed' },
            { label: t('compareTab'), value: 'compare' },
          ]}
        />
      </Center>

      <Paper withBorder p="lg" radius="md" mb="xl">
        <Stack>
          {/* API Key selection */}
          <Paper withBorder p="sm" radius="md">
            <Text size="sm" fw={500} mb={4}>
              {t('apiKey')} <Text span c="red">*</Text>
            </Text>
            <Select
              placeholder={t('selectKey')}
              data={keys.map((k) => ({
                value: k.id,
                label: `${k.name}${k.is_master ? ' [master]' : ''} — ${k.is_own && !k.key.endsWith('...') ? 'ready' : k.key}`,
              }))}
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

          {tab === 'embed' && (
            <>
              <div>
                <Text size="sm" fw={500} mb={4}>File</Text>
                <input
                  ref={fileRef}
                  type="file"
                  accept={ACCEPTED_IMAGE}
                  onChange={(e) => { setFile(e.target.files?.[0] ?? null); setEmbedResult(null); setError(''); }}
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

              <Button
                leftSection={<IconVectorBezier2 size={16} />}
                onClick={handleEmbed}
                loading={loading}
                disabled={!file || !selectedKey.trim()}
                fullWidth
              >
                {t('getEmbedding')}
              </Button>
            </>
          )}

          {tab === 'compare' && (
            <>
              <Group grow>
                <div>
                  <Text size="sm" fw={500} mb={4}>{t('image1')}</Text>
                  <input
                    ref={file1Ref}
                    type="file"
                    accept={ACCEPTED_IMAGE}
                    onChange={(e) => { setFile1(e.target.files?.[0] ?? null); setCompareResult(null); setError(''); }}
                    style={{ display: 'none' }}
                  />
                  <Button variant="light" leftSection={<IconFileUpload size={16} />} onClick={() => file1Ref.current?.click()} fullWidth>
                    {file1 ? file1.name : 'Choose image 1'}
                  </Button>
                </div>
                <div>
                  <Text size="sm" fw={500} mb={4}>{t('image2')}</Text>
                  <input
                    ref={file2Ref}
                    type="file"
                    accept={ACCEPTED_IMAGE}
                    onChange={(e) => { setFile2(e.target.files?.[0] ?? null); setCompareResult(null); setError(''); }}
                    style={{ display: 'none' }}
                  />
                  <Button variant="light" leftSection={<IconFileUpload size={16} />} onClick={() => file2Ref.current?.click()} fullWidth>
                    {file2 ? file2.name : 'Choose image 2'}
                  </Button>
                </div>
              </Group>

              <Button
                leftSection={<IconUpload size={16} />}
                onClick={handleCompare}
                loading={loading}
                disabled={!file1 || !file2 || !selectedKey.trim()}
                fullWidth
              >
                {t('compare')}
              </Button>
            </>
          )}
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

      {/* Embed result */}
      {embedResult && (
        <Paper withBorder p="lg" radius="md" mb="xl">
          <Group justify="space-between" mb="md">
            <Text fw={600} fz="lg">{t('embeddingResult')}</Text>
            <Group gap="xs">
              <Badge variant="light" color="violet">{embedResult.model}</Badge>
              <Badge variant="light">{embedResult.dimensions} dims</Badge>
              {embedResult.normalized && <Badge variant="light" color="green">Normalized</Badge>}
            </Group>
          </Group>

          <Code block mb="md">
            [{embedResult.embedding.slice(0, 10).map((v) => v.toFixed(6)).join(', ')}, ...]
          </Code>

          <CopyButton value={JSON.stringify(embedResult.embedding)}>
            {({ copied, copy }) => (
              <Button
                variant="light"
                color={copied ? 'green' : 'violet'}
                leftSection={copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                onClick={copy}
              >
                {copied ? t('copied') : t('copyFullVector')}
              </Button>
            )}
          </CopyButton>
        </Paper>
      )}

      {/* Compare result */}
      {compareResult && (
        <Paper withBorder p="lg" radius="md" mb="xl">
          <Stack align="center" gap="md">
            <Text fw={600} fz="lg">{t('similarityResult')}</Text>
            <RingProgress
              size={180}
              thickness={16}
              roundCaps
              sections={[{
                value: Math.round(compareResult.similarity * 100),
                color: compareResult.is_similar ? 'green' : 'red',
              }]}
              label={
                <Text ta="center" fw={700} fz="xl">
                  {(compareResult.similarity * 100).toFixed(1)}%
                </Text>
              }
            />
            <Badge
              size="xl"
              color={compareResult.is_similar ? 'green' : 'red'}
              variant="filled"
              radius="md"
            >
              {compareResult.is_similar ? t('similar') : t('different')}
            </Badge>
            <Badge variant="light" color="violet">{compareResult.embedding_model}</Badge>
          </Stack>
        </Paper>
      )}
    </DashboardShell>
  );
}
