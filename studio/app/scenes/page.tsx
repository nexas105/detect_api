'use client';

import React, { useCallback, useRef, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Center,
  Group,
  Paper,
  Stack,
  Table,
  Text,
  TextInput,
} from '@mantine/core';
import {
  IconAlertCircle,
  IconDownload,
  IconFileUpload,
  IconMovie,
} from '@tabler/icons-react';
import { useTranslations } from 'next-intl';
import { DashboardShell } from '@/components/DashboardShell/DashboardShell';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { ProcessingQueue } from '@/components/ProcessingQueue/ProcessingQueue';
import { API_URL } from '@/lib/auth';
import { useApiKeys } from '@/lib/use-api-keys';
import { ApiKeySelect } from '@/components/ApiKeySelect';

const ACCEPTED_VIDEO = '.mp4,.avi,.mov,.mkv,.webm';

interface SceneInfo {
  index: number;
  start: number;
  end: number;
  duration: number;
}

export default function ScenesPage() {
  const { keys, selectedKey, setSelectedKey, selectedKeyId, selectKey, error: keysError } = useApiKeys();
  const t = useTranslations('scenes');

  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fps, setFps] = useState('1');
  const [minDuration, setMinDuration] = useState('2');
  const [padding, setPadding] = useState('0.5');
  const [loading, setLoading] = useState(false);
  const [startTime, setStartTime] = useState<number | undefined>();
  const [error, setError] = useState('');
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [scenesFound, setScenesFound] = useState<number | null>(null);
  const [totalDuration, setTotalDuration] = useState<string | null>(null);
  const [scenesDuration, setScenesDuration] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const handleExtract = useCallback(async () => {
    if (!file || !selectedKey.trim()) return;
    setLoading(true);
    setStartTime(Date.now());
    setError('');
    if (videoUrl) {
      URL.revokeObjectURL(videoUrl);
      setVideoUrl(null);
    }
    setScenesFound(null);
    setTotalDuration(null);
    setScenesDuration(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const formData = new FormData();
      formData.append('file', file);
      const params = new URLSearchParams({
        fps,
        min_scene_duration: minDuration,
        scene_padding: padding,
      });
      const res = await fetch(`${API_URL}/video/scenes?${params}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${selectedKey.trim()}` },
        body: formData,
        signal: controller.signal,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Request failed (${res.status})`);
      }

      // Read metadata from headers
      setScenesFound(parseInt(res.headers.get('X-Scenes-Found') || '0', 10));
      setTotalDuration(res.headers.get('X-Total-Duration'));
      setScenesDuration(res.headers.get('X-Scenes-Duration'));

      const blob = await res.blob();
      setVideoUrl(URL.createObjectURL(blob));
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setError(err.message || 'Scene extraction failed');
      }
    } finally {
      setLoading(false);
      setStartTime(undefined);
      abortRef.current = null;
    }
  }, [file, selectedKey, fps, minDuration, padding, videoUrl]);

  const handleCancel = () => {
    abortRef.current?.abort();
  };

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
            <Text size="sm" fw={500} mb={4}>Video File</Text>
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPTED_VIDEO}
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                if (videoUrl) { URL.revokeObjectURL(videoUrl); setVideoUrl(null); }
                setScenesFound(null);
                setError('');
              }}
              style={{ display: 'none' }}
            />
            <Group>
              <Button variant="light" leftSection={<IconFileUpload size={16} />} onClick={() => fileRef.current?.click()}>
                {file ? 'Change file' : 'Choose video'}
              </Button>
              {file && <Text size="sm" c="dimmed">{file.name} ({(file.size / (1024 * 1024)).toFixed(1)} MB)</Text>}
            </Group>
            <Text size="xs" c="dimmed" mt={4}>Supported: MP4, AVI, MOV, MKV, WEBM</Text>
          </div>

          {/* Settings */}
          <Group grow>
            <TextInput
              label={t('fpsLabel')}
              description={t('fpsDescription')}
              value={fps}
              onChange={(e) => setFps(e.currentTarget.value)}
              type="number"
            />
            <TextInput
              label={t('minDurationLabel')}
              description={t('minDurationDescription')}
              value={minDuration}
              onChange={(e) => setMinDuration(e.currentTarget.value)}
              type="number"
            />
            <TextInput
              label={t('paddingLabel')}
              description={t('paddingDescription')}
              value={padding}
              onChange={(e) => setPadding(e.currentTarget.value)}
              type="number"
            />
          </Group>

          <Button
            leftSection={<IconMovie size={16} />}
            onClick={handleExtract}
            loading={loading}
            disabled={!file || !selectedKey.trim()}
            fullWidth
          >
            {t('extractButton')}
          </Button>
        </Stack>
      </Paper>

      <ProcessingQueue
        isProcessing={loading}
        status={t('extracting')}
        onCancel={handleCancel}
        startTime={startTime}
      />

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

      {videoUrl && (
        <>
          {/* Scene info */}
          <Paper withBorder p="lg" radius="md" mb="xl">
            <Group justify="space-between" mb="md">
              <Text fw={600} fz="lg">{t('resultTitle')}</Text>
              <Group gap="xs">
                {scenesFound != null && <Badge variant="light" color="violet">{scenesFound} {t('scenesLabel')}</Badge>}
                {totalDuration && <Badge variant="light">{t('total')}: {parseFloat(totalDuration).toFixed(1)}s</Badge>}
                {scenesDuration && <Badge variant="light" color="teal">{t('scenesDur')}: {parseFloat(scenesDuration).toFixed(1)}s</Badge>}
              </Group>
            </Group>

            <Center mb="md">
              <video
                src={videoUrl}
                controls
                style={{ maxWidth: '100%', maxHeight: 500, borderRadius: 8 }}
              />
            </Center>

            <Center>
              <Button
                variant="light"
                color="violet"
                leftSection={<IconDownload size={16} />}
                component="a"
                href={videoUrl}
                download={`scenes-${Date.now()}.mp4`}
              >
                {t('downloadVideo')}
              </Button>
            </Center>
          </Paper>
        </>
      )}
    </DashboardShell>
  );
}
