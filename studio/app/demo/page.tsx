'use client';

import React from 'react';
import {
  Alert,
  Anchor,
  Badge,
  Box,
  Button,
  Center,
  Collapse,
  Container,
  Group,
  Image,
  Loader,
  Paper,
  Progress,
  Radio,
  RingProgress,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import {
  IconAlertCircle,
  IconAlertTriangle,
  IconChevronDown,
  IconChevronRight,
  IconDownload,
  IconEyeOff,
  IconFileUpload,
  IconLock,
  IconShieldCheck,
  IconTag,
  IconUpload,
  IconUserOff,
} from '@tabler/icons-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { LanguageToggle } from '@/components/LanguageToggle/LanguageToggle';
import { ColorSchemeToggleButton } from '@/components/ColorSchemeToggleButton/ColorSchemeToggleButton';
import {
  ClipAnalysisCards,
  AgeAnalysis,
  DeepfakeAnalysis,
  ClothingAnalysis,
} from '@/components/ClipAnalysisCards';

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

interface RateMeRating {
  score: number;
  category: string;
  description: string;
  factors: RatingFactors & { age_attractiveness?: AgeAttractiveFactor };
  age?: AgeAnalysis;
  deepfake?: DeepfakeAnalysis;
  clothing?: ClothingAnalysis;
}

interface RateMeResult {
  models: string[];
  rating: RateMeRating;
  detections: Detection[];
  demo?: boolean;
  limits?: DemoLimits;
}

import { API_URL } from '@/lib/auth';

const ACCEPTED_IMAGE = '.jpg,.jpeg,.png,.webp';
const ACCEPTED_ARCHIVE = '.zip';
const ACCEPTED_VIDEO = '.mp4,.avi,.mov,.mkv,.webm';
const ACCEPTED_ALL = `${ACCEPTED_IMAGE},${ACCEPTED_ARCHIVE},${ACCEPTED_VIDEO}`;

interface Detection {
  label: string;
  score: number;
  box?: number[];
  model?: string;
}

function iou(a: number[], b: number[]): number {
  const [ax, ay, aw, ah] = a;
  const [bx, by, bw, bh] = b;
  const x1 = Math.max(ax, bx), y1 = Math.max(ay, by);
  const x2 = Math.min(ax + aw, bx + bw), y2 = Math.min(ay + ah, by + bh);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = aw * ah + bw * bh - inter;
  return union > 0 ? inter / union : 0;
}

function mergeDetections(nnDets: Detection[], exDets: Detection[]): Detection[] {
  const merged = [...nnDets];
  for (const exDet of exDets) {
    const isDuplicate = merged.some(
      (m) =>
        m.label === exDet.label &&
        m.box &&
        exDet.box &&
        iou(m.box, exDet.box) > 0.3
    );
    if (!isDuplicate) {
      merged.push(exDet);
    }
  }
  return merged.sort((a, b) => b.score - a.score);
}

interface SingleResult {
  model?: string;
  detections: Detection[];
  age?: AgeAnalysis;
  deepfake?: DeepfakeAnalysis;
  clothing?: ClothingAnalysis;
  demo?: boolean;
  limits?: DemoLimits;
}

interface BatchFileResult {
  filename: string;
  image_id?: string;
  detections?: Detection[];
  error?: string;
}

interface BatchResult {
  model: string;
  total: number;
  processed: number;
  results: BatchFileResult[];
  demo?: boolean;
  limits?: DemoLimits;
}

interface VideoFrameResult {
  timestamp: number;
  detections: Detection[];
}

interface VideoSummary {
  total_detections: number;
  labels_found: Record<string, number>;
  max_score: number;
  nsfw_frames: number;
  nsfw_percentage: number;
}

interface VideoResult {
  video_id: string;
  model: string;
  video_info: { duration: number; fps: number; width: number; height: number };
  settings: { analyze_fps: number; max_frames: number; frames_analyzed: number };
  frames: VideoFrameResult[];
  summary: VideoSummary;
  demo?: boolean;
  limits?: DemoLimits;
}

interface DemoLimits {
  images_remaining: number;
  archives_remaining: number;
  reset_seconds?: number;
}

type ResultData =
  | { type: 'single'; data: SingleResult }
  | { type: 'batch'; data: BatchResult }
  | { type: 'video'; data: VideoResult };

export default function DemoPage() {
  const t = useTranslations('demo');
  const tCommon = useTranslations('common');
  const tAuth = useTranslations('auth');
  const isMobile = useMediaQuery('(max-width: 500px)');
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [model, setModel] = useState('nudenet');
  const [mode, setMode] = useState<'classify' | 'rateme' | 'censor' | 'moderate' | 'tag' | 'anonymize'>('classify');
  const [demoLabels, setDemoLabels] = useState('');
  const [moderateResult, setModerateResult] = useState<any>(null);
  const [tagResult, setTagResult] = useState<any>(null);
  const [anonymizePreviewUrl, setAnonymizePreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ResultData | null>(null);
  const [rateMeResult, setRateMeResult] = useState<RateMeResult | null>(null);
  const [limits, setLimits] = useState<DemoLimits | null>(null);
  const [limitsLoading, setLimitsLoading] = useState(true);
  const [expandedFile, setExpandedFile] = useState<string | null>(null);
  const [expandedFrame, setExpandedFrame] = useState<number | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [censorPreviewUrl, setCensorPreviewUrl] = useState<string | null>(null);

  const handleDownloadResult = useCallback(async () => {
    if (!file) return;
    const resultData = mode === 'rateme' ? rateMeResult : result?.type === 'single' ? result.data : null;
    if (!resultData) return;
    setDownloading(true);
    try {
      const { generateResultImage, downloadResultBlob } = await import('@/lib/result-image');
      const downloadMode = mode === 'rateme' ? 'rateme' : 'classify';
      const blob = await generateResultImage(file, resultData, downloadMode);
      downloadResultBlob(blob);
    } catch (err) {
      console.error('Failed to generate result image', err);
    } finally {
      setDownloading(false);
    }
  }, [file, result, rateMeResult, mode]);

  // Fetch demo limits on load
  useEffect(() => {
    fetch(`${API_URL}/demo/limits`)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data) => setLimits(data))
      .catch(() => {})
      .finally(() => setLimitsLoading(false));
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    setResult(null);
    setRateMeResult(null);
    setModerateResult(null);
    setTagResult(null);
    setError('');
    if (censorPreviewUrl) {
      URL.revokeObjectURL(censorPreviewUrl);
      setCensorPreviewUrl(null);
    }
    if (anonymizePreviewUrl) {
      URL.revokeObjectURL(anonymizePreviewUrl);
      setAnonymizePreviewUrl(null);
    }
  };

  const handleModeChange = (value: string) => {
    setMode(value as typeof mode);
    setResult(null);
    setRateMeResult(null);
    setModerateResult(null);
    setTagResult(null);
    setError('');
    if (censorPreviewUrl) {
      URL.revokeObjectURL(censorPreviewUrl);
      setCensorPreviewUrl(null);
    }
    if (anonymizePreviewUrl) {
      URL.revokeObjectURL(anonymizePreviewUrl);
      setAnonymizePreviewUrl(null);
    }
  };

  const isArchive = (f: File) => /\.(zip)$/i.test(f.name);
  const isVideo = (f: File) => /\.(mp4|avi|mov|mkv|webm)$/i.test(f.name);

  const handleAnalyze = useCallback(async () => {
    if (!file) return;
    setLoading(true);
    setError('');
    setResult(null);
    setRateMeResult(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      // New demo modes: moderate, tag, anonymize
      if (mode === 'moderate') {
        const res = await fetch(`${API_URL}/demo/moderate`, { method: 'POST', body: formData });
        if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.detail || `Request failed (${res.status})`); }
        const data = await res.json();
        if (data.limits) setLimits(data.limits);
        setModerateResult(data);
        setLoading(false);
        return;
      }

      if (mode === 'tag') {
        if (demoLabels.trim()) formData.append('labels', demoLabels.trim());
        const res = await fetch(`${API_URL}/demo/tag`, { method: 'POST', body: formData });
        if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.detail || `Request failed (${res.status})`); }
        const data = await res.json();
        if (data.limits) setLimits(data.limits);
        setTagResult(data);
        setLoading(false);
        return;
      }

      if (mode === 'anonymize') {
        const res = await fetch(`${API_URL}/demo/anonymize`, { method: 'POST', body: formData });
        if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.detail || `Request failed (${res.status})`); }
        const blob = await res.blob();
        const facesFound = parseInt(res.headers.get('X-Faces-Found') || '0', 10);
        if (anonymizePreviewUrl) URL.revokeObjectURL(anonymizePreviewUrl);
        setAnonymizePreviewUrl(URL.createObjectURL(blob));
        setResult({ type: 'single', data: { detections: [], model: 'anonymize' } });
        setLoading(false);
        return;
      }

      // "Both" model for single-image classify or censor
      const useBoth = model === 'both' && !isVideo(file) && !isArchive(file) && mode !== 'rateme';

      if (useBoth) {
        const formData1 = new FormData();
        formData1.append('file', file);
        const formData2 = new FormData();
        formData2.append('file', file);

        const classifyBase = mode === 'censor' ? `${API_URL}/demo/classify` : `${API_URL}/demo/classify`;
        const [nnRes, exRes] = await Promise.all([
          fetch(`${classifyBase}?model=nudenet`, { method: 'POST', body: formData1 }),
          fetch(`${classifyBase}?model=erax`, { method: 'POST', body: formData2 }),
        ]);

        if (!nnRes.ok) {
          const err = await nnRes.json().catch(() => ({}));
          throw new Error(err.detail || `NudeNet request failed (${nnRes.status})`);
        }
        if (!exRes.ok) {
          const err = await exRes.json().catch(() => ({}));
          throw new Error(err.detail || `EraX request failed (${exRes.status})`);
        }

        const nnData: SingleResult = await nnRes.json();
        const exData: SingleResult = await exRes.json();

        // Update limits from whichever response has them
        if ((nnData as any).limits) setLimits((nnData as any).limits);
        else if ((exData as any).limits) setLimits((exData as any).limits);

        const nnDets = nnData.detections.map((d) => ({ ...d, model: 'nudenet' as string }));
        const exDets = exData.detections.map((d) => ({ ...d, model: 'erax' as string }));
        const merged = mergeDetections(nnDets, exDets);

        const mergedData: SingleResult = {
          ...nnData,
          model: 'both',
          detections: merged,
          age: nnData.age || exData.age,
          deepfake: nnData.deepfake || exData.deepfake,
          clothing: nnData.clothing || exData.clothing,
        };

        if (mode === 'censor') {
          setResult({ type: 'single', data: mergedData });
          if (mergedData.detections.length > 0) {
            try {
              const { generateCensorPreview } = await import('@/lib/censor-preview');
              const previewBlob = await generateCensorPreview(file, mergedData.detections);
              if (censorPreviewUrl) URL.revokeObjectURL(censorPreviewUrl);
              setCensorPreviewUrl(URL.createObjectURL(previewBlob));
            } catch (e) {
              console.error('Failed to generate censor preview', e);
            }
          }
        } else {
          setResult({ type: 'single', data: mergedData });
        }
      } else {
        // Single model path
        let endpoint: string;
        const actualModel = model === 'both' ? 'nudenet' : model;
        if (mode === 'rateme') {
          endpoint = `${API_URL}/demo/rateme`;
        } else if (mode === 'censor') {
          if (isVideo(file)) {
            endpoint = `${API_URL}/demo/video/classify?model=${actualModel}&fps=1&max_frames=20`;
          } else if (isArchive(file)) {
            endpoint = `${API_URL}/demo/batch?model=${actualModel}`;
          } else {
            endpoint = `${API_URL}/demo/classify?model=${actualModel}`;
          }
        } else if (isVideo(file)) {
          endpoint = `${API_URL}/demo/video/classify?model=${actualModel}&fps=1&max_frames=20`;
        } else if (isArchive(file)) {
          endpoint = `${API_URL}/demo/batch?model=${actualModel}`;
        } else {
          endpoint = `${API_URL}/demo/classify?model=${actualModel}`;
        }

        const res = await fetch(endpoint, {
          method: 'POST',
          body: formData,
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.detail || `Request failed (${res.status})`);
        }

        const data = await res.json();

        // Update limits from response
        if (data.limits) {
          setLimits(data.limits);
        }

        if (mode === 'rateme') {
          setRateMeResult(data as RateMeResult);
        } else if (mode === 'censor') {
          if (isVideo(file)) {
            setResult({ type: 'video', data: data as VideoResult });
          } else if (isArchive(file)) {
            setResult({ type: 'batch', data: data as BatchResult });
          } else {
            const singleData = data as SingleResult;
            setResult({ type: 'single', data: singleData });
            if (singleData.detections.length > 0) {
              try {
                const { generateCensorPreview } = await import('@/lib/censor-preview');
                const previewBlob = await generateCensorPreview(file, singleData.detections);
                if (censorPreviewUrl) URL.revokeObjectURL(censorPreviewUrl);
                setCensorPreviewUrl(URL.createObjectURL(previewBlob));
              } catch (e) {
                console.error('Failed to generate censor preview', e);
              }
            }
          }
        } else if (isVideo(file)) {
          setResult({ type: 'video', data: data as VideoResult });
        } else if (isArchive(file)) {
          setResult({ type: 'batch', data: data as BatchResult });
        } else {
          setResult({ type: 'single', data: data as SingleResult });
        }
      }
    } catch (err: any) {
      setError(err.message || 'Analysis failed');
    } finally {
      setLoading(false);
    }
  }, [file, model, mode, censorPreviewUrl, demoLabels]);

  const exhausted =
    limits &&
    limits.images_remaining <= 0 &&
    limits.archives_remaining <= 0;

  const lowLimits =
    limits &&
    (limits.images_remaining <= 2 || limits.archives_remaining <= 0);

  return (
    <Box
      style={{
        minHeight: '100vh',
        background: 'var(--mantine-color-dark-8)',
      }}
    >
      {/* Header */}
      <Box
        py="md"
        px={{ base: 'sm', sm: 'xl' }}
        style={{
          borderBottom: '1px solid var(--mantine-color-dark-5)',
        }}
      >
        <Group justify="space-between">
          <Group gap="xs">
            <IconLock size={24} color="var(--mantine-color-violet-5)" />
            <Title order={3} c="violet">
              EroHub Demo
            </Title>
          </Group>
          <Group gap="xs">
            <LanguageToggle />
            <ColorSchemeToggleButton />
            <Anchor href="/login" size="sm">
              {tAuth('signIn')}
            </Anchor>
          </Group>
        </Group>
      </Box>

      <Container size={640} py="xl" px={{ base: 'sm', sm: 'md' }}>
        <Title ta="center" order={2} mb={4}>
          {t('title')}
        </Title>
        <Text c="dimmed" size="sm" ta="center" mb="md">
          {t('subtitle')}
        </Text>

        <Center mb="xl">
          <SegmentedControl
            value={mode}
            onChange={handleModeChange}
            orientation={isMobile ? 'vertical' : 'horizontal'}
            fullWidth
            size="sm"
            data={[
              { label: t('classify'), value: 'classify' },
              { label: t('rateMe'), value: 'rateme' },
              { label: t('censor'), value: 'censor' },
              { label: t('moderate'), value: 'moderate' },
              { label: t('tag'), value: 'tag' },
              { label: t('anonymize'), value: 'anonymize' },
            ]}
          />
        </Center>

        {/* Rate limits */}
        {limitsLoading ? (
          <Center mb="xl">
            <Loader size="sm" />
          </Center>
        ) : limits ? (
          <Paper withBorder p="md" radius="md" mb="xl">
            <Group justify="space-between" mb="xs">
              <Text size="sm" fw={500}>
                Remaining demo usage
              </Text>
              {limits.reset_seconds != null && (
                <Text size="xs" c="dimmed">
                  Resets in {Math.ceil(limits.reset_seconds / 60)} min
                </Text>
              )}
            </Group>
            <Group grow>
              <Stack gap={4}>
                <Text size="xs" c="dimmed">
                  Images
                </Text>
                <Progress
                  value={Math.min(limits.images_remaining * 10, 100)}
                  color={limits.images_remaining <= 2 ? 'orange' : 'violet'}
                  size="sm"
                />
                <Text size="xs" fw={500}>
                  {limits.images_remaining} remaining
                </Text>
              </Stack>
              <Stack gap={4}>
                <Text size="xs" c="dimmed">
                  Archives
                </Text>
                <Progress
                  value={Math.min(limits.archives_remaining * 20, 100)}
                  color={limits.archives_remaining <= 1 ? 'orange' : 'violet'}
                  size="sm"
                />
                <Text size="xs" fw={500}>
                  {limits.archives_remaining} remaining
                </Text>
              </Stack>
            </Group>
          </Paper>
        ) : null}

        {/* Low limits warning */}
        {lowLimits && !exhausted && (
          <Alert color="orange" mb="xl" icon={<IconAlertCircle size={16} />}>
            You are running low on demo usage.{' '}
            <Anchor href="/register" fw={500}>
              Create a free account
            </Anchor>{' '}
            for higher limits.
          </Alert>
        )}

        {/* Exhausted CTA */}
        {exhausted && (
          <Paper withBorder p="xl" radius="md" mb="xl" ta="center">
            <Text fw={600} mb="sm">
              Demo limit reached
            </Text>
            <Text c="dimmed" size="sm" mb="md">
              You have used all your free demo requests. Create an account to
              continue using the API with higher limits.
            </Text>
            <Button component="a" href="/register">
              Create free account
            </Button>
          </Paper>
        )}

        {/* Upload form */}
        {!exhausted && (
          <Paper withBorder shadow="md" p="lg" radius="md" mb="xl">
            <Stack>
              {/* File picker */}
              <div>
                <Text size="sm" fw={500} mb={4}>
                  File
                </Text>
                <input
                  ref={fileRef}
                  type="file"
                  accept={ACCEPTED_ALL}
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
                  Supported: JPG, PNG, WebP, ZIP (max 10 images), MP4/AVI/MOV/MKV/WEBM (max 30s, 20 frames)
                </Text>
              </div>

              {/* Tag labels input — for tag mode */}
              {mode === 'tag' && (
                <div>
                  <Text size="sm" fw={500} mb={4}>Labels (comma-separated)</Text>
                  <input
                    type="text"
                    placeholder="e.g. sexy pose, casual photo, outdoor scene, portrait"
                    value={demoLabels}
                    onChange={(e) => setDemoLabels(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      borderRadius: 'var(--mantine-radius-md)',
                      border: '1px solid var(--mantine-color-default-border)',
                      background: 'var(--mantine-color-body)',
                      color: 'var(--mantine-color-text)',
                      fontSize: 14,
                    }}
                  />
                </div>
              )}

              {/* Model selector — for classify and censor modes */}
              {(mode === 'classify' || mode === 'censor') && (
                <Radio.Group
                  label="Detection Model"
                  value={model}
                  onChange={setModel}
                >
                  <Group mt="xs">
                    <Radio value="nudenet" label="NudeNet" />
                    <Radio value="erax" label="EraX" />
                    <Radio value="both" label="Both" />
                  </Group>
                </Radio.Group>
              )}

              {/* Analyze button */}
              <Button
                leftSection={
                  mode === 'censor' ? <IconEyeOff size={16} /> :
                  mode === 'moderate' ? <IconShieldCheck size={16} /> :
                  mode === 'tag' ? <IconTag size={16} /> :
                  mode === 'anonymize' ? <IconUserOff size={16} /> :
                  <IconUpload size={16} />
                }
                onClick={handleAnalyze}
                loading={loading}
                disabled={!file || (mode === 'tag' && !demoLabels.trim())}
                fullWidth
                color={mode === 'censor' ? 'red' : mode === 'moderate' ? 'orange' : undefined}
              >
                {mode === 'rateme' ? 'Rate' : mode === 'censor' ? 'Preview Censor' : mode === 'moderate' ? 'Moderate' : mode === 'tag' ? 'Tag' : mode === 'anonymize' ? 'Detect Faces' : 'Analyze'}
              </Button>
            </Stack>
          </Paper>
        )}

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

        {/* Rate Me result */}
        {rateMeResult && (
          <React.Fragment>
            {rateMeResult.rating.category === 'blocked' && (
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
            <Paper withBorder p="lg" radius="md" mb="xl">
              <Group justify="space-between" mb="md">
                <Text fw={600} fz="lg">
                  Rating Result
                </Text>
                <Group gap="xs">
                  {rateMeResult.models.map((m) => (
                    <Badge key={m} variant="light" color="violet">
                      {m}
                    </Badge>
                  ))}
                </Group>
              </Group>

              <Stack align="center" gap="md" mb="md">
                <RingProgress
                  size={140}
                  thickness={14}
                  roundCaps
                  sections={[
                    {
                      value: Math.round(rateMeResult.rating.score * 100),
                      color:
                        CATEGORY_COLORS[rateMeResult.rating.category] || 'gray',
                    },
                  ]}
                  label={
                    <Text ta="center" fw={700} fz="xl">
                      {Math.round(rateMeResult.rating.score * 100)}%
                    </Text>
                  }
                />
                <Stack gap="xs" align="center">
                  <Badge
                    size="xl"
                    color={
                      CATEGORY_COLORS[rateMeResult.rating.category] || 'gray'
                    }
                    variant="filled"
                    radius="md"
                  >
                    {rateMeResult.rating.category}
                  </Badge>
                  <Text size="sm" c="dimmed" ta="center">
                    {rateMeResult.rating.description}
                  </Text>
                </Stack>
              </Stack>
            </Paper>

            {/* Factor bars */}
            <Paper withBorder p="lg" radius="md" mb="xl">
              <Text fw={600} fz="lg" mb="md">
                Rating Factors
              </Text>
              <Stack gap="sm">
                {Object.entries(rateMeResult.rating.factors).map(
                  ([key, factor]) => (
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
                  )
                )}
              </Stack>
            </Paper>

            {/* Eroticism breakdown table */}
            {rateMeResult.rating.factors.eroticism.breakdown.length > 0 && (
              <Paper withBorder p="lg" radius="md" mb="xl">
                <Text fw={600} fz="lg" mb="md">
                  Eroticism Breakdown
                </Text>
                <Table.ScrollContainer minWidth={400}><Table striped highlightOnHover>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Label</Table.Th>
                      <Table.Th>Confidence</Table.Th>
                      <Table.Th>Weight</Table.Th>
                      <Table.Th>Contribution</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {rateMeResult.rating.factors.eroticism.breakdown.map(
                      (item, idx) => (
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
                            <Text size="sm">
                              {item.contribution.toFixed(3)}
                            </Text>
                          </Table.Td>
                        </Table.Tr>
                      )
                    )}
                  </Table.Tbody>
                </Table></Table.ScrollContainer>
              </Paper>
            )}

            {/* CLIP Sexiness */}
            <Paper withBorder p="lg" radius="md" mb="xl">
              <Text fw={600} fz="lg" mb="md">
                CLIP Sexiness
              </Text>
              {!rateMeResult.rating.factors.clip_sexiness.available ? (
                <Alert
                  icon={<IconAlertCircle size={16} />}
                  color="yellow"
                  variant="light"
                >
                  CLIP model is unavailable for this analysis.
                </Alert>
              ) : rateMeResult.rating.factors.clip_sexiness.top_prompts &&
                rateMeResult.rating.factors.clip_sexiness.top_prompts.length >
                  0 ? (
                <Group gap="xs" wrap="wrap">
                  {rateMeResult.rating.factors.clip_sexiness.top_prompts.map(
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
              <SimpleGrid cols={{ base: 2, xs: 4 }}>
                {(
                  [
                    [
                      'Resolution',
                      rateMeResult.rating.factors.image_quality.resolution,
                    ],
                    [
                      'Sharpness',
                      rateMeResult.rating.factors.image_quality.sharpness,
                    ],
                    [
                      'Brightness',
                      rateMeResult.rating.factors.image_quality.brightness,
                    ],
                    [
                      'Contrast',
                      rateMeResult.rating.factors.image_quality.contrast,
                    ],
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
                    rateMeResult.rating.factors.composition.has_face
                      ? 'green'
                      : 'gray'
                  }
                  size="lg"
                >
                  {rateMeResult.rating.factors.composition.has_face
                    ? 'Face detected'
                    : 'No face detected'}
                </Badge>
                <Badge variant="light" color="teal" size="lg">
                  Aspect ratio:{' '}
                  {rateMeResult.rating.factors.composition.aspect_ratio.toFixed(
                    2
                  )}
                </Badge>
                <Badge variant="light" color="teal" size="lg">
                  Centering:{' '}
                  {Math.round(
                    rateMeResult.rating.factors.composition.centering * 100
                  )}
                  %
                </Badge>
              </Group>
              {rateMeResult.rating.factors.composition.pose && (
                <Stack gap={4} mt="md">
                  <Text size="sm" fw={500}>
                    Pose:{' '}
                    {Math.round(
                      rateMeResult.rating.factors.composition.pose.score * 100
                    )}
                    %
                  </Text>
                  <Text size="sm" c="dimmed">
                    {rateMeResult.rating.factors.composition.pose.details}
                  </Text>
                </Stack>
              )}
            </Paper>

            {/* CLIP Analysis Cards */}
            <ClipAnalysisCards
              age={rateMeResult.rating.age}
              deepfake={rateMeResult.rating.deepfake}
              clothing={rateMeResult.rating.clothing}
            />

            {/* Detections table */}
            {rateMeResult.detections.length > 0 && (
              <Paper withBorder p="lg" radius="md" mb="xl">
                <Text fw={600} fz="lg" mb="md">
                  Detections
                </Text>
                <Table.ScrollContainer minWidth={400}><Table striped highlightOnHover>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Label</Table.Th>
                      <Table.Th>Score</Table.Th>
                      <Table.Th>Box (x, y, w, h)</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {rateMeResult.detections.map((det, idx) => (
                      <Table.Tr key={idx}>
                        <Table.Td>
                          <Group gap={4} wrap="nowrap">
                            <Badge variant="light" size="sm">
                              {det.label}
                            </Badge>
                            {det.model && (
                              <Badge variant="outline" size="xs" color={det.model === 'nudenet' ? 'blue' : 'orange'}>
                                {det.model === 'nudenet' ? 'NN' : 'EX'}
                              </Badge>
                            )}
                          </Group>
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
                </Table></Table.ScrollContainer>
              </Paper>
            )}
          </React.Fragment>
        )}

        {/* Video result (classify mode only) */}
        {mode !== 'censor' && result?.type === 'video' && (
          <Paper withBorder p="lg" radius="md" mb="xl">
            <Group justify="space-between" mb="md">
              <Text fw={600} fz="lg">
                Video Detection Results
              </Text>
              <Group gap="xs">
                <Badge variant="light" color="violet">
                  {result.data.model}
                </Badge>
                <Badge variant="light">
                  {result.data.settings.frames_analyzed} frames
                </Badge>
                <Badge variant="light" color={result.data.summary.nsfw_percentage > 50 ? 'red' : 'green'}>
                  {result.data.summary.nsfw_percentage}% NSFW
                </Badge>
              </Group>
            </Group>

            <Paper withBorder p="sm" radius="md" mb="md">
              <Group gap="md" wrap="wrap">
                <Text size="sm">
                  <Text span fw={500}>Duration:</Text> {result.data.video_info.duration}s
                </Text>
                <Text size="sm">
                  <Text span fw={500}>Resolution:</Text> {result.data.video_info.width}x{result.data.video_info.height}
                </Text>
                <Text size="sm">
                  <Text span fw={500}>Detections:</Text> {result.data.summary.total_detections}
                </Text>
              </Group>
            </Paper>

            {Object.keys(result.data.summary.labels_found).length > 0 && (
              <Group gap="xs" mb="md">
                {Object.entries(result.data.summary.labels_found).map(([label, count]) => (
                  <Badge key={label} variant="light" size="sm">
                    {label}: {count}
                  </Badge>
                ))}
              </Group>
            )}

            <Table.ScrollContainer minWidth={400}><Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th w={30} />
                  <Table.Th>Timestamp</Table.Th>
                  <Table.Th>Detections</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {result.data.frames.map((frame, idx) => (
                  <React.Fragment key={idx}>
                    <Table.Tr
                      style={{ cursor: frame.detections.length > 0 ? 'pointer' : 'default' }}
                      onClick={() =>
                        frame.detections.length > 0 &&
                        setExpandedFrame(expandedFrame === idx ? null : idx)
                      }
                    >
                      <Table.Td>
                        {frame.detections.length > 0 ? (
                          expandedFrame === idx ? (
                            <IconChevronDown size={16} />
                          ) : (
                            <IconChevronRight size={16} />
                          )
                        ) : null}
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm" ff="monospace">
                          {frame.timestamp.toFixed(1)}s
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Badge
                          variant="light"
                          size="sm"
                          color={frame.detections.length > 0 ? 'red' : 'green'}
                        >
                          {frame.detections.length}
                        </Badge>
                      </Table.Td>
                    </Table.Tr>
                    {expandedFrame === idx && frame.detections.length > 0 && (
                      <Table.Tr>
                        <Table.Td colSpan={3}>
                          <Collapse expanded={expandedFrame === idx}>
                            <Paper withBorder p="sm" radius="md" mt="xs" mb="xs">
                              <Table>
                                <Table.Thead>
                                  <Table.Tr>
                                    <Table.Th>Label</Table.Th>
                                    <Table.Th>Score</Table.Th>
                                    <Table.Th>Box</Table.Th>
                                  </Table.Tr>
                                </Table.Thead>
                                <Table.Tbody>
                                  {frame.detections.map((det, dIdx) => (
                                    <Table.Tr key={dIdx}>
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
                          </Collapse>
                        </Table.Td>
                      </Table.Tr>
                    )}
                  </React.Fragment>
                ))}
              </Table.Tbody>
            </Table></Table.ScrollContainer>
          </Paper>
        )}

        {/* Single image result (classify mode only) */}
        {mode !== 'censor' && result?.type === 'single' && (
          <React.Fragment>
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
          <Paper withBorder p="lg" radius="md" mb="xl">
            <Group justify="space-between" mb="md">
              <Text fw={600} fz="lg">
                Detection Results
              </Text>
              <Group gap="xs">
                <Badge variant="light" color="violet">
                  {result.data.model || model}
                </Badge>
                <Badge variant="light">
                  {result.data.detections.length} detection
                  {result.data.detections.length !== 1 ? 's' : ''}
                </Badge>
              </Group>
            </Group>

            {result.data.detections.length === 0 ? (
              <Text c="dimmed">No NSFW content detected.</Text>
            ) : (
              <Table.ScrollContainer minWidth={400}><Table striped highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Label</Table.Th>
                    <Table.Th>Score</Table.Th>
                    <Table.Th>Box (x, y, w, h)</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {result.data.detections.map((det, idx) => (
                    <Table.Tr key={idx}>
                      <Table.Td>
                        <Group gap={4} wrap="nowrap">
                          <Badge variant="light" size="sm">
                            {det.label}
                          </Badge>
                          {det.model && (
                            <Badge variant="outline" size="xs" color={det.model === 'nudenet' ? 'blue' : 'orange'}>
                              {det.model === 'nudenet' ? 'NN' : 'EX'}
                            </Badge>
                          )}
                        </Group>
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
              </Table></Table.ScrollContainer>
            )}

            <ClipAnalysisCards
              age={result.data.age}
              deepfake={result.data.deepfake}
              clothing={result.data.clothing}
            />
          </Paper>
          </React.Fragment>
        )}

        {/* Batch result (classify mode only) */}
        {mode !== 'censor' && result?.type === 'batch' && (
          <Paper withBorder p="lg" radius="md" mb="xl">
            <Group justify="space-between" mb="md">
              <Text fw={600} fz="lg">
                Batch Results
              </Text>
              <Group gap="xs">
                <Badge variant="light" color="violet">
                  {result.data.model}
                </Badge>
                <Badge variant="light">
                  {result.data.processed} / {result.data.total} processed
                </Badge>
              </Group>
            </Group>

            <Table.ScrollContainer minWidth={400}><Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th w={30} />
                  <Table.Th>Filename</Table.Th>
                  <Table.Th>Detections</Table.Th>
                  <Table.Th>Status</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {result.data.results.map((fr) => (
                  <React.Fragment key={fr.filename}>
                    <Table.Tr
                      style={{
                        cursor: fr.detections ? 'pointer' : 'default',
                      }}
                      onClick={() =>
                        fr.detections &&
                        setExpandedFile(
                          expandedFile === fr.filename ? null : fr.filename
                        )
                      }
                    >
                      <Table.Td>
                        {fr.detections && fr.detections.length > 0 ? (
                          expandedFile === fr.filename ? (
                            <IconChevronDown size={16} />
                          ) : (
                            <IconChevronRight size={16} />
                          )
                        ) : null}
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm" ff="monospace">
                          {fr.filename}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Badge variant="light" size="sm">
                          {fr.detections?.length ?? 0}
                        </Badge>
                      </Table.Td>
                      <Table.Td>
                        {fr.error ? (
                          <Text size="sm" c="red">
                            {fr.error}
                          </Text>
                        ) : (
                          <Badge color="green" variant="light" size="sm">
                            OK
                          </Badge>
                        )}
                      </Table.Td>
                    </Table.Tr>
                    {expandedFile === fr.filename &&
                      fr.detections &&
                      fr.detections.length > 0 && (
                        <Table.Tr key={`${fr.filename}-detail`}>
                          <Table.Td colSpan={4}>
                            <Collapse expanded={expandedFile === fr.filename}>
                              <Paper
                                withBorder
                                p="sm"
                                radius="md"
                                mt="xs"
                                mb="xs"
                              >
                                <Table>
                                  <Table.Thead>
                                    <Table.Tr>
                                      <Table.Th>Label</Table.Th>
                                      <Table.Th>Score</Table.Th>
                                      <Table.Th>Box</Table.Th>
                                    </Table.Tr>
                                  </Table.Thead>
                                  <Table.Tbody>
                                    {fr.detections.map((det, idx) => (
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
                                          <Text
                                            size="xs"
                                            c="dimmed"
                                            ff="monospace"
                                          >
                                            {det.box
                                              ? det.box
                                                  .map((v) => v.toFixed(0))
                                                  .join(', ')
                                              : '--'}
                                          </Text>
                                        </Table.Td>
                                      </Table.Tr>
                                    ))}
                                  </Table.Tbody>
                                </Table>
                              </Paper>
                            </Collapse>
                          </Table.Td>
                        </Table.Tr>
                      )}
                  </React.Fragment>
                ))}
              </Table.Tbody>
            </Table></Table.ScrollContainer>
          </Paper>
        )}

        {/* Censor preview result */}
        {mode === 'censor' && result?.type === 'single' && (
          <React.Fragment>
            {censorPreviewUrl && (
              <Paper withBorder p="lg" radius="md" mb="xl">
                <Group justify="space-between" mb="md">
                  <Text fw={600} fz="lg">
                    Censor Preview
                  </Text>
                  <Badge variant="light" color="red">
                    Preview only
                  </Badge>
                </Group>
                <Image
                  src={censorPreviewUrl}
                  alt="Censor preview"
                  radius="md"
                  maw={600}
                  mx="auto"
                  mb="md"
                />
                <Alert
                  icon={<IconEyeOff size={16} />}
                  color="violet"
                  variant="light"
                  mb="md"
                >
                  This is a preview with overlay boxes. Full Gaussian blur censoring is available with an API key.
                  Create a free account to censor images with professional-grade blurring.
                </Alert>
                <Center>
                  <Button component="a" href="/register" color="violet">
                    Create free account to censor
                  </Button>
                </Center>
              </Paper>
            )}

            {result.data.detections.length === 0 && (
              <Paper withBorder p="lg" radius="md" mb="xl" ta="center">
                <Text fw={600} mb="sm">
                  No NSFW content detected
                </Text>
                <Text c="dimmed" size="sm">
                  No regions to censor were found in this image.
                </Text>
              </Paper>
            )}

            {/* Detection details */}
            {result.data.detections.length > 0 && (
              <Paper withBorder p="lg" radius="md" mb="xl">
                <Text fw={600} fz="lg" mb="md">
                  Detected Regions
                </Text>
                <Table.ScrollContainer minWidth={400}><Table striped highlightOnHover>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Label</Table.Th>
                      <Table.Th>Score</Table.Th>
                      <Table.Th>Box (x, y, w, h)</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {result.data.detections.map((det, idx) => (
                      <Table.Tr key={idx}>
                        <Table.Td>
                          <Group gap={4} wrap="nowrap">
                            <Badge variant="light" size="sm">
                              {det.label}
                            </Badge>
                            {det.model && (
                              <Badge variant="outline" size="xs" color={det.model === 'nudenet' ? 'blue' : 'orange'}>
                                {det.model === 'nudenet' ? 'NN' : 'EX'}
                              </Badge>
                            )}
                          </Group>
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
                </Table></Table.ScrollContainer>
              </Paper>
            )}
          </React.Fragment>
        )}

        {/* Censor mode for video — show classify results + upsell */}
        {mode === 'censor' && result?.type === 'video' && (
          <React.Fragment>
            <Paper withBorder p="lg" radius="md" mb="xl">
              <Group justify="space-between" mb="md">
                <Text fw={600} fz="lg">
                  Video Detection Results
                </Text>
                <Group gap="xs">
                  <Badge variant="light" color="red">
                    Preview only
                  </Badge>
                  <Badge variant="light">
                    {result.data.settings.frames_analyzed} frames
                  </Badge>
                  <Badge variant="light" color={result.data.summary.nsfw_percentage > 50 ? 'red' : 'green'}>
                    {result.data.summary.nsfw_percentage}% NSFW
                  </Badge>
                </Group>
              </Group>

              <Alert
                icon={<IconEyeOff size={16} />}
                color="violet"
                variant="light"
                mb="md"
              >
                Full video censoring with Gaussian blur is available with an API key.
                The API returns a fully censored MP4 file ready for use.
              </Alert>

              <Center mb="md">
                <Button component="a" href="/register" color="violet">
                  Create free account to censor videos
                </Button>
              </Center>

              {Object.keys(result.data.summary.labels_found).length > 0 && (
                <Group gap="xs" mb="md">
                  {Object.entries(result.data.summary.labels_found).map(([label, count]) => (
                    <Badge key={label} variant="light" size="sm">
                      {label}: {count}
                    </Badge>
                  ))}
                </Group>
              )}
            </Paper>
          </React.Fragment>
        )}

        {/* Anonymize result */}
        {mode === 'anonymize' && anonymizePreviewUrl && (
          <Paper withBorder p="lg" radius="md" mb="xl">
            <Group justify="space-between" mb="md">
              <Text fw={600} fz="lg">
                Anonymized Image
              </Text>
              <Badge variant="light" color="violet">
                Faces blurred
              </Badge>
            </Group>
            <Image
              src={anonymizePreviewUrl}
              alt="Anonymized image"
              radius="md"
              maw={600}
              mx="auto"
              mb="md"
            />
            <Center>
              <Button
                component="a"
                href={anonymizePreviewUrl}
                download="anonymized.png"
                variant="light"
                color="violet"
                leftSection={<IconDownload size={16} />}
              >
                Download Anonymized Image
              </Button>
            </Center>
          </Paper>
        )}

        {/* Moderate result */}
        {moderateResult && (
          <Paper withBorder p="lg" radius="md" mb="xl">
            <Stack align="center" gap="md">
              <Text fw={600} fz="lg">Moderation Result</Text>
              <Badge
                size="xl"
                color={moderateResult.action === 'allow' ? 'green' : moderateResult.action === 'flag' ? 'yellow' : 'red'}
                variant="filled"
                radius="md"
                style={{ fontSize: 20, padding: '16px 32px' }}
              >
                {(moderateResult.action || 'unknown').toUpperCase()}
              </Badge>
              <Text size="sm" c="dimmed">
                Confidence: {((moderateResult.confidence || 0) * 100).toFixed(1)}%
              </Text>
              {moderateResult.reasons && moderateResult.reasons.length > 0 && (
                <Stack gap="xs" w="100%">
                  {moderateResult.reasons.map((reason: string, idx: number) => (
                    <Alert
                      key={idx}
                      color={moderateResult.action === 'allow' ? 'green' : moderateResult.action === 'flag' ? 'yellow' : 'red'}
                      variant="light"
                      icon={<IconAlertCircle size={16} />}
                    >
                      {reason}
                    </Alert>
                  ))}
                </Stack>
              )}
            </Stack>
          </Paper>
        )}

        {/* Tag result */}
        {tagResult && tagResult.tags && (
          <Paper withBorder p="lg" radius="md" mb="xl">
            <Group justify="space-between" mb="md">
              <Text fw={600} fz="lg">Tag Results</Text>
              <Badge variant="light" color="violet">{tagResult.model}</Badge>
            </Group>
            <Stack gap="sm">
              {tagResult.tags
                .sort((a: any, b: any) => b.score - a.score)
                .map((tag: any) => (
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

        {/* CTA at bottom */}
        <Paper withBorder p="lg" radius="md" ta="center">
          <Text fw={500} mb="xs">
            Need higher limits?
          </Text>
          <Text c="dimmed" size="sm" mb="md">
            Create a free account to get your own API keys with higher rate
            limits and access to the full API including censoring and batch
            processing.
          </Text>
          <Group justify="center" gap="md">
            <Button component="a" href="/register">
              Create free account
            </Button>
            <Button component="a" href="/login" variant="light">
              Sign in
            </Button>
          </Group>
        </Paper>
      </Container>
    </Box>
  );
}
