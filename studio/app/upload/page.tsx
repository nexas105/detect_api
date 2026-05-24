'use client';

import React from 'react';
import {
  Alert,
  Badge,
  Button,
  Center,
  Collapse,
  Group,
  Image,
  Loader,
  Paper,
  Radio,
  SegmentedControl,
  Select,
  Slider,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
} from '@mantine/core';
import {
  IconAlertCircle,
  IconChevronDown,
  IconChevronRight,
  IconDownload,
  IconEyeOff,
  IconFileUpload,
  IconUpload,
} from '@tabler/icons-react';
import { useCallback, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { DashboardShell } from '@/components/DashboardShell/DashboardShell';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import {
  ClipAnalysisCards,
  AgeAnalysis,
  DeepfakeAnalysis,
  ClothingAnalysis,
} from '@/components/ClipAnalysisCards';
import { API_URL } from '@/lib/auth';
import { useApiKeys } from '@/lib/use-api-keys';

const ACCEPTED_IMAGE = '.jpg,.jpeg,.png,.webp';
const ACCEPTED_ARCHIVE = '.zip,.rar';
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
  image_id?: string;
  model?: string;
  detections: Detection[];
  age?: AgeAnalysis;
  deepfake?: DeepfakeAnalysis;
  clothing?: ClothingAnalysis;
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
  errors?: number;
  results: BatchFileResult[];
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
}

type ResultData =
  | { type: 'single'; data: SingleResult }
  | { type: 'batch'; data: BatchResult }
  | { type: 'video'; data: VideoResult };

export default function UploadPage() {
  const { keys, selectedKey, setSelectedKey, selectedKeyId, selectKey, error: keysError } = useApiKeys();
  const t = useTranslations('upload');
  const tCommon = useTranslations('common');
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [model, setModel] = useState('nudenet');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ResultData | null>(null);
  const [expandedFile, setExpandedFile] = useState<string | null>(null);
  const [expandedFrame, setExpandedFrame] = useState<number | null>(null);
  const [videoFps, setVideoFps] = useState('1');
  const [videoMaxFrames, setVideoMaxFrames] = useState('100');
  const [downloading, setDownloading] = useState(false);
  const [mode, setMode] = useState<'classify' | 'censor'>('classify');
  const [censorLabels, setCensorLabels] = useState('');
  const [blurRadius, setBlurRadius] = useState(30);
  const [interpolate, setInterpolate] = useState(true);
  const [censoredUrl, setCensoredUrl] = useState<string | null>(null);
  const [censoredVideoUrl, setCensoredVideoUrl] = useState<string | null>(null);

  const handleDownloadResult = useCallback(async () => {
    if (!file || !result || result.type !== 'single') return;
    setDownloading(true);
    try {
      const { generateResultImage, downloadResultBlob } = await import('@/lib/result-image');
      const blob = await generateResultImage(file, result.data, 'classify');
      downloadResultBlob(blob);
    } catch (err) {
      console.error('Failed to generate result image', err);
    } finally {
      setDownloading(false);
    }
  }, [file, result]);

  const handleModeChange = (value: string) => {
    setMode(value as 'classify' | 'censor');
    setResult(null);
    setError('');
    if (censoredUrl) {
      URL.revokeObjectURL(censoredUrl);
      setCensoredUrl(null);
    }
    if (censoredVideoUrl) {
      URL.revokeObjectURL(censoredVideoUrl);
      setCensoredVideoUrl(null);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    setResult(null);
    setError('');
    if (censoredUrl) {
      URL.revokeObjectURL(censoredUrl);
      setCensoredUrl(null);
    }
    if (censoredVideoUrl) {
      URL.revokeObjectURL(censoredVideoUrl);
      setCensoredVideoUrl(null);
    }
  };

  const isArchive = (f: File) =>
    /\.(zip|rar)$/i.test(f.name);

  const isVideo = (f: File) =>
    /\.(mp4|avi|mov|mkv|webm)$/i.test(f.name);

  const handleAnalyze = useCallback(async () => {
    if (!file || !selectedKey.trim()) return;
    setLoading(true);
    setError('');
    setResult(null);
    if (censoredUrl) {
      URL.revokeObjectURL(censoredUrl);
      setCensoredUrl(null);
    }
    if (censoredVideoUrl) {
      URL.revokeObjectURL(censoredVideoUrl);
      setCensoredVideoUrl(null);
    }

    try {
      const formData = new FormData();
      formData.append('file', file);
      if (mode === 'censor' && censorLabels.trim()) {
        formData.append('labels', censorLabels.trim());
      }

      if (mode === 'censor') {
        // Censor mode — response is binary
        const isVid = isVideo(file);
        const params = new URLSearchParams({ model });
        if (isVid) {
          params.set('fps', videoFps);
          params.set('max_frames', videoMaxFrames);
          params.set('blur_radius', String(blurRadius));
          params.set('interpolate', String(interpolate));
        }
        const endpoint = isVid
          ? `${API_URL}/video/censor?${params}`
          : `${API_URL}/censor?${params}`;

        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { Authorization: `Bearer ${selectedKey.trim()}` },
          body: formData,
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.detail || `Request failed (${res.status})`);
        }

        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        if (isVid) {
          setCensoredVideoUrl(url);
        } else {
          setCensoredUrl(url);
        }
      } else if (model === 'both' && !isVideo(file) && !isArchive(file)) {
        // Both models — run two classify calls in parallel, merge results
        const headers = { Authorization: `Bearer ${selectedKey.trim()}` };

        const formData1 = new FormData();
        formData1.append('file', file);
        const formData2 = new FormData();
        formData2.append('file', file);

        const [nnRes, exRes] = await Promise.all([
          fetch(`${API_URL}/classify?model=nudenet`, { method: 'POST', headers, body: formData1 }),
          fetch(`${API_URL}/classify?model=erax`, { method: 'POST', headers, body: formData2 }),
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

        const nnDets = nnData.detections.map((d) => ({ ...d, model: 'nudenet' as string }));
        const exDets = exData.detections.map((d) => ({ ...d, model: 'erax' as string }));
        const merged = mergeDetections(nnDets, exDets);

        setResult({
          type: 'single',
          data: {
            ...nnData,
            model: 'both',
            detections: merged,
            age: nnData.age || exData.age,
            deepfake: nnData.deepfake || exData.deepfake,
            clothing: nnData.clothing || exData.clothing,
          },
        });
      } else {
        // Classify mode — response is JSON
        const actualModel = model === 'both' ? 'nudenet' : model;
        const endpoint = isVideo(file)
          ? `${API_URL}/video/classify?model=${actualModel}&fps=${videoFps}&max_frames=${videoMaxFrames}`
          : isArchive(file)
          ? `${API_URL}/batch?model=${actualModel}`
          : `${API_URL}/classify?model=${actualModel}`;

        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { Authorization: `Bearer ${selectedKey.trim()}` },
          body: formData,
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.detail || `Request failed (${res.status})`);
        }

        const data = await res.json();

        if (isVideo(file)) {
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
  }, [file, model, selectedKey, videoFps, videoMaxFrames, mode, censorLabels, blurRadius, interpolate, censoredUrl, censoredVideoUrl]);

  return (
    <DashboardShell>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />

      <Center mb="xl">
        <SegmentedControl
          value={mode}
          onChange={handleModeChange}
          data={[
            { label: t('classify'), value: 'classify' },
            { label: t('censor'), value: 'censor' },
          ]}
        />
      </Center>

      <Paper withBorder p="lg" radius="md" mb="xl">
        <Stack>
          {/* API Key selection */}
          <Paper withBorder p="sm" radius="md">
            <Text size="sm" fw={500} mb={4}>
              {t('selectedKey')} <Text span c="red">*</Text>
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
              Supported: JPG, PNG, WebP, ZIP, RAR, MP4, AVI, MOV, MKV, WEBM
            </Text>
          </div>

          {/* Model selector */}
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

          {/* Video options */}
          {file && isVideo(file) && (
            <Group grow>
              <TextInput
                label="FPS"
                description="Frames per second to analyze (0.1-5)"
                value={videoFps}
                onChange={(e) => setVideoFps(e.currentTarget.value)}
                type="number"
              />
              <TextInput
                label="Max Frames"
                description="Maximum frames to process (1-500)"
                value={videoMaxFrames}
                onChange={(e) => setVideoMaxFrames(e.currentTarget.value)}
                type="number"
              />
            </Group>
          )}

          {/* Censor options */}
          {mode === 'censor' && (
            <>
              <TextInput
                label="Labels to censor (optional)"
                description="Comma-separated list of labels. Leave empty for all detected labels."
                placeholder="FEMALE_BREAST_EXPOSED, BUTTOCKS_EXPOSED, FEMALE_GENITALIA_EXPOSED, ..."
                value={censorLabels}
                onChange={(e) => setCensorLabels(e.currentTarget.value)}
              />
              {file && isVideo(file) && (
                <Group grow>
                  <div>
                    <Text size="sm" fw={500} mb={4}>
                      Blur Radius: {blurRadius}
                    </Text>
                    <Slider
                      min={5}
                      max={100}
                      value={blurRadius}
                      onChange={setBlurRadius}
                      marks={[
                        { value: 5, label: '5' },
                        { value: 50, label: '50' },
                        { value: 100, label: '100' },
                      ]}
                    />
                  </div>
                  <Switch
                    label="Interpolate"
                    description="Smooth box transitions between frames"
                    checked={interpolate}
                    onChange={(e) => setInterpolate(e.currentTarget.checked)}
                    mt="md"
                  />
                </Group>
              )}
            </>
          )}

          {/* Analyze / Censor button */}
          <Button
            leftSection={mode === 'censor' ? <IconEyeOff size={16} /> : <IconUpload size={16} />}
            onClick={handleAnalyze}
            loading={loading}
            disabled={!file || !selectedKey.trim()}
            fullWidth
            color={mode === 'censor' ? 'red' : undefined}
          >
            {mode === 'censor'
              ? file && isVideo(file)
                ? 'Censor Video'
                : 'Censor Image'
              : file && isVideo(file)
              ? 'Analyze Video'
              : 'Analyze'}
          </Button>
        </Stack>
      </Paper>

      {/* Censored image result */}
      {censoredUrl && (
        <Paper withBorder p="lg" radius="md" mb="xl">
          <Group justify="space-between" mb="md">
            <Text fw={600} fz="lg">
              Censored Image
            </Text>
            <Button
              variant="light"
              color="red"
              leftSection={<IconDownload size={16} />}
              component="a"
              href={censoredUrl}
              download={`censored-${Date.now()}.png`}
            >
              Download Censored
            </Button>
          </Group>
          <Image
            src={censoredUrl}
            alt="Censored result"
            radius="md"
            maw={800}
            mx="auto"
          />
        </Paper>
      )}

      {/* Censored video result */}
      {censoredVideoUrl && (
        <Paper withBorder p="lg" radius="md" mb="xl">
          <Group justify="space-between" mb="md">
            <Text fw={600} fz="lg">
              Censored Video
            </Text>
            <Button
              variant="light"
              color="red"
              leftSection={<IconDownload size={16} />}
              component="a"
              href={censoredVideoUrl}
              download={`censored-${Date.now()}.mp4`}
            >
              Download Censored Video
            </Button>
          </Group>
          <Center>
            <video
              src={censoredVideoUrl}
              controls
              style={{ maxWidth: '100%', maxHeight: 500, borderRadius: 8 }}
            />
          </Center>
        </Paper>
      )}

      {/* API Keys Error */}
      {keysError && (
        <Alert
          icon={<IconAlertCircle size={16} />}
          color="orange"
          mb="xl"
          title="API Keys"
        >
          {keysError}
        </Alert>
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

      {/* Single image result */}
      {result?.type === 'single' && (
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
        <Paper withBorder p="lg" radius="md">
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
            <Table striped highlightOnHover>
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
                      <Text size="sm">{(det.score * 100).toFixed(1)}%</Text>
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
          )}

          <ClipAnalysisCards
            age={result.data.age}
            deepfake={result.data.deepfake}
            clothing={result.data.clothing}
          />
        </Paper>
        </React.Fragment>
      )}

      {/* Video result */}
      {result?.type === 'video' && (
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
                {result.data.settings.frames_analyzed} frames analyzed
              </Badge>
              <Badge variant="light" color={result.data.summary.nsfw_percentage > 50 ? 'red' : 'green'}>
                {result.data.summary.nsfw_percentage}% NSFW
              </Badge>
            </Group>
          </Group>

          {/* Video info */}
          <Paper withBorder p="sm" radius="md" mb="md">
            <Group gap="xl">
              <Text size="sm">
                <Text span fw={500}>Duration:</Text> {result.data.video_info.duration}s
              </Text>
              <Text size="sm">
                <Text span fw={500}>Resolution:</Text> {result.data.video_info.width}x{result.data.video_info.height}
              </Text>
              <Text size="sm">
                <Text span fw={500}>FPS:</Text> {result.data.video_info.fps}
              </Text>
              <Text size="sm">
                <Text span fw={500}>Total detections:</Text> {result.data.summary.total_detections}
              </Text>
            </Group>
          </Paper>

          {/* Labels summary */}
          {Object.keys(result.data.summary.labels_found).length > 0 && (
            <Group gap="xs" mb="md">
              {Object.entries(result.data.summary.labels_found).map(([label, count]) => (
                <Badge key={label} variant="light" size="sm">
                  {label}: {count}
                </Badge>
              ))}
            </Group>
          )}

          {/* Frame-by-frame results */}
          <Table striped highlightOnHover>
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
          </Table>
        </Paper>
      )}

      {/* Batch result */}
      {result?.type === 'batch' && (
        <Paper withBorder p="lg" radius="md">
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
              {(result.data.errors ?? 0) > 0 && (
                <Badge variant="light" color="red">
                  {result.data.errors} error{result.data.errors !== 1 ? 's' : ''}
                </Badge>
              )}
            </Group>
          </Group>

          <Table striped highlightOnHover>
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
                    style={{ cursor: fr.detections ? 'pointer' : 'default' }}
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
          </Table>
        </Paper>
      )}
    </DashboardShell>
  );
}
