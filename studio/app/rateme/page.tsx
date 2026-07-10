'use client';

import React, { useCallback, useRef, useState } from 'react';
import {
  Alert,
  Badge,
  Box,
  Button,
  Group,
  Paper,
  RingProgress,
  SimpleGrid,
  Stack,
  Table,
  Text,
} from '@mantine/core';
import {
  IconAlertCircle,
  IconAlertTriangle,
  IconDownload,
  IconFileUpload,
  IconStars,
} from '@tabler/icons-react';
import { useTranslations } from 'next-intl';
import { DashboardShell } from '@/components/DashboardShell/DashboardShell';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { ClipAnalysisCards } from '@/components/ClipAnalysisCards';
import { ApiKeySelect } from '@/components/ApiKeySelect';
import { API_URL } from '@/lib/auth';
import { useApiKeys } from '@/lib/use-api-keys';
import { colorForLabel } from '@/lib/detection-draw';
import type { RateMeResult } from '@/lib/api-types';

const ACCEPTED_IMAGE = '.jpg,.jpeg,.png,.webp';

const CATEGORY_COLORS: Record<string, string> = {
  safe: 'allow',
  mild: 'teal',
  suggestive: 'flag',
  erotic: 'orange',
  explicit: 'block',
  extreme: 'grape',
};

const FACTOR_LABELS: Record<string, string> = {
  eroticism: 'Eroticism',
  clip_sexiness: 'CLIP Sexiness',
  image_quality: 'Image Quality',
  composition: 'Composition',
  aesthetics: 'Aesthetics',
  age_attractiveness: 'Age Attractiveness',
};

/** Section eyebrow — uppercase mono, per DESIGN_SPEC. */
function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <Text className="data-mono" fz={11} fw={600} tt="uppercase" lts={1.5} c="dimmed" mb="md">
      {children}
    </Text>
  );
}

/** Calibrated meter — hairline track + cyan fill, mono readout. */
function Meter({ label, value, weight }: { label: string; value: number; weight?: number }) {
  const pct = Math.round((value ?? 0) * 100);
  return (
    <div>
      <Group justify="space-between" mb={4} wrap="nowrap">
        <Text size="sm">{label}</Text>
        <Group gap="sm" wrap="nowrap">
          {weight !== undefined && (
            <Text className="data-mono" fz={11} c="dimmed">
              w {weight}
            </Text>
          )}
          <Text className="data-mono" size="sm" fw={600}>
            {pct}%
          </Text>
        </Group>
      </Group>
      <Box h={6} style={{ background: 'var(--surface-2)', borderRadius: 3, overflow: 'hidden' }}>
        <Box
          h={6}
          style={{
            width: `${Math.max(2, pct)}%`,
            background: 'var(--mantine-color-cyan-5)',
            borderRadius: 3,
            transition: 'width 200ms ease',
          }}
        />
      </Box>
    </div>
  );
}

/** Detection label with its bounding-box color as a dot (shared color map). */
function LabelDot({ label }: { label: string }) {
  return (
    <Group gap={6} wrap="nowrap">
      <Box w={7} h={7} style={{ borderRadius: 2, background: colorForLabel(label), flexShrink: 0 }} />
      <Text className="data-mono" size="sm">
        {label}
      </Text>
    </Group>
  );
}

export default function RateMePage() {
  const { keys, selectedKey, setSelectedKey, selectedKeyId, selectKey } = useApiKeys();
  const t = useTranslations('rateme');
  const tUpload = useTranslations('upload');
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<RateMeResult | null>(null);
  const [downloading, setDownloading] = useState(false);

  const handleDownloadResult = useCallback(async () => {
    if (!file || !result) return;
    setDownloading(true);
    try {
      const { generateResultImage, downloadResultBlob } = await import('@/lib/result-image');
      const blob = await generateResultImage(file, result, 'rateme');
      downloadResultBlob(blob);
    } catch (err) {
      console.error('Failed to generate result image', err);
    } finally {
      setDownloading(false);
    }
  }, [file, result]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFile(e.target.files?.[0] ?? null);
    setResult(null);
    setError('');
  };

  const handleRate = useCallback(async () => {
    if (!file || !selectedKey.trim()) return;
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`${API_URL}/rateme`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${selectedKey.trim()}` },
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Request failed (${res.status})`);
      }
      setResult((await res.json()) as RateMeResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rating failed');
    } finally {
      setLoading(false);
    }
  }, [file, selectedKey]);

  const scorePercent = result ? Math.round(result.rating.score * 100) : 0;
  const categoryColor = result ? CATEGORY_COLORS[result.rating.category] || 'cyan' : 'cyan';

  return (
    <DashboardShell>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />

      <Paper withBorder p="lg" mb="xl">
        <Stack>
          {/* API Key selection */}
          <ApiKeySelect
            keys={keys}
            selectedKey={selectedKey}
            setSelectedKey={setSelectedKey}
            selectedKeyId={selectedKeyId}
            selectKey={selectKey}
            label={tUpload('apiKey')}
            placeholder={tUpload('selectKey')}
          />

          {/* File picker */}
          <div>
            <Text size="sm" fw={500} mb={4}>
              File
            </Text>
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPTED_IMAGE}
              onChange={handleFileChange}
              style={{ display: 'none' }}
            />
            <Group>
              <Button variant="light" leftSection={<IconFileUpload size={16} />} onClick={() => fileRef.current?.click()}>
                {file ? 'Change file' : 'Choose file'}
              </Button>
              {file && (
                <Text className="data-mono" size="sm" c="dimmed">
                  {file.name} ({(file.size / 1024).toFixed(1)} KB)
                </Text>
              )}
            </Group>
            <Text size="xs" c="dimmed" mt={4}>
              Supported: JPG, PNG, WebP
            </Text>
          </div>

          {/* Rate button */}
          <Button
            leftSection={<IconStars size={16} />}
            onClick={handleRate}
            loading={loading}
            disabled={!file || !selectedKey.trim()}
            fullWidth
          >
            Rate
          </Button>
        </Stack>
      </Paper>

      {/* Error */}
      {error && (
        <Alert icon={<IconAlertCircle size={16} />} color="block" mb="xl" title="Error">
          {error}
        </Alert>
      )}

      {/* Results */}
      {result && (
        <React.Fragment>
          {result.rating.category === 'blocked' && (
            <Alert icon={<IconAlertTriangle size={16} />} color="block" mb="xl" title="Minor Detected" variant="filled">
              Minor detected — scoring disabled. This image has been flagged and the score was forced to 0.
            </Alert>
          )}
          <Group justify="flex-end" mb="md">
            <Button variant="light" color="cyan" leftSection={<IconDownload size={16} />} onClick={handleDownloadResult} loading={downloading}>
              Download Result Image
            </Button>
          </Group>

          {/* Score + Category */}
          <Paper withBorder p="lg" mb="xl">
            <Group justify="space-between" mb="md">
              <Eyebrow>Rating Result</Eyebrow>
              <Group gap="xs">
                {result.models.map((m) => (
                  <Badge key={m} className="data-mono" variant="light" color="cyan">
                    {m}
                  </Badge>
                ))}
              </Group>
            </Group>

            <Group justify="center" gap="xl" mb="md">
              <RingProgress
                size={160}
                thickness={14}
                roundCaps
                sections={[{ value: scorePercent, color: categoryColor }]}
                label={
                  <Text className="data-mono" ta="center" fw={700} fz={28}>
                    {scorePercent}%
                  </Text>
                }
              />
              <Stack gap="xs" style={{ minWidth: 160 }}>
                <Badge className="data-mono" size="xl" color={categoryColor} variant="filled">
                  {result.rating.category}
                </Badge>
                <Text size="sm" c="dimmed">
                  {result.rating.description}
                </Text>
              </Stack>
            </Group>
          </Paper>

          {/* Factor meters */}
          <Paper withBorder p="lg" mb="xl">
            <Eyebrow>Rating Factors</Eyebrow>
            <Stack gap="md">
              {Object.entries(result.rating.factors).map(([key, factor]) => (
                <Meter key={key} label={FACTOR_LABELS[key] || key} value={factor.score} weight={factor.weight} />
              ))}
            </Stack>
          </Paper>

          {/* Eroticism breakdown table */}
          {result.rating.factors.eroticism.breakdown.length > 0 && (
            <Paper withBorder p="lg" mb="xl">
              <Eyebrow>Eroticism Breakdown</Eyebrow>
              <Table highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Label</Table.Th>
                    <Table.Th>Confidence</Table.Th>
                    <Table.Th>Weight</Table.Th>
                    <Table.Th>Contribution</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {result.rating.factors.eroticism.breakdown.map((item, idx) => (
                    <Table.Tr key={idx}>
                      <Table.Td>
                        <LabelDot label={item.label} />
                      </Table.Td>
                      <Table.Td>
                        <Text className="data-mono" size="sm">
                          {(item.confidence * 100).toFixed(1)}%
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Text className="data-mono" size="sm">
                          {item.weight.toFixed(2)}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Text className="data-mono" size="sm">
                          {item.contribution.toFixed(3)}
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Paper>
          )}

          {/* CLIP Sexiness */}
          <Paper withBorder p="lg" mb="xl">
            <Eyebrow>CLIP Sexiness</Eyebrow>
            {!result.rating.factors.clip_sexiness.available ? (
              <Alert icon={<IconAlertCircle size={16} />} color="flag" variant="light">
                CLIP model is unavailable for this analysis.
              </Alert>
            ) : result.rating.factors.clip_sexiness.top_prompts &&
              result.rating.factors.clip_sexiness.top_prompts.length > 0 ? (
              <Group gap="xs" wrap="wrap">
                {result.rating.factors.clip_sexiness.top_prompts.map((p, idx) => (
                  <Badge key={idx} className="data-mono" variant="light" color="cyan" size="lg">
                    {p.prompt} ({Math.round(p.similarity * 100)}%)
                  </Badge>
                ))}
              </Group>
            ) : (
              <Text size="sm" c="dimmed">
                No CLIP prompts available.
              </Text>
            )}
          </Paper>

          {/* Image Quality details */}
          <Paper withBorder p="lg" mb="xl">
            <Eyebrow>Image Quality</Eyebrow>
            <SimpleGrid cols={{ base: 2, xs: 4 }}>
              {(
                [
                  ['Resolution', result.rating.factors.image_quality.resolution],
                  ['Sharpness', result.rating.factors.image_quality.sharpness],
                  ['Brightness', result.rating.factors.image_quality.brightness],
                  ['Contrast', result.rating.factors.image_quality.contrast],
                ] as [string, number][]
              ).map(([label, value]) => (
                <Stack key={label} gap={2} ta="center">
                  <Text className="data-mono" fz={10} c="dimmed" tt="uppercase" lts={1}>
                    {label}
                  </Text>
                  <Text className="data-mono" fw={600} fz={26}>
                    {Math.round(value * 100)}%
                  </Text>
                </Stack>
              ))}
            </SimpleGrid>
          </Paper>

          {/* Composition */}
          <Paper withBorder p="lg" mb="xl">
            <Eyebrow>Composition</Eyebrow>
            <Group gap="md" wrap="wrap">
              <Badge variant="light" color={result.rating.factors.composition.has_face ? 'allow' : 'gray'} size="lg">
                {result.rating.factors.composition.has_face ? 'Face detected' : 'No face detected'}
              </Badge>
              <Badge className="data-mono" variant="light" color="cyan" size="lg">
                Aspect ratio: {result.rating.factors.composition.aspect_ratio.toFixed(2)}
              </Badge>
              <Badge className="data-mono" variant="light" color="cyan" size="lg">
                Centering: {Math.round(result.rating.factors.composition.centering * 100)}%
              </Badge>
            </Group>
            {result.rating.factors.composition.pose && (
              <Stack gap={4} mt="md">
                <Text className="data-mono" size="sm" fw={500}>
                  Pose: {Math.round(result.rating.factors.composition.pose.score * 100)}%
                </Text>
                <Text size="sm" c="dimmed">
                  {result.rating.factors.composition.pose.details}
                </Text>
              </Stack>
            )}
          </Paper>

          {/* CLIP Analysis Cards */}
          <ClipAnalysisCards age={result.rating.age} deepfake={result.rating.deepfake} clothing={result.rating.clothing} />

          {/* Detections table */}
          {result.detections.length > 0 && (
            <Paper withBorder p="lg" mb="xl">
              <Eyebrow>Detections</Eyebrow>
              <Table highlightOnHover>
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
                      <Table.Td>
                        <LabelDot label={det.label} />
                      </Table.Td>
                      <Table.Td>
                        <Text className="data-mono" size="sm">
                          {(det.score * 100).toFixed(1)}%
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Text className="data-mono" size="xs" c="dimmed">
                          {det.box ? det.box.map((v) => v.toFixed(0)).join(', ') : '--'}
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Paper>
          )}
        </React.Fragment>
      )}
    </DashboardShell>
  );
}
