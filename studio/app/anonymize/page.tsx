'use client';

import React, { useCallback, useRef, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Center,
  Group,
  Image,
  Paper,
  SegmentedControl,
  Select,
  Slider,
  Stack,
  Table,
  Text,
  TextInput,
} from '@mantine/core';
import {
  IconAlertCircle,
  IconDownload,
  IconFileUpload,
  IconUserOff,
} from '@tabler/icons-react';
import { useTranslations } from 'next-intl';
import { DashboardShell } from '@/components/DashboardShell/DashboardShell';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { API_URL } from '@/lib/auth';
import { useApiKeys } from '@/lib/use-api-keys';

const ACCEPTED_IMAGE = '.jpg,.jpeg,.png,.webp';

interface FaceItem {
  box: number[];
  score: number;
}

interface FacesResult {
  image_id: string;
  faces: FaceItem[];
  count: number;
}

export default function AnonymizePage() {
  const { keys, selectedKey, setSelectedKey, selectedKeyId, selectKey, error: keysError } = useApiKeys();
  const t = useTranslations('anonymize');

  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<'detect' | 'anonymize'>('detect');
  const [blurRadius, setBlurRadius] = useState(40);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [facesResult, setFacesResult] = useState<FacesResult | null>(null);
  const [anonymizedUrl, setAnonymizedUrl] = useState<string | null>(null);

  const handleModeChange = (value: string) => {
    setMode(value as 'detect' | 'anonymize');
    setFacesResult(null);
    if (anonymizedUrl) {
      URL.revokeObjectURL(anonymizedUrl);
      setAnonymizedUrl(null);
    }
    setError('');
  };

  const handleRun = useCallback(async () => {
    if (!file || !selectedKey.trim()) return;
    setLoading(true);
    setError('');
    setFacesResult(null);
    if (anonymizedUrl) {
      URL.revokeObjectURL(anonymizedUrl);
      setAnonymizedUrl(null);
    }

    try {
      const formData = new FormData();
      formData.append('file', file);

      if (mode === 'detect') {
        const res = await fetch(`${API_URL}/faces`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${selectedKey.trim()}` },
          body: formData,
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.detail || `Request failed (${res.status})`);
        }
        setFacesResult(await res.json());
      } else {
        const params = new URLSearchParams({ blur_radius: String(blurRadius) });
        const res = await fetch(`${API_URL}/anonymize?${params}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${selectedKey.trim()}` },
          body: formData,
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.detail || `Request failed (${res.status})`);
        }
        const blob = await res.blob();
        setAnonymizedUrl(URL.createObjectURL(blob));
      }
    } catch (err: any) {
      setError(err.message || 'Operation failed');
    } finally {
      setLoading(false);
    }
  }, [file, selectedKey, mode, blurRadius, anonymizedUrl]);

  return (
    <DashboardShell>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />

      <Center mb="xl">
        <SegmentedControl
          value={mode}
          onChange={handleModeChange}
          data={[
            { label: t('detectFaces'), value: 'detect' },
            { label: t('anonymizeMode'), value: 'anonymize' },
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

          {/* File picker */}
          <div>
            <Text size="sm" fw={500} mb={4}>File</Text>
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPTED_IMAGE}
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setFacesResult(null);
                if (anonymizedUrl) { URL.revokeObjectURL(anonymizedUrl); setAnonymizedUrl(null); }
                setError('');
              }}
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

          {/* Blur radius slider (anonymize mode only) */}
          {mode === 'anonymize' && (
            <div>
              <Text size="sm" fw={500} mb={4}>{t('blurRadius')}: {blurRadius}</Text>
              <Slider
                min={5}
                max={200}
                value={blurRadius}
                onChange={setBlurRadius}
                marks={[
                  { value: 5, label: '5' },
                  { value: 100, label: '100' },
                  { value: 200, label: '200' },
                ]}
              />
            </div>
          )}

          <Button
            leftSection={<IconUserOff size={16} />}
            onClick={handleRun}
            loading={loading}
            disabled={!file || !selectedKey.trim()}
            fullWidth
            color={mode === 'anonymize' ? 'red' : undefined}
          >
            {mode === 'detect' ? t('detectButton') : t('anonymizeButton')}
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

      {/* Faces detection result */}
      {facesResult && (
        <Paper withBorder p="lg" radius="md" mb="xl">
          <Group justify="space-between" mb="md">
            <Text fw={600} fz="lg">{t('facesDetected')}</Text>
            <Badge variant="light" size="lg">{facesResult.count} {facesResult.count === 1 ? 'face' : 'faces'}</Badge>
          </Group>
          {facesResult.faces.length > 0 ? (
            <Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>#</Table.Th>
                  <Table.Th>Score</Table.Th>
                  <Table.Th>Box (x, y, w, h)</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {facesResult.faces.map((face, idx) => (
                  <Table.Tr key={idx}>
                    <Table.Td><Text size="sm">{idx + 1}</Text></Table.Td>
                    <Table.Td><Text size="sm">{(face.score * 100).toFixed(1)}%</Text></Table.Td>
                    <Table.Td>
                      <Text size="xs" c="dimmed" ff="monospace">
                        {face.box.map((v) => v.toFixed(0)).join(', ')}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          ) : (
            <Text c="dimmed">No faces detected.</Text>
          )}
        </Paper>
      )}

      {/* Anonymized image result */}
      {anonymizedUrl && (
        <Paper withBorder p="lg" radius="md" mb="xl">
          <Group justify="space-between" mb="md">
            <Text fw={600} fz="lg">{t('anonymizedResult')}</Text>
            <Button
              variant="light"
              color="red"
              leftSection={<IconDownload size={16} />}
              component="a"
              href={anonymizedUrl}
              download={`anonymized-${Date.now()}.png`}
            >
              {t('downloadAnonymized')}
            </Button>
          </Group>
          <Image
            src={anonymizedUrl}
            alt="Anonymized result"
            radius="md"
            maw={800}
            mx="auto"
          />
        </Paper>
      )}
    </DashboardShell>
  );
}
