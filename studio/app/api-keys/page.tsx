'use client';

import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Checkbox,
  Code,
  CopyButton,
  Group,
  Modal,
  Paper,
  Stack,
  Table,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { IconCopy, IconEye, IconKey, IconPlus, IconTrash } from '@tabler/icons-react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { DashboardShell } from '@/components/DashboardShell/DashboardShell';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { SkeletonList } from '@/components/SkeletonList/SkeletonList';
import { ConfirmDialog } from '@/components/ConfirmDialog/ConfirmDialog';
import { AUTH_URL, useAuth } from '@/lib/auth';

interface ApiKey {
  id: string;
  name: string;
  key_preview: string;
  is_master: boolean;
  rate_limit: number | null;
  created_at: string;
}

export default function ApiKeysPage() {
  const { user, authFetch } = useAuth();
  const t = useTranslations('apiKeys');
  const tCommon = useTranslations('common');
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [newKeyName, setNewKeyName] = useState('');
  const [isMasterKey, setIsMasterKey] = useState(false);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [showKeyModal, { open: openKeyModal, close: closeKeyModal }] = useDisclosure(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const isAdmin = user?.role === 'admin';

  const fetchKeys = useCallback(async () => {
    try {
      const res = await authFetch(`${AUTH_URL}/api-keys`);
      if (res.ok) {
        const data = await res.json();
        setKeys(data.keys || data);
      }
    } finally {
      setLoading(false);
    }
  }, [authFetch]);

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  const handleCreate = async () => {
    if (!newKeyName.trim()) return;
    setCreating(true);
    try {
      const body: Record<string, unknown> = { name: newKeyName.trim() };
      if (isAdmin && isMasterKey) {
        body.is_master = true;
      }
      const res = await authFetch(`${AUTH_URL}/api-keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const data = await res.json();
        setCreatedKey(data.key);
        setNewKeyName('');
        setIsMasterKey(false);
        openKeyModal();
        fetchKeys();
        notifications.show({
          title: 'Success',
          message: 'API key created successfully',
          color: 'green',
        });
      } else {
        const err = await res.json().catch(() => ({}));
        notifications.show({
          title: 'Error',
          message: err.detail || 'Failed to create API key',
          color: 'red',
        });
      }
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (id: string) => {
    const res = await authFetch(`${AUTH_URL}/api-keys/${id}`, { method: 'DELETE' });
    if (res.ok) {
      notifications.show({
        title: 'Success',
        message: 'API key revoked',
        color: 'green',
      });
    } else {
      const err = await res.json().catch(() => ({}));
      notifications.show({
        title: 'Error',
        message: err.detail || 'Failed to revoke API key',
        color: 'red',
      });
    }
    setConfirmDelete(null);
    fetchKeys();
  };

  return (
    <DashboardShell>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />

      <Paper withBorder p="md" radius="md" mb="xl">
        <Group>
          <TextInput
            placeholder={t('namePlaceholder')}
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.currentTarget.value)}
            style={{ flex: 1 }}
          />
          {isAdmin && (
            <Checkbox
              label={t('isMaster')}
              checked={isMasterKey}
              onChange={(e) => setIsMasterKey(e.currentTarget.checked)}
            />
          )}
          <Button
            leftSection={<IconPlus size={16} />}
            onClick={handleCreate}
            loading={creating}
            disabled={!newKeyName.trim()}
          >
            {t('createKey')}
          </Button>
        </Group>
      </Paper>

      {loading ? (
        <SkeletonList count={4} />
      ) : keys.length === 0 ? (
        <EmptyState icon={IconKey} message={t('noKeys')} />
      ) : (
        <>
          <Box visibleFrom="sm">
            <Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{tCommon('name')}</Table.Th>
                  <Table.Th>{t('title')}</Table.Th>
                  <Table.Th>{tCommon('limits')}</Table.Th>
                  <Table.Th>{tCommon('created')}</Table.Th>
                  <Table.Th>{tCommon('actions')}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {keys.map((k) => (
                  <Table.Tr key={k.id}>
                    <Table.Td>
                      <Group gap="xs">
                        {k.name}
                        {k.is_master && (
                          <Badge color="violet" variant="light" size="xs">
                            Master
                          </Badge>
                        )}
                      </Group>
                    </Table.Td>
                    <Table.Td>
                      <Code>{k.key_preview}...</Code>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{k.rate_limit != null ? `${k.rate_limit}/min` : tCommon('noData')}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{new Date(k.created_at).toLocaleDateString()}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Group gap="xs">
                        <Tooltip label={t('keyCreated')}>
                          <ActionIcon variant="light" color="gray" size="sm" disabled aria-label={t('keyCreated')}>
                            <IconEye size={16} />
                          </ActionIcon>
                        </Tooltip>
                        <Tooltip label={tCommon('delete')}>
                          <ActionIcon
                            variant="light"
                            color="red"
                            size="sm"
                            onClick={() => setConfirmDelete(k.id)}
                            aria-label={tCommon('delete')}
                          >
                            <IconTrash size={16} />
                          </ActionIcon>
                        </Tooltip>
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Box>
          <Stack hiddenFrom="sm" gap="xs">
            {keys.map((k) => (
              <Paper key={k.id} p="md" withBorder radius="md">
                <Group justify="space-between" mb="xs" wrap="nowrap">
                  <Group gap="xs" style={{ minWidth: 0 }}>
                    <Text fw={600} truncate>{k.name}</Text>
                    {k.is_master && (
                      <Badge color="violet" variant="light" size="xs">Master</Badge>
                    )}
                  </Group>
                  <ActionIcon variant="light" color="red" size="sm" onClick={() => setConfirmDelete(k.id)} aria-label={tCommon('delete')}>
                    <IconTrash size={16} />
                  </ActionIcon>
                </Group>
                <Code>{k.key_preview}...</Code>
                <Group gap="md" mt="xs">
                  <Text size="xs" c="dimmed">
                    {tCommon('limits')}: {k.rate_limit != null ? `${k.rate_limit}/min` : tCommon('noData')}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {tCommon('created')}: {new Date(k.created_at).toLocaleDateString()}
                  </Text>
                </Group>
              </Paper>
            ))}
          </Stack>
        </>
      )}

      <Modal opened={showKeyModal} onClose={closeKeyModal} title={t('createKey')} centered>
        <Stack>
          <Text size="sm" c="dimmed">
            {t('keyCreated')}
          </Text>
          <Group gap="xs">
            <Code block style={{ flex: 1, wordBreak: 'break-all' }}>
              {createdKey}
            </Code>
            <CopyButton value={createdKey ?? ''}>
              {({ copied, copy }) => (
                <Tooltip label={copied ? tCommon('copied') : tCommon('copy')}>
                  <ActionIcon variant="light" color={copied ? 'teal' : 'gray'} onClick={copy} aria-label={tCommon('copy')}>
                    <IconCopy size={16} />
                  </ActionIcon>
                </Tooltip>
              )}
            </CopyButton>
          </Group>
          <Text size="xs" c="orange" fw={500}>
            {t('keyCreated')}
          </Text>
          <Button onClick={closeKeyModal}>{tCommon('close')}</Button>
        </Stack>
      </Modal>

      <ConfirmDialog
        opened={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => { if (confirmDelete) handleRevoke(confirmDelete); }}
        title={t('revokeKey')}
        message={t('revokeKeyConfirm')}
        confirmLabel={tCommon('delete')}
        danger
      />
    </DashboardShell>
  );
}
