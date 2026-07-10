'use client';

import { Button, Center, Stack, Text, ThemeIcon } from '@mantine/core';
import type { ComponentType, ReactNode } from 'react';
import { DetectionFrame } from '@/components/DetectionFrame';

export interface EmptyStateProps {
  icon?: ComponentType<{ size?: number; stroke?: number }>;
  title?: ReactNode;
  message: ReactNode;
  actionLabel?: ReactNode;
  onAction?: () => void;
}

export function EmptyState({
  icon: Icon,
  title,
  message,
  actionLabel,
  onAction,
}: EmptyStateProps) {
  return (
    <Center py={48}>
      <Stack align="center" gap="sm" maw={420} ta="center">
        {Icon ? (
          <DetectionFrame color="var(--text-lo)" size={12} inset={-5}>
            <ThemeIcon variant="default" size={56} radius="sm" c="dimmed">
              <Icon size={28} stroke={1.5} />
            </ThemeIcon>
          </DetectionFrame>
        ) : null}
        {title ? (
          <Text fw={600} fz="lg">
            {title}
          </Text>
        ) : null}
        <Text c="dimmed" fz="sm">
          {message}
        </Text>
        {actionLabel && onAction ? (
          <Button mt="xs" onClick={onAction}>
            {actionLabel}
          </Button>
        ) : null}
      </Stack>
    </Center>
  );
}
