'use client';

import React from 'react';

import {
  ActionIcon,
  Anchor,
  Badge,
  Box,
  Button,
  Collapse,
  Group,
  Modal,
  NumberInput,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import {
  IconBuilding,
  IconChevronDown,
  IconChevronRight,
  IconPlus,
  IconRefresh,
  IconTrash,
} from '@tabler/icons-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { DashboardShell } from '@/components/DashboardShell/DashboardShell';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { SkeletonList } from '@/components/SkeletonList/SkeletonList';
import { AUTH_URL, useAuth } from '@/lib/auth';

interface TenantLimits {
  max_users?: number;
  max_keys?: number;
  rate_limit?: number;
  is_custom?: boolean;
}

interface TenantInfo {
  id: string;
  name: string;
  plan: string;
  is_active: boolean;
  user_count: number;
  key_count: number;
  limits: TenantLimits;
}

interface PlanDefaults {
  max_users: number;
  max_keys: number;
  rate_limit: number;
}

const PLAN_COLORS: Record<string, string> = {
  free: 'gray',
  starter: 'blue',
  pro: 'violet',
  enterprise: 'orange',
};

export default function TenantsPage() {
  const { user, authFetch, tenant_name } = useAuth();
  const router = useRouter();
  const t = useTranslations('tenants');
  const tCommon = useTranslations('common');
  const isAdmin = user?.role === 'admin';
  const isSuperAdmin = isAdmin && tenant_name === 'default';

  const [tenants, setTenants] = useState<TenantInfo[]>([]);
  const [ownTenant, setOwnTenant] = useState<TenantInfo | null>(null);
  const [plans, setPlans] = useState<string[]>([]);
  const [planDefaults, setPlanDefaults] = useState<Record<string, PlanDefaults>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Create modal
  const [createOpened, { open: openCreate, close: closeCreate }] = useDisclosure(false);
  const [newName, setNewName] = useState('');
  const [newPlan, setNewPlan] = useState<string>('free');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  // Expanded row for editing limits
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editMaxUsers, setEditMaxUsers] = useState<number | string>('');
  const [editMaxKeys, setEditMaxKeys] = useState<number | string>('');
  const [editRateLimit, setEditRateLimit] = useState<number | string>('');

  // Delete confirmation
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  useEffect(() => {
    if (!isAdmin) {
      router.replace('/');
    }
  }, [isAdmin, router]);

  const fetchData = useCallback(async () => {
    try {
      // Try fetching all tenants (super admin only)
      const tenantsRes = await authFetch(`${AUTH_URL}/admin/tenants`);
      if (tenantsRes.ok) {
        const data = await tenantsRes.json();
        setTenants(data.tenants || []);

        // Fetch available plans
        const plansRes = await authFetch(`${AUTH_URL}/plans`);
        if (plansRes.ok) {
          const plansData = await plansRes.json();
          if (
            plansData.plans &&
            typeof plansData.plans === 'object' &&
            !Array.isArray(plansData.plans)
          ) {
            setPlans(Object.keys(plansData.plans));
            setPlanDefaults(plansData.plans);
          } else if (Array.isArray(plansData.plans)) {
            setPlans(
              plansData.plans.map((p: any) =>
                typeof p === 'string' ? p : p.name || ''
              )
            );
          }
        }
      } else {
        // Not super admin, show own tenant info
        const tenantRes = await authFetch(`${AUTH_URL}/tenant`);
        if (tenantRes.ok) {
          setOwnTenant(await tenantRes.json());
        }
      }
    } catch {
      setError('Failed to load tenants');
    } finally {
      setLoading(false);
    }
  }, [authFetch]);

  useEffect(() => {
    if (isAdmin) {
      fetchData();
    }
  }, [isAdmin, fetchData]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    setCreateError('');
    try {
      const res = await authFetch(`${AUTH_URL}/admin/tenants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), plan: newPlan }),
      });
      if (res.ok) {
        closeCreate();
        setNewName('');
        setNewPlan('free');
        fetchData();
        notifications.show({
          title: 'Success',
          message: 'Tenant created successfully',
          color: 'green',
        });
      } else {
        const err = await res.json().catch(() => ({}));
        setCreateError(err.detail || 'Failed to create tenant');
        notifications.show({
          title: 'Error',
          message: err.detail || 'Failed to create tenant',
          color: 'red',
        });
      }
    } finally {
      setCreating(false);
    }
  };

  const handlePlanChange = async (tenantId: string, plan: string | null) => {
    if (!plan) return;
    const res = await authFetch(`${AUTH_URL}/admin/tenants/${tenantId}/plan`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan }),
    });
    if (res.ok) {
      notifications.show({
        title: 'Success',
        message: 'Plan updated',
        color: 'green',
      });
    } else {
      const err = await res.json().catch(() => ({}));
      setError(err.detail || 'Failed to change plan');
      notifications.show({
        title: 'Error',
        message: err.detail || 'Failed to change plan',
        color: 'red',
      });
    }
    fetchData();
  };

  const handleDelete = async (tenantId: string) => {
    const res = await authFetch(`${AUTH_URL}/admin/tenants/${tenantId}`, {
      method: 'DELETE',
    });
    if (res.ok) {
      notifications.show({
        title: 'Success',
        message: 'Tenant deleted',
        color: 'green',
      });
    } else {
      const err = await res.json().catch(() => ({}));
      setError(err.detail || 'Failed to delete tenant');
      notifications.show({
        title: 'Error',
        message: err.detail || 'Failed to delete tenant',
        color: 'red',
      });
    }
    setConfirmDeleteId(null);
    fetchData();
  };

  const handleExpandRow = (tenant: TenantInfo) => {
    if (expandedId === tenant.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(tenant.id);
    setEditMaxUsers(tenant.limits?.max_users ?? '');
    setEditMaxKeys(tenant.limits?.max_keys ?? '');
    setEditRateLimit(tenant.limits?.rate_limit ?? '');
  };

  const handleSaveLimits = async (tenantId: string) => {
    const body: Record<string, unknown> = {};
    if (editMaxUsers !== '') body.custom_max_users = Number(editMaxUsers);
    if (editMaxKeys !== '') body.custom_max_keys = Number(editMaxKeys);
    if (editRateLimit !== '') body.custom_rate_limit = Number(editRateLimit);

    const res = await authFetch(`${AUTH_URL}/admin/tenants/${tenantId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      notifications.show({
        title: 'Success',
        message: 'Custom limits saved',
        color: 'green',
      });
    } else {
      const err = await res.json().catch(() => ({}));
      setError(err.detail || 'Failed to update limits');
      notifications.show({
        title: 'Error',
        message: err.detail || 'Failed to update limits',
        color: 'red',
      });
    }
    setExpandedId(null);
    fetchData();
  };

  const handleResetToDefaults = async (tenantId: string) => {
    const res = await authFetch(`${AUTH_URL}/admin/tenants/${tenantId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clear_custom: true }),
    });
    if (res.ok) {
      notifications.show({
        title: 'Success',
        message: 'Limits reset to plan defaults',
        color: 'green',
      });
    } else {
      const err = await res.json().catch(() => ({}));
      setError(err.detail || 'Failed to reset limits');
      notifications.show({
        title: 'Error',
        message: err.detail || 'Failed to reset limits',
        color: 'red',
      });
    }
    setExpandedId(null);
    fetchData();
  };

  if (!isAdmin) return null;

  return (
    <DashboardShell>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          isSuperAdmin && (
            <Button leftSection={<IconPlus size={16} />} onClick={openCreate}>
              {t('createTenant')}
            </Button>
          )
        }
      />

      {error && (
        <Text c="red" mb="md">
          {error}
        </Text>
      )}

      {loading ? (
        <SkeletonList count={6} />
      ) : isSuperAdmin ? (
        <>
          {/* Plan defaults reference */}
          {Object.keys(planDefaults).length > 0 && (
            <Paper withBorder p="md" radius="md" mb="xl">
              <Text fw={600} mb="sm">
                Plan Defaults
              </Text>
              <SimpleGrid cols={{ base: 1, xs: 2, md: 4 }}>
                {Object.entries(planDefaults).map(([name, defaults]) => (
                  <Stack key={name} gap={4}>
                    <Badge
                      color={PLAN_COLORS[name] || 'gray'}
                      variant="light"
                      size="sm"
                    >
                      {name}
                    </Badge>
                    <Text size="xs" c="dimmed">
                      Users: {defaults.max_users}, Keys: {defaults.max_keys},
                      Rate: {defaults.rate_limit}/min
                    </Text>
                  </Stack>
                ))}
              </SimpleGrid>
            </Paper>
          )}

          {tenants.length === 0 ? (
            <EmptyState icon={IconBuilding} message="No tenants found." />
          ) : (
            <>
            <Box visibleFrom="sm">
            <Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th />
                  <Table.Th>Name</Table.Th>
                  <Table.Th>Plan</Table.Th>
                  <Table.Th>Users</Table.Th>
                  <Table.Th>Keys</Table.Th>
                  <Table.Th>Limits</Table.Th>
                  <Table.Th>Custom</Table.Th>
                  <Table.Th>Actions</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {tenants.map((t) => (
                  <React.Fragment key={t.id}>
                    <Table.Tr
                      style={{ cursor: 'pointer' }}
                      onClick={() => handleExpandRow(t)}
                    >
                      <Table.Td w={30}>
                        {expandedId === t.id ? (
                          <IconChevronDown size={16} />
                        ) : (
                          <IconChevronRight size={16} />
                        )}
                      </Table.Td>
                      <Table.Td>
                        <Group gap="xs">
                          <Anchor
                            component={Link}
                            href={`/tenants/${t.id}`}
                            fw={500}
                            onClick={(e: React.MouseEvent) => e.stopPropagation()}
                          >
                            {t.name}
                          </Anchor>
                          {t.name === 'demo' && (
                            <Badge color="yellow" variant="light" size="xs">
                              Demo
                            </Badge>
                          )}
                        </Group>
                      </Table.Td>
                      <Table.Td>
                        {plans.length > 0 ? (
                          <Select
                            size="xs"
                            w={130}
                            data={plans}
                            value={t.plan}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(val) => handlePlanChange(t.id, val)}
                          />
                        ) : (
                          <Badge
                            color={PLAN_COLORS[t.plan] || 'gray'}
                            variant="light"
                            size="sm"
                          >
                            {t.plan}
                          </Badge>
                        )}
                      </Table.Td>
                      <Table.Td>{t.user_count}</Table.Td>
                      <Table.Td>{t.key_count}</Table.Td>
                      <Table.Td>
                        {t.limits ? (
                          <Text size="xs" c="dimmed">
                            {Object.entries(t.limits)
                              .filter(([k]) => k !== 'is_custom')
                              .map(
                                ([k, v]) =>
                                  `${k.replace(/_/g, ' ')}: ${v}`
                              )
                              .join(', ')}
                          </Text>
                        ) : (
                          <Text size="xs" c="dimmed">
                            --
                          </Text>
                        )}
                      </Table.Td>
                      <Table.Td>
                        {t.limits?.is_custom && (
                          <Badge color="yellow" variant="light" size="xs">
                            Custom
                          </Badge>
                        )}
                      </Table.Td>
                      <Table.Td>
                        {confirmDeleteId === t.id ? (
                          <Group gap="xs" onClick={(e) => e.stopPropagation()}>
                            <Button
                              size="xs"
                              color="red"
                              variant="filled"
                              onClick={() => handleDelete(t.id)}
                            >
                              Confirm
                            </Button>
                            <Button
                              size="xs"
                              variant="default"
                              onClick={() => setConfirmDeleteId(null)}
                            >
                              Cancel
                            </Button>
                          </Group>
                        ) : (
                          <Tooltip
                            label={
                              t.user_count > 0
                                ? 'Cannot delete: has users'
                                : 'Delete tenant'
                            }
                          >
                            <ActionIcon
                              variant="light"
                              color="red"
                              size="sm"
                              disabled={t.user_count > 0}
                              onClick={(e) => {
                                e.stopPropagation();
                                setConfirmDeleteId(t.id);
                              }}
                            >
                              <IconTrash size={16} />
                            </ActionIcon>
                          </Tooltip>
                        )}
                      </Table.Td>
                    </Table.Tr>
                    {expandedId === t.id && (
                      <Table.Tr key={`${t.id}-edit`}>
                        <Table.Td colSpan={8}>
                          <Collapse expanded={expandedId === t.id}>
                            <Paper withBorder p="md" radius="md" mt="xs" mb="xs">
                              <Text fw={600} mb="sm">
                                Custom Limits for &quot;{t.name}&quot;
                              </Text>
                              <Group mb="md">
                                <NumberInput
                                  label="Max Users"
                                  value={editMaxUsers}
                                  onChange={setEditMaxUsers}
                                  min={1}
                                  size="xs"
                                  w={120}
                                />
                                <NumberInput
                                  label="Max Keys"
                                  value={editMaxKeys}
                                  onChange={setEditMaxKeys}
                                  min={1}
                                  size="xs"
                                  w={120}
                                />
                                <NumberInput
                                  label="Rate Limit (/min)"
                                  value={editRateLimit}
                                  onChange={setEditRateLimit}
                                  min={1}
                                  size="xs"
                                  w={140}
                                />
                              </Group>
                              <Group>
                                <Button
                                  size="xs"
                                  onClick={() => handleSaveLimits(t.id)}
                                >
                                  Save Custom Limits
                                </Button>
                                <Button
                                  size="xs"
                                  variant="light"
                                  color="gray"
                                  leftSection={<IconRefresh size={14} />}
                                  onClick={() => handleResetToDefaults(t.id)}
                                >
                                  Reset to Plan Defaults
                                </Button>
                              </Group>
                            </Paper>
                          </Collapse>
                        </Table.Td>
                      </Table.Tr>
                    )}
                  </React.Fragment>
                ))}
              </Table.Tbody>
            </Table>
            </Box>
            <Stack hiddenFrom="sm" gap="xs">
              {tenants.map((tn) => (
                <Paper key={tn.id} p="md" withBorder radius="md">
                  <Group justify="space-between" mb="xs" wrap="nowrap">
                    <Anchor component={Link} href={`/tenants/${tn.id}`} fw={500} truncate>
                      {tn.name}
                    </Anchor>
                    <Badge color={PLAN_COLORS[tn.plan] || 'gray'} variant="light" size="sm">
                      {tn.plan}
                    </Badge>
                  </Group>
                  <Group gap="md">
                    <Text size="xs" c="dimmed">Users: {tn.user_count}</Text>
                    <Text size="xs" c="dimmed">Keys: {tn.key_count}</Text>
                    {tn.limits?.is_custom && (
                      <Badge color="yellow" variant="light" size="xs">Custom</Badge>
                    )}
                  </Group>
                </Paper>
              ))}
            </Stack>
            </>
          )}
        </>
      ) : ownTenant ? (
        <Paper withBorder p="lg" radius="md">
          <Group justify="space-between" mb="md">
            <Text fw={600} fz="lg">
              Your Tenant
            </Text>
            <Badge
              color={PLAN_COLORS[ownTenant.plan] || 'gray'}
              variant="light"
              size="lg"
            >
              {ownTenant.plan}
            </Badge>
          </Group>
          <SimpleGrid cols={{ base: 1, xs: 2, md: 3 }}>
            <Stack gap={4}>
              <Text size="sm" c="dimmed">
                Tenant Name
              </Text>
              <Text fw={500}>{ownTenant.name}</Text>
            </Stack>
            <Stack gap={4}>
              <Text size="sm" c="dimmed">
                Users
              </Text>
              <Text fw={500}>{ownTenant.user_count}</Text>
            </Stack>
            <Stack gap={4}>
              <Text size="sm" c="dimmed">
                API Keys
              </Text>
              <Text fw={500}>{ownTenant.key_count}</Text>
            </Stack>
            {ownTenant.limits &&
              Object.entries(ownTenant.limits)
                .filter(([k]) => k !== 'is_custom')
                .map(([key, value]) => (
                  <Stack gap={4} key={key}>
                    <Text size="sm" c="dimmed">
                      {key
                        .replace(/_/g, ' ')
                        .replace(/\b\w/g, (c) => c.toUpperCase())}
                    </Text>
                    <Text fw={500}>{String(value)}</Text>
                  </Stack>
                ))}
          </SimpleGrid>
        </Paper>
      ) : (
        <Text c="dimmed">Unable to load tenant information.</Text>
      )}

      {/* Create Tenant Modal */}
      <Modal
        opened={createOpened}
        onClose={closeCreate}
        title="Create Tenant"
        centered
      >
        <TextInput
          label="Tenant Name"
          placeholder="My Organization"
          value={newName}
          onChange={(e) => setNewName(e.currentTarget.value)}
          mb="sm"
          required
        />
        <Select
          label="Plan"
          data={plans.length > 0 ? plans : ['free', 'starter', 'pro', 'enterprise']}
          value={newPlan}
          onChange={(val) => setNewPlan(val || 'free')}
          mb="md"
        />
        {createError && (
          <Text c="red" size="sm" mb="sm">
            {createError}
          </Text>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={closeCreate}>
            Cancel
          </Button>
          <Button
            onClick={handleCreate}
            loading={creating}
            disabled={!newName.trim()}
          >
            Create
          </Button>
        </Group>
      </Modal>
    </DashboardShell>
  );
}
