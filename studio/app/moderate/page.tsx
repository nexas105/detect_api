'use client';

import React, { useCallback, useRef, useState } from 'react';
import {
  Alert,
  Badge,
  Box,
  Button,
  Collapse,
  Group,
  Paper,
  Stack,
  Table,
  Text,
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
import { DetectionFrame } from '@/components/DetectionFrame';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { ProcessingQueue } from '@/components/ProcessingQueue/ProcessingQueue';
import { ClipAnalysisCards } from '@/components/ClipAnalysisCards';
import { API_URL } from '@/lib/auth';
import { useApiKeys } from '@/lib/use-api-keys';
import { ApiKeySelect } from '@/components/ApiKeySelect';
import { colorForLabel } from '@/lib/detection-draw';
import type { ModerateResult } from '@/lib/api-types';

const ACCEPTED_IMAGE = '.jpg,.jpeg,.png,.webp';

type Verdict = ModerateResult['action'];

// Verdict trio — functional domain signal (see DESIGN_SPEC). Mantine scale + CSS var.
const VERDICT: Record<Verdict, { color: string; cssVar: string }> = {
  allow: { color: 'allow', cssVar: 'var(--verdict-allow)' },
  flag: { color: 'flag', cssVar: 'var(--verdict-flag)' },
  block: { color: 'block', cssVar: 'var(--verdict-block)' },
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
    <Text className="data-mono" fz={11} fw={600} tt="uppercase" lts={1.5} c="dimmed">
      {children}
    </Text>
  );
}

/** Calibrated meter — hairline track + colored fill, mono readout. */
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
      setResult((await res.json()) as ModerateResult);
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
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

  const verdict = result ? VERDICT[result.action] : null;

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
            label={t('apiKey')}
            placeholder={t('selectKey')}
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
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setResult(null);
                setError('');
              }}
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

      <ProcessingQueue isProcessing={loading} status={t('analyzing')} onCancel={handleCancel} startTime={startTime} />

      {keysError && (
        <Alert icon={<IconAlertCircle size={16} />} color="orange" mb="xl" title="API Keys">
          {keysError}
        </Alert>
      )}

      {error && (
        <Alert icon={<IconAlertCircle size={16} />} color="block" mb="xl" title="Error">
          {error}
        </Alert>
      )}

      {result && verdict && (
        <>
          {/* Verdict hero — the heart of the page, framed by the signature bracket. */}
          <DetectionFrame color={verdict.cssVar} size={16} inset={-4} weight={2}>
            <Paper withBorder p="xl" mb="xl" style={{ background: 'var(--surface)' }}>
              <Eyebrow>Verdict</Eyebrow>
              <Group justify="space-between" align="flex-end" wrap="wrap" gap="lg" mt={6} mb="md">
                <Text
                  className="data-mono"
                  fw={600}
                  lh={1}
                  style={{ fontSize: 'clamp(40px, 8vw, 60px)', color: verdict.cssVar }}
                >
                  {result.action.toUpperCase()}
                </Text>
                <Group gap="xl" wrap="wrap">
                  <Stack gap={2}>
                    <Text className="data-mono" fz={24} fw={600}>
                      {(result.confidence * 100).toFixed(1)}%
                    </Text>
                    <Text className="data-mono" fz={10} tt="uppercase" lts={1} c="dimmed">
                      {t('confidence')}
                    </Text>
                  </Stack>
                  <Stack gap={2}>
                    <Text className="data-mono" fz={24} fw={600}>
                      {(result.summary.nudity_score * 100).toFixed(1)}%
                    </Text>
                    <Text className="data-mono" fz={10} tt="uppercase" lts={1} c="dimmed">
                      {t('nudityScore')}
                    </Text>
                  </Stack>
                </Group>
              </Group>
              {/* Status bar — verdict-colored strip. */}
              <Box h={6} style={{ borderRadius: 3, background: verdict.cssVar }} />
            </Paper>
          </DetectionFrame>

          {/* Reasons */}
          {result.reasons.length > 0 && (
            <Stack gap="xs" mb="xl">
              {result.reasons.map((reason, idx) => (
                <Alert key={idx} color={verdict.color} variant="light" icon={<IconAlertCircle size={16} />}>
                  {reason}
                </Alert>
              ))}
            </Stack>
          )}

          {/* Collapsible: Detections */}
          <Paper withBorder p="md" mb="md">
            <Group justify="space-between" style={{ cursor: 'pointer' }} onClick={() => setShowDetections(!showDetections)}>
              <Group gap="xs">
                <Eyebrow>{t('detections')}</Eyebrow>
                <Text className="data-mono" size="sm" c="dimmed">
                  ({result.detections.length})
                </Text>
              </Group>
              {showDetections ? <IconChevronDown size={18} /> : <IconChevronRight size={18} />}
            </Group>
            <Collapse expanded={showDetections}>
              {result.detections.length > 0 ? (
                <Table highlightOnHover mt="sm">
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
              ) : (
                <Text c="dimmed" size="sm" mt="sm">
                  No detections
                </Text>
              )}
            </Collapse>
          </Paper>

          {/* Collapsible: Rating */}
          {result.rating && (
            <Paper withBorder p="md" mb="md">
              <Group justify="space-between" style={{ cursor: 'pointer' }} onClick={() => setShowRating(!showRating)}>
                <Eyebrow>{t('rating')}</Eyebrow>
                {showRating ? <IconChevronDown size={18} /> : <IconChevronRight size={18} />}
              </Group>
              <Collapse expanded={showRating}>
                <Stack gap="md" mt="sm">
                  <Group gap="xs">
                    <Badge className="data-mono" variant="light" size="lg" color="cyan">
                      {t('score')}: {Math.round((result.rating.score ?? 0) * 100)}%
                    </Badge>
                    <Badge className="data-mono" variant="light" color={result.rating.category === 'safe' ? 'allow' : 'flag'}>
                      {result.rating.category}
                    </Badge>
                  </Group>
                  {result.rating.description && (
                    <Text size="sm" c="dimmed">
                      {result.rating.description}
                    </Text>
                  )}
                  {/* Rating factors as calibrated meters. */}
                  {result.rating.factors && (
                    <Stack gap="sm">
                      {Object.entries(result.rating.factors).map(([key, factor]) => (
                        <Meter
                          key={key}
                          label={FACTOR_LABELS[key] || key}
                          value={factor.score}
                          weight={factor.weight}
                        />
                      ))}
                    </Stack>
                  )}
                </Stack>
              </Collapse>
            </Paper>
          )}

          {/* Collapsible: CLIP Analysis */}
          {result.clip_analysis && (
            <Paper withBorder p="md" mb="xl">
              <Group justify="space-between" style={{ cursor: 'pointer' }} onClick={() => setShowClip(!showClip)}>
                <Eyebrow>{t('clipAnalysis')}</Eyebrow>
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
