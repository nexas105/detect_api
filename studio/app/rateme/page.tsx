'use client';

import React from 'react';
import {
  Alert,
  Badge,
  Button,
  Group,
  Paper,
  Progress,
  RingProgress,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
} from '@mantine/core';
import {
  IconAlertCircle,
  IconAlertTriangle,
  IconDownload,
  IconFileUpload,
  IconStars,
} from '@tabler/icons-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { DashboardShell } from '@/components/DashboardShell/DashboardShell';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import {
  ClipAnalysisCards,
  AgeAnalysis,
  DeepfakeAnalysis,
  ClothingAnalysis,
} from '@/components/ClipAnalysisCards';
import { API_URL, AUTH_URL, useAuth } from '@/lib/auth';

interface ApiKeyOption {
  id: string;
  name: string;
  key: string;
  is_own: boolean;
  is_master: boolean;
}

const ACCEPTED_IMAGE = '.jpg,.jpeg,.png,.webp';

const CATEGORY_COLORS: Record<string, string> = {
  safe: 'green',
  mild: 'teal',
  suggestive: 'yellow',
  erotic: 'orange',
  explicit: 'red',
  extreme: 'grape',
};

const FACTOR_COLORS: Record<string, string> = {
  eroticism: 'red',
  clip_sexiness: 'violet',
  image_quality: 'blue',
  composition: 'teal',
  aesthetics: 'orange',
  age_attractiveness: 'pink',
};

const FACTOR_LABELS: Record<string, string> = {
  eroticism: 'Eroticism',
  clip_sexiness: 'CLIP Sexiness',
  image_quality: 'Image Quality',
  composition: 'Composition',
  aesthetics: 'Aesthetics',
  age_attractiveness: 'Age Attractiveness',
};

interface BreakdownItem {
  label: string;
  confidence: number;
  weight: number;
  contribution: number;
}

interface ClipPrompt {
  prompt: string;
  similarity: number;
  weight: number;
  contribution: number;
}

interface FactorBase {
  score: number;
  weight: number;
}

interface EroticismFactor extends FactorBase {
  breakdown: BreakdownItem[];
}

interface ClipSexinessFactor extends FactorBase {
  available: boolean;
  top_prompts?: ClipPrompt[];
}

interface ImageQualityFactor extends FactorBase {
  resolution: number;
  sharpness: number;
  brightness: number;
  contrast: number;
}

interface CompositionFactor extends FactorBase {
  has_face: boolean;
  aspect_ratio: number;
  centering: number;
  pose?: { score: number; details: string };
}

interface AestheticsFactor extends FactorBase {
  saturation: number;
  color_variety: number;
  noise_level: number;
}

interface RatingFactors {
  eroticism: EroticismFactor;
  clip_sexiness: ClipSexinessFactor;
  image_quality: ImageQualityFactor;
  composition: CompositionFactor;
  aesthetics: AestheticsFactor;
}

interface AgeAttractiveFactor extends FactorBase {
  estimated_age?: number;
  available?: boolean;
}

interface Rating {
  score: number;
  category: string;
  description: string;
  factors: RatingFactors & { age_attractiveness?: AgeAttractiveFactor };
  age?: AgeAnalysis;
  deepfake?: DeepfakeAnalysis;
  clothing?: ClothingAnalysis;
}

interface Detection {
  label: string;
  score: number;
  box?: number[];
}

interface RateMeResult {
  models: string[];
  rating: Rating;
  detections: Detection[];
}

export default function RateMePage() {
  const { authFetch } = useAuth();
  const t = useTranslations('rateme');
  const tUpload = useTranslations('upload');
  const tCommon = useTranslations('common');
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [selectedKeyId, setSelectedKeyId] = useState<string | null>(null);
  const [apiKeys, setApiKeys] = useState<ApiKeyOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<RateMeResult | null>(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    authFetch(`${AUTH_URL}/api-keys`)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data) => {
        const keys: ApiKeyOption[] = (data.keys || data).map((k: any) => ({
          id: k.id,
          name: k.name,
          key: k.key,
          is_own: k.is_own ?? true,
          is_master: k.is_master,
        }));
        setApiKeys(keys);
        const ownKeys = keys.filter((k) => k.is_own && !k.key.endsWith('...'));
        if (ownKeys.length >= 1) {
          setSelectedKeyId(ownKeys[0].id);
          setApiKey(ownKeys[0].key);
        } else if (keys.length === 1) {
          setSelectedKeyId(keys[0].id);
        }
      })
      .catch(() => {});
  }, [authFetch]);

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
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    setResult(null);
    setError('');
  };

  const handleRate = useCallback(async () => {
    if (!file || !apiKey.trim()) return;
    setLoading(true);
    setError('');
    setResult(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch(`${API_URL}/rateme`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey.trim()}` },
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Request failed (${res.status})`);
      }

      const data: RateMeResult = await res.json();
      setResult(data);
    } catch (err: any) {
      setError(err.message || 'Rating failed');
    } finally {
      setLoading(false);
    }
  }, [file, apiKey]);

  const scorePercent = result ? Math.round(result.rating.score * 100) : 0;
  const categoryColor = result
    ? CATEGORY_COLORS[result.rating.category] || 'gray'
    : 'gray';

  return (
    <DashboardShell>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />

      <Paper withBorder p="lg" radius="md" mb="xl">
        <Stack>
          {/* API Key selection */}
          <Paper withBorder p="sm" radius="md">
            <Text size="sm" fw={500} mb={4}>
              {tUpload('apiKey')} <Text span c="red">*</Text>
            </Text>
            <Select
              placeholder={tUpload('selectKey')}
              data={apiKeys.map((k) => ({
                value: k.id,
                label: `${k.name}${k.is_master ? ' [master]' : ''} — ${k.is_own && !k.key.endsWith('...') ? 'ready' : k.key}`,
              }))}
              value={selectedKeyId}
              onChange={(val) => {
                setSelectedKeyId(val);
                const selected = apiKeys.find((k) => k.id === val);
                if (selected && selected.is_own && !selected.key.endsWith('...')) {
                  setApiKey(selected.key);
                }
              }}
              clearable
              mb="xs"
            />
            {selectedKeyId && apiKey && (
              <Text size="xs" c="green" mb="xs">
                API key auto-filled.
              </Text>
            )}
            <TextInput
              placeholder="Paste your full API key (ehk_...)"
              value={apiKey}
              onChange={(e) => setApiKey(e.currentTarget.value)}
            />
          </Paper>

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
              <Button
                variant="light"
                leftSection={<IconFileUpload size={16} />}
                onClick={() => fileRef.current?.click()}
              >
                {file ? 'Change file' : 'Choose file'}
              </Button>
              {file && (
                <Text size="sm" c="dimmed">
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
            disabled={!file || !apiKey.trim()}
            fullWidth
          >
            Rate
          </Button>
        </Stack>
      </Paper>

      {/* Error */}
      {error && (
        <Alert
          icon={<IconAlertCircle size={16} />}
          color="red"
          mb="xl"
          title="Error"
        >
          {error}
        </Alert>
      )}

      {/* Results */}
      {result && (
        <React.Fragment>
          {result.rating.category === 'blocked' && (
            <Alert
              icon={<IconAlertTriangle size={16} />}
              color="red"
              mb="xl"
              title="Minor Detected"
              variant="filled"
            >
              Minor detected — scoring disabled. This image has been flagged and the score was forced to 0.
            </Alert>
          )}
          <Group justify="flex-end" mb="md">
            <Button
              variant="light"
              color="violet"
              leftSection={<IconDownload size={16} />}
              onClick={handleDownloadResult}
              loading={downloading}
            >
              Download Result Image
            </Button>
          </Group>
          {/* Score + Category */}
          <Paper withBorder p="lg" radius="md" mb="xl">
            <Group justify="space-between" mb="md">
              <Text fw={600} fz="lg">
                Rating Result
              </Text>
              <Group gap="xs">
                {result.models.map((m) => (
                  <Badge key={m} variant="light" color="violet">
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
                  <Text ta="center" fw={700} fz="xl">
                    {scorePercent}%
                  </Text>
                }
              />
              <Stack gap="xs" style={{ minWidth: 160 }}>
                <Badge
                  size="xl"
                  color={categoryColor}
                  variant="filled"
                  radius="md"
                >
                  {result.rating.category}
                </Badge>
                <Text size="sm" c="dimmed">
                  {result.rating.description}
                </Text>
              </Stack>
            </Group>
          </Paper>

          {/* Factor bars */}
          <Paper withBorder p="lg" radius="md" mb="xl">
            <Text fw={600} fz="lg" mb="md">
              Rating Factors
            </Text>
            <Stack gap="sm">
              {Object.entries(result.rating.factors).map(([key, factor]) => (
                <div key={key}>
                  <Group justify="space-between" mb={4}>
                    <Text size="sm" fw={500}>
                      {FACTOR_LABELS[key] || key}
                    </Text>
                    <Group gap="xs">
                      <Text size="xs" c="dimmed">
                        weight: {factor.weight}
                      </Text>
                      <Text size="sm" fw={600}>
                        {Math.round(factor.score * 100)}%
                      </Text>
                    </Group>
                  </Group>
                  <Progress
                    value={factor.score * 100}
                    color={FACTOR_COLORS[key] || 'gray'}
                    size="md"
                    radius="xl"
                  />
                </div>
              ))}
            </Stack>
          </Paper>

          {/* Eroticism breakdown table */}
          {result.rating.factors.eroticism.breakdown.length > 0 && (
            <Paper withBorder p="lg" radius="md" mb="xl">
              <Text fw={600} fz="lg" mb="md">
                Eroticism Breakdown
              </Text>
              <Table striped highlightOnHover>
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
                        <Badge variant="light" size="sm">
                          {item.label}
                        </Badge>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm">
                          {(item.confidence * 100).toFixed(1)}%
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm">{item.weight.toFixed(2)}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm">{item.contribution.toFixed(3)}</Text>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Paper>
          )}

          {/* CLIP Sexiness */}
          <Paper withBorder p="lg" radius="md" mb="xl">
            <Text fw={600} fz="lg" mb="md">
              CLIP Sexiness
            </Text>
            {!result.rating.factors.clip_sexiness.available ? (
              <Alert
                icon={<IconAlertCircle size={16} />}
                color="yellow"
                variant="light"
              >
                CLIP model is unavailable for this analysis.
              </Alert>
            ) : result.rating.factors.clip_sexiness.top_prompts &&
              result.rating.factors.clip_sexiness.top_prompts.length > 0 ? (
              <Group gap="xs" wrap="wrap">
                {result.rating.factors.clip_sexiness.top_prompts.map(
                  (p, idx) => (
                    <Badge
                      key={idx}
                      variant="light"
                      color="violet"
                      size="lg"
                      radius="md"
                    >
                      {p.prompt} ({Math.round(p.similarity * 100)}%)
                    </Badge>
                  )
                )}
              </Group>
            ) : (
              <Text size="sm" c="dimmed">
                No CLIP prompts available.
              </Text>
            )}
          </Paper>

          {/* Image Quality details */}
          <Paper withBorder p="lg" radius="md" mb="xl">
            <Text fw={600} fz="lg" mb="md">
              Image Quality
            </Text>
            <SimpleGrid cols={4}>
              {(
                [
                  ['Resolution', result.rating.factors.image_quality.resolution],
                  ['Sharpness', result.rating.factors.image_quality.sharpness],
                  [
                    'Brightness',
                    result.rating.factors.image_quality.brightness,
                  ],
                  ['Contrast', result.rating.factors.image_quality.contrast],
                ] as [string, number][]
              ).map(([label, value]) => (
                <Stack key={label} gap={2} ta="center">
                  <Text size="xs" c="dimmed" tt="uppercase">
                    {label}
                  </Text>
                  <Text fw={700} fz="lg">
                    {Math.round(value * 100)}%
                  </Text>
                </Stack>
              ))}
            </SimpleGrid>
          </Paper>

          {/* Composition */}
          <Paper withBorder p="lg" radius="md" mb="xl">
            <Text fw={600} fz="lg" mb="md">
              Composition
            </Text>
            <Group gap="md" wrap="wrap">
              <Badge
                variant="light"
                color={
                  result.rating.factors.composition.has_face ? 'green' : 'gray'
                }
                size="lg"
              >
                {result.rating.factors.composition.has_face
                  ? 'Face detected'
                  : 'No face detected'}
              </Badge>
              <Badge variant="light" color="teal" size="lg">
                Aspect ratio: {result.rating.factors.composition.aspect_ratio.toFixed(2)}
              </Badge>
              <Badge variant="light" color="teal" size="lg">
                Centering: {Math.round(result.rating.factors.composition.centering * 100)}%
              </Badge>
            </Group>
            {result.rating.factors.composition.pose && (
              <Stack gap={4} mt="md">
                <Text size="sm" fw={500}>
                  Pose: {Math.round(result.rating.factors.composition.pose.score * 100)}%
                </Text>
                <Text size="sm" c="dimmed">
                  {result.rating.factors.composition.pose.details}
                </Text>
              </Stack>
            )}
          </Paper>

          {/* CLIP Analysis Cards */}
          <ClipAnalysisCards
            age={result.rating.age}
            deepfake={result.rating.deepfake}
            clothing={result.rating.clothing}
          />

          {/* Detections table */}
          {result.detections.length > 0 && (
            <Paper withBorder p="lg" radius="md" mb="xl">
              <Text fw={600} fz="lg" mb="md">
                Detections
              </Text>
              <Table striped highlightOnHover>
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
                        <Badge variant="light" size="sm">
                          {det.label}
                        </Badge>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm">
                          {(det.score * 100).toFixed(1)}%
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="xs" c="dimmed" ff="monospace">
                          {det.box
                            ? det.box.map((v) => v.toFixed(0)).join(', ')
                            : '--'}
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
