'use client';

import React, { useCallback, useRef, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Collapse,
  Group,
  Paper,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
} from '@mantine/core';
import {
  IconAlertCircle,
  IconChevronDown,
  IconChevronRight,
  IconFileUpload,
  IconShieldCheck,
} from '@tabler/icons-react';
import { useTranslations } from 'next-intl';
import { DashboardShell } from '@/components/DashboardShell/DashboardShell';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { ProcessingQueue } from '@/components/ProcessingQueue/ProcessingQueue';
import {
  ClipAnalysisCards,
  AgeAnalysis,
  DeepfakeAnalysis,
  ClothingAnalysis,
} from '@/components/ClipAnalysisCards';
import { API_URL } from '@/lib/auth';
import { useApiKeys } from '@/lib/use-api-keys';

const ACCEPTED_IMAGE = '.jpg,.jpeg,.png,.webp';

interface Detection {
  label: string;
  score: number;
  box?: number[];
  model?: string;
}

interface ModerateResult {
  image_id: string;
  action: 'allow' | 'flag' | 'block';
  confidence: number;
  reasons: string[];
  detections: Detection[];
  rating: any;
  clip_analysis: {
    sexiness: any;
    age: AgeAnalysis;
    deepfake: DeepfakeAnalysis;
    clothing: ClothingAnalysis;
  };
  summary: { nudity_score: number };
}

const ACTION_COLORS: Record<string, string> = {
  allow: 'green',
  flag: 'yellow',
  block: 'red',
};

export default function ModeratePage() {
  const { keys, selectedKey, setSelectedKey, selectedKeyId, selectKey, error: keysError } = useApiKeys();
  const t = useTranslations('moderate');

  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [startTime, setStartTime] = useState<number | undefined>();
  const [error, setError] = useState('');
  const [result, setResult] = useState<ModerateResult | null>(null);
  const [showDetections, setShowDetections] = useState(false);
  const [showRating, setShowRating] = useState(false);
  const [showClip, setShowClip] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const handleModerate = useCallback(async () => {
    if (!file || !selectedKey.trim()) return;
    setLoading(true);
    setStartTime(Date.now());
    setError('');
    setResult(null);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`${API_URL}/moderate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${selectedKey.trim()}` },
        body: formData,
        signal: controller.signal,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Request failed (${res.status})`);
      }
      setResult(await res.json());
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setError(err.message || 'Moderation failed');
      }
    } finally {
      setLoading(false);
      setStartTime(undefined);
      abortRef.current = null;
    }
  }, [file, selectedKey]);

  const handleCancel = () => {
    abortRef.current?.abort();
  };

  return (
    <DashboardShell>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />

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

          <Button
            leftSection={<IconShieldCheck size={16} />}
            onClick={handleModerate}
            loading={loading}
            disabled={!file || !selectedKey.trim()}
            fullWidth
          >
            {t('moderateButton')}
          </Button>
        </Stack>
      </Paper>

      <ProcessingQueue
        isProcessing={loading}
        status={t('analyzing')}
        onCancel={handleCancel}
        startTime={startTime}
      />

      {keysError && (
        <Alert icon={<IconAlertCircle size={16} />} color="orange" mb="xl" title="API Keys">
          {keysError}
        </Alert>
      )}

      {error && (
        <Alert icon={<IconAlertCircle size={16} />} color="red" mb="xl" title="Error">
          {error}
        </Alert>
      )}

      {result && (
        <>
          {/* Action badge */}
          <Paper withBorder p="lg" radius="md" mb="xl">
            <Stack align="center" gap="md">
              <Badge
                size="xl"
                color={ACTION_COLORS[result.action] || 'gray'}
                variant="filled"
                radius="md"
                style={{ fontSize: 20, padding: '16px 32px' }}
              >
                {result.action.toUpperCase()}
              </Badge>
              <Text size="sm" c="dimmed">
                {t('confidence')}: {(result.confidence * 100).toFixed(1)}%
              </Text>
              <Text size="sm" c="dimmed">
                {t('nudityScore')}: {(result.summary.nudity_score * 100).toFixed(1)}%
              </Text>
            </Stack>
          </Paper>

          {/* Reasons */}
          {result.reasons.length > 0 && (
            <Stack gap="xs" mb="xl">
              {result.reasons.map((reason, idx) => (
                <Alert
                  key={idx}
                  color={ACTION_COLORS[result.action] || 'gray'}
                  variant="light"
                  icon={<IconAlertCircle size={16} />}
                >
                  {reason}
                </Alert>
              ))}
            </Stack>
          )}

          {/* Collapsible: Detections */}
          <Paper withBorder p="md" radius="md" mb="md">
            <Group
              justify="space-between"
              style={{ cursor: 'pointer' }}
              onClick={() => setShowDetections(!showDetections)}
            >
              <Text fw={600}>{t('detections')} ({result.detections.length})</Text>
              {showDetections ? <IconChevronDown size={18} /> : <IconChevronRight size={18} />}
            </Group>
            <Collapse expanded={showDetections}>
              {result.detections.length > 0 ? (
                <Table striped highlightOnHover mt="sm">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Label</Table.Th>
                      <Table.Th>Score</Table.Th>
                      <Table.Th>Box (x, y, w, h)</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {result.detections.map((det, idx) => (
                      <Table.Tr key={idx}>
                        <Table.Td><Badge variant="light" size="sm">{det.label}</Badge></Table.Td>
                        <Table.Td><Text size="sm">{(det.score * 100).toFixed(1)}%</Text></Table.Td>
                        <Table.Td>
                          <Text size="xs" c="dimmed" ff="monospace">
                            {det.box ? det.box.map((v) => v.toFixed(0)).join(', ') : '--'}
                          </Text>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              ) : (
                <Text c="dimmed" size="sm" mt="sm">No detections</Text>
              )}
            </Collapse>
          </Paper>

          {/* Collapsible: Rating */}
          {result.rating && (
            <Paper withBorder p="md" radius="md" mb="md">
              <Group
                justify="space-between"
                style={{ cursor: 'pointer' }}
                onClick={() => setShowRating(!showRating)}
              >
                <Text fw={600}>{t('rating')}</Text>
                {showRating ? <IconChevronDown size={18} /> : <IconChevronRight size={18} />}
              </Group>
              <Collapse expanded={showRating}>
                <Stack gap="xs" mt="sm">
                  <Group gap="xs">
                    <Badge variant="light" size="lg">{t('score')}: {Math.round((result.rating.score ?? 0) * 100)}%</Badge>
                    <Badge variant="light" color={result.rating.category === 'safe' ? 'green' : 'orange'}>
                      {result.rating.category}
                    </Badge>
                  </Group>
                  {result.rating.description && (
                    <Text size="sm" c="dimmed">{result.rating.description}</Text>
                  )}
                </Stack>
              </Collapse>
            </Paper>
          )}

          {/* Collapsible: CLIP Analysis */}
          {result.clip_analysis && (
            <Paper withBorder p="md" radius="md" mb="xl">
              <Group
                justify="space-between"
                style={{ cursor: 'pointer' }}
                onClick={() => setShowClip(!showClip)}
              >
                <Text fw={600}>{t('clipAnalysis')}</Text>
                {showClip ? <IconChevronDown size={18} /> : <IconChevronRight size={18} />}
              </Group>
              <Collapse expanded={showClip}>
                <div style={{ marginTop: 12 }}>
                  <ClipAnalysisCards
                    age={result.clip_analysis.age}
                    deepfake={result.clip_analysis.deepfake}
                    clothing={result.clip_analysis.clothing}
                  />
                </div>
              </Collapse>
            </Paper>
          )}
        </>
      )}
    </DashboardShell>
  );
}
