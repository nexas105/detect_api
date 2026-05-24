'use client';

import {
  ActionIcon,
  Anchor,
  Badge,
  Box,
  Button,
  Group,
  Modal,
  Paper,
  PasswordInput,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import {
  IconPlus,
  IconTrash,
  IconUserCheck,
  IconUserOff,
  IconUsers,
  IconArrowsExchange,
} from '@tabler/icons-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { DashboardShell } from '@/components/DashboardShell/DashboardShell';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { SkeletonList } from '@/components/SkeletonList/SkeletonList';
import { ConfirmDialog } from '@/components/ConfirmDialog/ConfirmDialog';
import { AUTH_URL, useAuth } from '@/lib/auth';

interface TenantUser {
  id: string;
  email: string;
  role: string;
  is_active: boolean;
  created_at: string;
  tenant_name?: string;
  tenant_id?: string;
}

interface TenantInfo {
  id: string;
  name: string;
  limits: Record<string, unknown>;
  user_count: number;
}

interface TenantOption {
  id: string;
  name: string;
}

const ROLES = ['admin', 'customer', 'user', 'free', 'premium'];

export default function UsersPage() {
  const { user, authFetch, tenant_name } = useAuth();
  const router = useRouter();
  const t = useTranslations('users');
  const tCommon = useTranslations('common');
  const [users, setUsers] = useState<TenantUser[]>([]);
  const [tenant, setTenant] = useState<TenantInfo | null>(null);
  const [tenants, setTenants] = useState<TenantOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Create modal
  const [createOpened, { open: openCreate, close: closeCreate }] = useDisclosure(false);
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<string>('user');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  // Delete confirmation
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Move user modal
  const [moveUserId, setMoveUserId] = useState<string | null>(null);
  const [moveTenantId, setMoveTenantId] = useState<string | null>(null);

  const isAdmin = user?.role === 'admin';
  const isSuperAdmin = isAdmin && tenant_name === 'default';

  const fetchUsers = useCallback(async () => {
    try {
      const endpoint = isSuperAdmin
        ? `${AUTH_URL}/admin/all-users`
        : `${AUTH_URL}/admin/users`;

      const promises: Promise<Response>[] = [
        authFetch(endpoint),
        authFetch(`${AUTH_URL}/tenant`),
      ];

      if (isSuperAdmin) {
        promises.push(authFetch(`${AUTH_URL}/admin/tenants`));
      }

      const results = await Promise.all(promises);

      if (results[0].ok) {
        const data = await results[0].json();
        setUsers(data.users || []);
      }
      if (results[1].ok) {
        setTenant(await results[1].json());
      }
      if (isSuperAdmin && results[2]?.ok) {
        const data = await results[2].json();
        const tenantList = data.tenants || [];
        setTenants(tenantList.map((t: any) => ({ id: t.id, name: t.name })));
      }
    } catch {
      setError('Failed to load users');
    } finally {
      setLoading(false);
    }
  }, [authFetch, isSuperAdmin]);

  useEffect(() => {
    if (!isAdmin) {
      router.replace('/');
      return;
    }
    fetchUsers();
  }, [isAdmin, router, fetchUsers]);

  const handleCreate = async () => {
    if (!newEmail.trim() || !newPassword.trim()) return;
    setCreating(true);
    setCreateError('');
    try {
      const res = await authFetch(`${AUTH_URL}/admin/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: newEmail.trim(), password: newPassword, role: newRole }),
      });
      if (res.ok) {
        closeCreate();
        setNewEmail('');
        setNewPassword('');
        setNewRole('user');
        fetchUsers();
        notifications.show({
          title: 'Success',
          message: 'User created successfully',
          color: 'green',
        });
      } else {
        const err = await res.json().catch(() => ({}));
        setCreateError(err.detail || 'Failed to create user');
        notifications.show({
          title: 'Error',
          message: err.detail || 'Failed to create user',
          color: 'red',
        });
      }
    } finally {
      setCreating(false);
    }
  };

  const handleRoleChange = async (userId: string, newRole: string | null) => {
    if (!newRole) return;
    const res = await authFetch(`${AUTH_URL}/admin/users/${userId}/role`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: newRole }),
    });
    if (res.ok) {
      notifications.show({
        title: 'Success',
        message: 'User role updated',
        color: 'green',
      });
    } else {
      const err = await res.json().catch(() => ({}));
      setError(err.detail || 'Failed to change role');
      notifications.show({
        title: 'Error',
        message: err.detail || 'Failed to change role',
        color: 'red',
      });
    }
    fetchUsers();
  };

  const handleToggleActive = async (userId: string, isActive: boolean) => {
    const action = isActive ? 'deactivate' : 'activate';
    const res = await authFetch(`${AUTH_URL}/admin/users/${userId}/${action}`, {
      method: 'PATCH',
    });
    if (res.ok) {
      notifications.show({
        title: 'Success',
        message: `User ${action}d successfully`,
        color: 'green',
      });
    } else {
      const err = await res.json().catch(() => ({}));
      setError(err.detail || `Failed to ${action} user`);
      notifications.show({
        title: 'Error',
        message: err.detail || `Failed to ${action} user`,
        color: 'red',
      });
    }
    fetchUsers();
  };

  const handleDelete = async (userId: string) => {
    const res = await authFetch(`${AUTH_URL}/admin/users/${userId}`, {
      method: 'DELETE',
    });
    if (res.ok) {
      notifications.show({
        title: 'Success',
        message: 'User deleted',
        color: 'green',
      });
    } else {
      const err = await res.json().catch(() => ({}));
      setError(err.detail || 'Failed to delete user');
      notifications.show({
        title: 'Error',
        message: err.detail || 'Failed to delete user',
        color: 'red',
      });
    }
    setConfirmDeleteId(null);
    fetchUsers();
  };

  const handleMoveUser = async () => {
    if (!moveUserId || !moveTenantId) return;
    const res = await authFetch(
      `${AUTH_URL}/admin/users/${moveUserId}/tenant?tenant_id=${moveTenantId}`,
      { method: 'PATCH' }
    );
    if (res.ok) {
      notifications.show({
        title: 'Success',
        message: 'User moved to new tenant',
        color: 'green',
      });
    } else {
      const err = await res.json().catch(() => ({}));
      setError(err.detail || 'Failed to move user');
      notifications.show({
        title: 'Error',
        message: err.detail || 'Failed to move user',
        color: 'red',
      });
    }
    setMoveUserId(null);
    setMoveTenantId(null);
    fetchUsers();
  };

  if (!isAdmin) return null;

  const userLimit =
    tenant?.limits && typeof tenant.limits === 'object'
      ? (tenant.limits as Record<string, unknown>).max_users
      : null;

  return (
    <DashboardShell>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          <>
            {tenant && (
              <Badge color="violet" variant="light" size="lg">
                {users.length}
                {userLimit != null ? ` / ${userLimit}` : ''} {tCommon('users')}
              </Badge>
            )}
            <Button leftSection={<IconPlus size={16} />} onClick={openCreate}>
              {t('createUser')}
            </Button>
          </>
        }
      />

      {error && (
        <Text c="red" mb="md">
          {error}
        </Text>
      )}

      {loading ? (
        <SkeletonList count={6} />
      ) : users.length === 0 ? (
        <EmptyState icon={IconUsers} message={tCommon('noData')} />
      ) : (
        <>
        <Box visibleFrom="sm">
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{tCommon('email')}</Table.Th>
              <Table.Th>{tCommon('role')}</Table.Th>
              <Table.Th>{tCommon('status')}</Table.Th>
              {isSuperAdmin && <Table.Th>{tCommon('tenant')}</Table.Th>}
              <Table.Th>{tCommon('created')}</Table.Th>
              <Table.Th>{tCommon('actions')}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {users.map((u) => (
              <Table.Tr key={u.id}>
                <Table.Td>
                  {isSuperAdmin ? (
                    <Anchor component={Link} href={`/users/${u.id}`} fw={500}>
                      {u.email}
                    </Anchor>
                  ) : (
                    <Text fw={500}>{u.email}</Text>
                  )}
                </Table.Td>
                <Table.Td>
                  <Select
                    size="xs"
                    w={130}
                    data={ROLES}
                    value={u.role}
                    onChange={(val) => handleRoleChange(u.id, val)}
                    disabled={u.id === user?.id}
                  />
                </Table.Td>
                <Table.Td>
                  <Badge
                    color={u.is_active ? 'green' : 'red'}
                    variant="light"
                    size="sm"
                  >
                    {u.is_active ? 'Active' : 'Inactive'}
                  </Badge>
                </Table.Td>
                {isSuperAdmin && (
                  <Table.Td>
                    {u.tenant_id ? (
                      <Anchor component={Link} href={`/tenants/${u.tenant_id}`} size="sm">
                        {u.tenant_name || '--'}
                      </Anchor>
                    ) : (
                      <Text size="sm">{u.tenant_name || '--'}</Text>
                    )}
                  </Table.Td>
                )}
                <Table.Td>
                  <Text size="sm">
                    {new Date(u.created_at).toLocaleDateString()}
                  </Text>
                </Table.Td>
                <Table.Td>
                  {u.id !== user?.id && (
                    <Group gap="xs">
                      <Tooltip
                        label={u.is_active ? 'Deactivate user' : 'Activate user'}
                      >
                        <ActionIcon
                          variant="light"
                          color={u.is_active ? 'orange' : 'green'}
                          size="sm"
                          onClick={() => handleToggleActive(u.id, u.is_active)}
                          aria-label={u.is_active ? 'Deactivate user' : 'Activate user'}
                        >
                          {u.is_active ? (
                            <IconUserOff size={16} />
                          ) : (
                            <IconUserCheck size={16} />
                          )}
                        </ActionIcon>
                      </Tooltip>
                      {isSuperAdmin && (
                        <Tooltip label="Move to tenant">
                          <ActionIcon
                            variant="light"
                            color="blue"
                            size="sm"
                            onClick={() => {
                              setMoveUserId(u.id);
                              setMoveTenantId(null);
                            }}
                            aria-label="Move to tenant"
                          >
                            <IconArrowsExchange size={16} />
                          </ActionIcon>
                        </Tooltip>
                      )}
                      <Tooltip label={t('deleteUser')}>
                        <ActionIcon
                          variant="light"
                          color="red"
                          size="sm"
                          onClick={() => setConfirmDeleteId(u.id)}
                          aria-label={t('deleteUser')}
                        >
                          <IconTrash size={16} />
                        </ActionIcon>
                      </Tooltip>
                    </Group>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
        </Box>
        <Stack hiddenFrom="sm" gap="xs">
          {users.map((u) => (
            <Paper key={u.id} p="md" withBorder radius="md">
              <Group justify="space-between" mb="xs" wrap="nowrap">
                {isSuperAdmin ? (
                  <Anchor component={Link} href={`/users/${u.id}`} fw={500} truncate>
                    {u.email}
                  </Anchor>
                ) : (
                  <Text fw={500} truncate>{u.email}</Text>
                )}
                <Badge color={u.is_active ? 'green' : 'red'} variant="light" size="sm">
                  {u.is_active ? 'Active' : 'Inactive'}
                </Badge>
              </Group>
              <Group gap="xs" mb="xs">
                <Select
                  size="xs"
                  w={120}
                  data={ROLES}
                  value={u.role}
                  onChange={(val) => handleRoleChange(u.id, val)}
                  disabled={u.id === user?.id}
                />
                {isSuperAdmin && u.tenant_name && (
                  <Badge variant="light" color="blue" size="sm">{u.tenant_name}</Badge>
                )}
              </Group>
              <Text size="xs" c="dimmed" mb="xs">
                {tCommon('created')}: {new Date(u.created_at).toLocaleDateString()}
              </Text>
              {u.id !== user?.id && (
                <Group gap="xs">
                  <ActionIcon
                    variant="light"
                    color={u.is_active ? 'orange' : 'green'}
                    size="sm"
                    onClick={() => handleToggleActive(u.id, u.is_active)}
                    aria-label={u.is_active ? 'Deactivate user' : 'Activate user'}
                  >
                    {u.is_active ? <IconUserOff size={16} /> : <IconUserCheck size={16} />}
                  </ActionIcon>
                  {isSuperAdmin && (
                    <ActionIcon
                      variant="light"
                      color="blue"
                      size="sm"
                      onClick={() => { setMoveUserId(u.id); setMoveTenantId(null); }}
                      aria-label="Move to tenant"
                    >
                      <IconArrowsExchange size={16} />
                    </ActionIcon>
                  )}
                  <ActionIcon variant="light" color="red" size="sm" onClick={() => setConfirmDeleteId(u.id)} aria-label={t('deleteUser')}>
                    <IconTrash size={16} />
                  </ActionIcon>
                </Group>
              )}
            </Paper>
          ))}
        </Stack>
        </>
      )}

      {/* Create User Modal */}
      <Modal opened={createOpened} onClose={closeCreate} title="Create User" centered>
        <TextInput
          label="Email"
          placeholder="user@example.com"
          value={newEmail}
          onChange={(e) => setNewEmail(e.currentTarget.value)}
          mb="sm"
          required
        />
        <PasswordInput
          label="Password"
          placeholder="Enter password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.currentTarget.value)}
          mb="sm"
          required
        />
        <Select
          label="Role"
          data={ROLES}
          value={newRole}
          onChange={(val) => setNewRole(val || 'user')}
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
            disabled={!newEmail.trim() || !newPassword.trim()}
          >
            Create
          </Button>
        </Group>
      </Modal>

      {/* Move User Modal */}
      <Modal
        opened={moveUserId !== null}
        onClose={() => {
          setMoveUserId(null);
          setMoveTenantId(null);
        }}
        title="Move User to Tenant"
        centered
      >
        <Select
          label="Target Tenant"
          placeholder="Select tenant"
          data={tenants.map((t) => ({ value: t.id, label: t.name }))}
          value={moveTenantId}
          onChange={setMoveTenantId}
          mb="md"
        />
        <Group justify="flex-end">
          <Button
            variant="default"
            onClick={() => {
              setMoveUserId(null);
              setMoveTenantId(null);
            }}
          >
            Cancel
          </Button>
          <Button onClick={handleMoveUser} disabled={!moveTenantId}>
            Move User
          </Button>
        </Group>
      </Modal>

      <ConfirmDialog
        opened={confirmDeleteId !== null}
        onClose={() => setConfirmDeleteId(null)}
        onConfirm={() => { if (confirmDeleteId) handleDelete(confirmDeleteId); }}
        title={t('deleteUserTitle')}
        message={t('deleteUserMessage')}
        confirmLabel={tCommon('delete')}
        danger
      />
    </DashboardShell>
  );
}
