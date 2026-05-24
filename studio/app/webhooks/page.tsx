'use client';

import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Code,
  CopyButton,
  Group,
  Modal,
  Paper,
  Select,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
  IconCopy,
  IconHistory,
  IconPencil,
  IconPlus,
  IconSend,
  IconTrash,
  IconWebhook,
} from '@tabler/icons-react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { DashboardShell } from '@/components/DashboardShell/DashboardShell';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { SkeletonList } from '@/components/SkeletonList/SkeletonList';
import { AUTH_URL, useAuth } from '@/lib/auth';

interface Webhook {
  id: string;
  tenant_id: string;
  api_key_id: string | null;
  name: string;
  url: string;
  enabled: boolean;
  trigger_endpoint: 'classify' | 'rateme' | 'any';
  trigger_threshold: string;
  created_at: string;
  updated_at: string;
}

interface ApiKeyRow {
  id: string;
  name: string;
  is_master: boolean;
}

interface Delivery {
  id: string;
  event_type: string;
  response_status: number | null;
  response_body: string | null;
  attempt: number;
  succeeded: boolean;
  created_at: string;
  next_retry_at: string | null;
}

const RATEME_CATEGORIES = [
  'safe',
  'mild',
  'suggestive',
  'sensual',
  'erotic',
  'explicit',
  'extreme',
];

const TRIGGER_ENDPOINT_OPTIONS = [
  { value: 'any', label: 'Any (classify + rateme)' },
  { value: 'classify', label: 'Classify only' },
  { value: 'rateme', label: 'Rate-Me only' },
];

function thresholdOptionsFor(endpoint: string) {
  if (endpoint === 'rateme') {
    return RATEME_CATEGORIES.map((c) => ({ value: c, label: `>= ${c}` }));
  }
  return [
    { value: 'any_detection', label: 'Any detection' },
    { value: 'FEMALE_BREAST_EXPOSED', label: 'FEMALE_BREAST_EXPOSED' },
    { value: 'FEMALE_GENITALIA_EXPOSED', label: 'FEMALE_GENITALIA_EXPOSED' },
    { value: 'MALE_GENITALIA_EXPOSED', label: 'MALE_GENITALIA_EXPOSED' },
    { value: 'BUTTOCKS_EXPOSED', label: 'BUTTOCKS_EXPOSED' },
    { value: 'ANUS_EXPOSED', label: 'ANUS_EXPOSED' },
    { value: 'MAKE_LOVE', label: 'MAKE_LOVE' },
  ];
}

export default function WebhooksPage() {
  const { user, authFetch } = useAuth();
  const tNav = useTranslations('nav');
  const tCommon = useTranslations('common');
  const [hooks, setHooks] = useState<Webhook[]>([]);
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Webhook | null>(null);
  const [form, setForm] = useState({
    name: '',
    url: '',
    trigger_endpoint: 'any' as 'any' | 'classify' | 'rateme',
    trigger_threshold: 'any_detection',
    enabled: true,
    api_key_id: '' as string,
  });
  const [secretModal, setSecretModal] = useState<{ secret: string; hookName: string } | null>(null);
  const [deliveriesFor, setDeliveriesFor] = useState<{ hook: Webhook; items: Delivery[] } | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; status: number | null; body: string | null } | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [formOpened, { open: openForm, close: closeForm }] = useDisclosure(false);
  const [secretOpened, { open: openSecret, close: closeSecret }] = useDisclosure(false);
  const [deliveriesOpened, { open: openDeliveries, close: closeDeliveries }] = useDisclosure(false);

  const isAdmin = user?.role === 'admin';

  const fetchAll = useCallback(async () => {
    try {
      const [hRes, kRes] = await Promise.all([
        authFetch(`${AUTH_URL}/webhooks`),
        authFetch(`${AUTH_URL}/api-keys`),
      ]);
      if (hRes.ok) {
        const data = await hRes.json();
        setHooks(data.webhooks || []);
      }
      if (kRes.ok) {
        const data = await kRes.json();
        setKeys((data.keys || []).map((k: { id: string; name: string; is_master: boolean }) => ({ id: k.id, name: k.name, is_master: k.is_master })));
      }
    } finally {
      setLoading(false);
    }
  }, [authFetch]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const resetForm = () => {
    setForm({ name: '', url: '', trigger_endpoint: 'any', trigger_threshold: 'any_detection', enabled: true, api_key_id: '' });
    setEditing(null);
  };

  const openCreate = () => {
    resetForm();
    openForm();
  };

  const openEdit = (h: Webhook) => {
    setEditing(h);
    setForm({
      name: h.name,
      url: h.url,
      trigger_endpoint: h.trigger_endpoint,
      trigger_threshold: h.trigger_threshold,
      enabled: h.enabled,
      api_key_id: h.api_key_id ?? '',
    });
    openForm();
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.url.trim()) return;
    if (!form.url.startsWith('https://') && !form.url.startsWith('http://')) {
      alert('URL must start with http:// or https://');
      return;
    }
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        name: form.name.trim(),
        url: form.url.trim(),
        trigger_endpoint: form.trigger_endpoint,
        trigger_threshold: form.trigger_threshold,
        enabled: form.enabled,
        api_key_id: form.api_key_id || null,
      };
      if (editing) {
        const res = await authFetch(`${AUTH_URL}/webhooks/${editing.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (res.ok) {
          closeForm();
          resetForm();
          fetchAll();
        }
      } else {
        const res = await authFetch(`${AUTH_URL}/webhooks`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (res.ok) {
          const data = await res.json();
          closeForm();
          if (data.secret) {
            setSecretModal({ secret: data.secret, hookName: data.name });
            openSecret();
          }
          resetForm();
          fetchAll();
        }
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    await authFetch(`${AUTH_URL}/webhooks/${id}`, { method: 'DELETE' });
    setConfirmDelete(null);
    fetchAll();
  };

  const handleTest = async (h: Webhook) => {
    setTestResult(null);
    const res = await authFetch(`${AUTH_URL}/webhooks/${h.id}/test`, { method: 'POST' });
    if (res.ok) {
      const data = await res.json();
      setTestResult({ ok: data.succeeded, status: data.response_status, body: data.response_body });
    }
  };

  const handleShowDeliveries = async (h: Webhook) => {
    const res = await authFetch(`${AUTH_URL}/webhooks/${h.id}/deliveries`);
    if (res.ok) {
      const data = await res.json();
      setDeliveriesFor({ hook: h, items: data.deliveries || [] });
      openDeliveries();
    }
  };

  return (
    <DashboardShell>
      <PageHeader
        title={tNav('webhooks')}
        actions={
          <Button leftSection={<IconPlus size={16} />} onClick={openCreate}>
            {tCommon('create')}
          </Button>
        }
      />

      <Text size="sm" c="dimmed" mb="md">
        Outbound webhooks fire on detection events. Each request is signed with HMAC-SHA256 in
        the <Code>X-Webhook-Signature</Code> header; verify with your endpoint secret.
      </Text>

      {testResult && (
        <Paper
          withBorder
          p="sm"
          radius="md"
          mb="md"
          style={{ borderColor: testResult.ok ? 'var(--mantine-color-teal-6)' : 'var(--mantine-color-red-6)' }}
        >
          <Group gap="xs" mb="xs">
            <Badge color={testResult.ok ? 'teal' : 'red'}>
              {testResult.ok ? 'Test OK' : 'Test Failed'}
            </Badge>
            <Text size="sm">Status: {testResult.status ?? 'n/a'}</Text>
            <Button size="xs" variant="subtle" onClick={() => setTestResult(null)}>
              Dismiss
            </Button>
          </Group>
          <Code block style={{ maxHeight: 120, overflow: 'auto' }}>
            {testResult.body || '(no body)'}
          </Code>
        </Paper>
      )}

      {loading ? (
        <SkeletonList count={4} />
      ) : hooks.length === 0 ? (
        <EmptyState icon={IconWebhook} message="No webhooks configured yet." />
      ) : (
        <>
        <Box visibleFrom="sm">
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Name</Table.Th>
              <Table.Th>URL</Table.Th>
              <Table.Th>Trigger</Table.Th>
              <Table.Th>Scope</Table.Th>
              <Table.Th>Enabled</Table.Th>
              <Table.Th>Actions</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {hooks.map((h) => (
              <Table.Tr key={h.id}>
                <Table.Td>{h.name}</Table.Td>
                <Table.Td>
                  <Code>{h.url}</Code>
                </Table.Td>
                <Table.Td>
                  <Badge variant="light" color="violet">
                    {h.trigger_endpoint}
                  </Badge>{' '}
                  <Text component="span" size="sm" c="dimmed">
                    {h.trigger_threshold}
                  </Text>
                </Table.Td>
                <Table.Td>
                  {h.api_key_id ? (
                    <Badge variant="light" color="blue">
                      {keys.find((k) => k.id === h.api_key_id)?.name ?? 'key'}
                    </Badge>
                  ) : (
                    <Badge variant="light" color="gray">
                      Tenant-wide
                    </Badge>
                  )}
                </Table.Td>
                <Table.Td>
                  <Badge color={h.enabled ? 'teal' : 'gray'}>{h.enabled ? 'on' : 'off'}</Badge>
                </Table.Td>
                <Table.Td>
                  <Group gap="xs">
                    <Tooltip label="Send test event">
                      <ActionIcon variant="light" color="blue" size="sm" onClick={() => handleTest(h)}>
                        <IconSend size={16} />
                      </ActionIcon>
                    </Tooltip>
                    <Tooltip label="Delivery history">
                      <ActionIcon variant="light" color="gray" size="sm" onClick={() => handleShowDeliveries(h)}>
                        <IconHistory size={16} />
                      </ActionIcon>
                    </Tooltip>
                    <Tooltip label="Edit">
                      <ActionIcon variant="light" color="gray" size="sm" onClick={() => openEdit(h)}>
                        <IconPencil size={16} />
                      </ActionIcon>
                    </Tooltip>
                    {confirmDelete === h.id ? (
                      <>
                        <Button size="xs" color="red" variant="filled" onClick={() => handleDelete(h.id)}>
                          Confirm
                        </Button>
                        <Button size="xs" variant="default" onClick={() => setConfirmDelete(null)}>
                          Cancel
                        </Button>
                      </>
                    ) : (
                      <Tooltip label="Delete">
                        <ActionIcon variant="light" color="red" size="sm" onClick={() => setConfirmDelete(h.id)}>
                          <IconTrash size={16} />
                        </ActionIcon>
                      </Tooltip>
                    )}
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
        </Box>
        <Stack hiddenFrom="sm" gap="xs">
          {hooks.map((h) => (
            <Paper key={h.id} p="md" withBorder radius="md">
              <Group justify="space-between" mb="xs" wrap="nowrap">
                <Text fw={600} truncate>{h.name}</Text>
                <Badge color={h.enabled ? 'teal' : 'gray'}>{h.enabled ? 'on' : 'off'}</Badge>
              </Group>
              <Code style={{ wordBreak: 'break-all', display: 'block' }}>{h.url}</Code>
              <Group gap="xs" mt="xs">
                <Badge variant="light" color="violet" size="sm">{h.trigger_endpoint}</Badge>
                <Text size="xs" c="dimmed">{h.trigger_threshold}</Text>
              </Group>
              <Group gap="xs" mt="sm">
                <ActionIcon variant="light" color="blue" size="sm" onClick={() => handleTest(h)}>
                  <IconSend size={16} />
                </ActionIcon>
                <ActionIcon variant="light" color="gray" size="sm" onClick={() => handleShowDeliveries(h)}>
                  <IconHistory size={16} />
                </ActionIcon>
                <ActionIcon variant="light" color="gray" size="sm" onClick={() => openEdit(h)}>
                  <IconPencil size={16} />
                </ActionIcon>
                {confirmDelete === h.id ? (
                  <>
                    <Button size="xs" color="red" variant="filled" onClick={() => handleDelete(h.id)}>Confirm</Button>
                    <Button size="xs" variant="default" onClick={() => setConfirmDelete(null)}>Cancel</Button>
                  </>
                ) : (
                  <ActionIcon variant="light" color="red" size="sm" onClick={() => setConfirmDelete(h.id)}>
                    <IconTrash size={16} />
                  </ActionIcon>
                )}
              </Group>
            </Paper>
          ))}
        </Stack>
        </>
      )}

      {/* Create / Edit modal */}
      <Modal opened={formOpened} onClose={closeForm} title={editing ? 'Edit Webhook' : 'New Webhook'} centered size="md">
        <Stack>
          <TextInput
            label="Name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.currentTarget.value })}
            required
          />
          <TextInput
            label="URL"
            placeholder="https://example.com/webhook"
            value={form.url}
            onChange={(e) => setForm({ ...form, url: e.currentTarget.value })}
            required
          />
          <Select
            label="Trigger endpoint"
            data={TRIGGER_ENDPOINT_OPTIONS}
            value={form.trigger_endpoint}
            onChange={(v) => {
              const endpoint = (v as 'any' | 'classify' | 'rateme') || 'any';
              const opts = thresholdOptionsFor(endpoint);
              setForm({
                ...form,
                trigger_endpoint: endpoint,
                trigger_threshold: opts[0]?.value ?? 'any_detection',
              });
            }}
            allowDeselect={false}
          />
          <Select
            label="Threshold"
            data={thresholdOptionsFor(form.trigger_endpoint)}
            value={form.trigger_threshold}
            onChange={(v) => setForm({ ...form, trigger_threshold: v || 'any_detection' })}
            allowDeselect={false}
            searchable
          />
          <Select
            label="Scope"
            description={isAdmin ? 'Tenant-wide (all keys) or restrict to one key' : 'Restrict to a key you own'}
            data={[
              ...(isAdmin ? [{ value: '', label: 'Tenant-wide (all keys)' }] : []),
              ...keys.map((k) => ({ value: k.id, label: k.name + (k.is_master ? ' [master]' : '') })),
            ]}
            value={form.api_key_id}
            onChange={(v) => setForm({ ...form, api_key_id: v ?? '' })}
          />
          <Switch
            label="Enabled"
            checked={form.enabled}
            onChange={(e) => setForm({ ...form, enabled: e.currentTarget.checked })}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={closeForm}>
              Cancel
            </Button>
            <Button loading={saving} onClick={handleSave}>
              {editing ? 'Save' : 'Create'}
            </Button>
          </Group>
        </Stack>
      </Modal>

      {/* Secret modal (one-time) */}
      <Modal opened={secretOpened} onClose={closeSecret} title="Webhook Secret" centered>
        <Stack>
          <Text size="sm" c="dimmed">
            Copy this secret now. <b>It will not be shown again.</b> Use it to verify the{' '}
            <Code>X-Webhook-Signature</Code> header on incoming requests.
          </Text>
          <Group gap="xs">
            <Code block style={{ flex: 1, wordBreak: 'break-all' }}>
              {secretModal?.secret}
            </Code>
            <CopyButton value={secretModal?.secret ?? ''}>
              {({ copied, copy }) => (
                <Tooltip label={copied ? 'Copied' : 'Copy'}>
                  <ActionIcon variant="light" color={copied ? 'teal' : 'gray'} onClick={copy}>
                    <IconCopy size={16} />
                  </ActionIcon>
                </Tooltip>
              )}
            </CopyButton>
          </Group>
          <Text size="xs" c="orange" fw={500}>
            Store it securely — this is the only time the full secret will be displayed.
          </Text>
          <Button onClick={closeSecret}>Done</Button>
        </Stack>
      </Modal>

      {/* Deliveries history modal */}
      <Modal
        opened={deliveriesOpened}
        onClose={closeDeliveries}
        title={`Deliveries — ${deliveriesFor?.hook.name ?? ''}`}
        size="lg"
        centered
      >
        {deliveriesFor && deliveriesFor.items.length === 0 ? (
          <Text c="dimmed">No deliveries yet.</Text>
        ) : (
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>When</Table.Th>
                <Table.Th>Event</Table.Th>
                <Table.Th>Status</Table.Th>
                <Table.Th>Attempt</Table.Th>
                <Table.Th>Response</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {deliveriesFor?.items.map((d) => (
                <Table.Tr key={d.id}>
                  <Table.Td>
                    <Text size="xs">{new Date(d.created_at).toLocaleString()}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Code>{d.event_type}</Code>
                  </Table.Td>
                  <Table.Td>
                    <Badge color={d.succeeded ? 'teal' : 'red'}>
                      {d.response_status ?? 'err'}
                    </Badge>
                  </Table.Td>
                  <Table.Td>{d.attempt}</Table.Td>
                  <Table.Td>
                    <Code style={{ maxWidth: 300, display: 'inline-block', wordBreak: 'break-all' }}>
                      {(d.response_body ?? '').slice(0, 200)}
                    </Code>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Modal>
    </DashboardShell>
  );
}
