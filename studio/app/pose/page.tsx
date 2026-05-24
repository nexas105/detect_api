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
  IconYoga,
} from '@tabler/icons-react';
import { useTranslations } from 'next-intl';
import { DashboardShell } from '@/components/DashboardShell/DashboardShell';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { API_URL } from '@/lib/auth';
import { useApiKeys } from '@/lib/use-api-keys';

const ACCEPTED_IMAGE = '.jpg,.jpeg,.png,.webp';

interface Keypoint {
  name: string;
  x: number;
  y: number;
  z: number;
  visibility: number;
}

interface PoseAnalysis {
  body_detected: boolean;
  posture: string;
  facing: string;
  arms_raised: boolean;
  visible_keypoints: number;
  total_keypoints: number;
}

interface PoseResult {
  image_id: string;
  pose: {
    available: boolean;
    detected: boolean;
    keypoints: Keypoint[];
    analysis: PoseAnalysis;
  };
}

export default function PosePage() {
  const { keys, selectedKey, setSelectedKey, selectedKeyId, selectKey, error: keysError } = useApiKeys();
  const t = useTranslations('pose');

  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<PoseResult | null>(null);
  const [showKeypoints, setShowKeypoints] = useState(false);

  const handleEstimate = useCallback(async () => {
    if (!file || !selectedKey.trim()) return;
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`${API_URL}/pose`, {
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
      setError(err.message || 'Pose estimation failed');
    } finally {
      setLoading(false);
    }
  }, [file, selectedKey]);

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
            leftSection={<IconYoga size={16} />}
            onClick={handleEstimate}
            loading={loading}
            disabled={!file || !selectedKey.trim()}
            fullWidth
          >
            {t('estimateButton')}
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
        <>
          {/* Pose analysis summary */}
          <Paper withBorder p="lg" radius="md" mb="xl">
            <Text fw={600} fz="lg" mb="md">{t('analysisTitle')}</Text>

            {!result.pose.available ? (
              <Text c="dimmed">{t('poseUnavailable')}</Text>
            ) : !result.pose.detected ? (
              <Text c="dimmed">{t('noPoseDetected')}</Text>
            ) : (
              <Stack gap="sm">
                <Group gap="xs" wrap="wrap">
                  <Badge variant="light" size="lg" color="violet">
                    {t('posture')}: {result.pose.analysis.posture}
                  </Badge>
                  <Badge variant="light" size="lg" color="teal">
                    {t('facing')}: {result.pose.analysis.facing}
                  </Badge>
                  <Badge variant="light" size="lg" color={result.pose.analysis.arms_raised ? 'orange' : 'gray'}>
                    {t('arms')}: {result.pose.analysis.arms_raised ? t('raised') : t('down')}
                  </Badge>
                  <Badge variant="light" size="lg">
                    {result.pose.analysis.visible_keypoints}/{result.pose.analysis.total_keypoints} {t('keypoints')}
                  </Badge>
                </Group>

                {/* Expandable keypoints table */}
                <Paper withBorder p="md" radius="md">
                  <Group
                    justify="space-between"
                    style={{ cursor: 'pointer' }}
                    onClick={() => setShowKeypoints(!showKeypoints)}
                  >
                    <Text fw={600}>{t('keypointsTable')}</Text>
                    {showKeypoints ? <IconChevronDown size={18} /> : <IconChevronRight size={18} />}
                  </Group>
                  <Collapse expanded={showKeypoints}>
                    <Table striped highlightOnHover mt="sm">
                      <Table.Thead>
                        <Table.Tr>
                          <Table.Th>Name</Table.Th>
                          <Table.Th>X</Table.Th>
                          <Table.Th>Y</Table.Th>
                          <Table.Th>Z</Table.Th>
                          <Table.Th>Visibility</Table.Th>
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {result.pose.keypoints.map((kp, idx) => (
                          <Table.Tr key={idx}>
                            <Table.Td><Text size="sm">{kp.name}</Text></Table.Td>
                            <Table.Td><Text size="xs" ff="monospace">{kp.x.toFixed(1)}</Text></Table.Td>
                            <Table.Td><Text size="xs" ff="monospace">{kp.y.toFixed(1)}</Text></Table.Td>
                            <Table.Td><Text size="xs" ff="monospace">{kp.z.toFixed(3)}</Text></Table.Td>
                            <Table.Td>
                              <Badge
                                variant="light"
                                size="sm"
                                color={kp.visibility > 0.5 ? 'green' : 'gray'}
                              >
                                {(kp.visibility * 100).toFixed(0)}%
                              </Badge>
                            </Table.Td>
                          </Table.Tr>
                        ))}
                      </Table.Tbody>
                    </Table>
                  </Collapse>
                </Paper>
              </Stack>
            )}
          </Paper>
        </>
      )}
    </DashboardShell>
  );
}
