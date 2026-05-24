'use client';

import { Button, Group, Loader, Paper, Progress, Stack, Text } from '@mantine/core';
import { IconPlayerStop } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

export interface ProcessingQueueProps {
  isProcessing: boolean;
  status?: string;
  progress?: number; // 0-100, undefined = indeterminate
  onCancel?: () => void;
  startTime?: number; // timestamp when processing started
}

function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${minutes}m ${secs}s`;
}

export function ProcessingQueue({
  isProcessing,
  status,
  progress,
  onCancel,
  startTime,
}: ProcessingQueueProps) {
  const t = useTranslations('processing');
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!isProcessing || !startTime) {
      setElapsed(0);
      return;
    }
    setElapsed(Date.now() - startTime);
    const interval = setInterval(() => {
      setElapsed(Date.now() - startTime);
    }, 1000);
    return () => clearInterval(interval);
  }, [isProcessing, startTime]);

  if (!isProcessing) return null;

  return (
    <Paper withBorder p="lg" radius="md" mb="xl">
      <Stack gap="md">
        <Group justify="space-between" align="center">
          <Group gap="sm">
            {progress == null && <Loader size="sm" />}
            <Text fw={600}>{status || t('processing')}</Text>
          </Group>
          {startTime && (
            <Text size="sm" c="dimmed" ff="monospace">
              {formatElapsed(elapsed)}
            </Text>
          )}
        </Group>

        {progress != null && (
          <Progress
            value={progress}
            size="lg"
            radius="xl"
            color="violet"
            animated
          />
        )}

        {onCancel && (
          <Button
            variant="light"
            color="red"
            leftSection={<IconPlayerStop size={16} />}
            onClick={onCancel}
            size="sm"
          >
            {t('cancel')}
          </Button>
        )}
      </Stack>
    </Paper>
  );
}
