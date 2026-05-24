'use client';

import { Button, Group, Modal, Stack, Text } from '@mantine/core';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

export interface ConfirmDialogProps {
  opened: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title?: ReactNode;
  message: ReactNode;
  confirmLabel?: ReactNode;
  cancelLabel?: ReactNode;
  danger?: boolean;
  loading?: boolean;
}

export function ConfirmDialog({
  opened,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel,
  cancelLabel,
  danger,
  loading,
}: ConfirmDialogProps) {
  const t = useTranslations('common');

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={title ?? t('confirm')}
      fullScreen={{ base: true, sm: false } as any}
      centered
      radius="md"
    >
      <Stack gap="lg">
        <Text fz="sm" c="dimmed">
          {message}
        </Text>
        <Group justify="flex-end" gap="xs">
          <Button variant="default" onClick={onClose} disabled={loading}>
            {cancelLabel ?? t('cancel')}
          </Button>
          <Button color={danger ? 'red' : undefined} onClick={onConfirm} loading={loading}>
            {confirmLabel ?? t('confirm')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
