'use client';

import React from 'react';
import {
  Anchor,
  Badge,
  Center,
  Code,
  Collapse,
  Group,
  Image,
  Loader,
  Paper,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Text,
  ThemeIcon,
  Title,
} from '@mantine/core';
import {
  IconArrowLeft,
  IconChartBar,
  IconChevronDown,
  IconChevronRight,
  IconClock,
  IconKey,
  IconPhoto,
  IconStack2,
  IconUsers,
} from '@tabler/icons-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { DashboardShell } from '@/components/DashboardShell/DashboardShell';
import { API_URL, AUTH_URL, useAuth } from '@/lib/auth';

interface TenantUser {
  id: string;
  email: string;
  role: string;
  tenant_id: string;
  is_active: boolean;
}

interface TenantUsage {
  tenant_id: string;
  total_requests: number;
  requests_last_hour: number;
  requests_last_24h: number;
  keys: Array<{ id: string; name: string; is_master: boolean; requests_24h: number }>;
}

interface TenantKey {
  id: string;
  name: string;
  key: string;
  is_master: boolean;
  rate_limit: number | null;
  created_at: string;
}

interface TenantDetection {
  id: string;
  image_id?: string;
  endpoint?: string;
  model_name?: string;
  detections?: Array<{ label: string; score: number; box?: number[] }>;
  original_path?: string;
  censored_path?: string;
  created_at?: string;
}

interface TenantInfo {
  id: string;
  name: string;
  plan: string;
  is_active: boolean;
  user_count: number;
  key_count: number;
  limits: Record<string, unknown>;
}

const PLAN_COLORS: Record<string, string> = {
  free: 'gray',
  starter: 'blue',
  pro: 'violet',
  enterprise: 'orange',
};

export default function TenantDetailPage() {
  const params = useParams();
  const router = useRouter();
  const tenantId = params.id as string;
  const { user, authFetch, tenant_name } = useAuth();
  const t = useTranslations('tenants');
  const tCommon = useTranslations('common');

  const isAdmin = user?.role === 'admin';
  const isSuperAdmin = isAdmin && tenant_name === 'default';

  const [tenant, setTenant] = useState<TenantInfo | null>(null);
  const [users, setUsers] = useState<TenantUser[]>([]);
  const [usage, setUsage] = useState<TenantUsage | null>(null);
  const [keys, setKeys] = useState<TenantKey[]>([]);
  const [detections, setDetections] = useState<TenantDetection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedDetectionId, setExpandedDetectionId] = useState<string | null>(null);

  useEffect(() => {
    if (!isSuperAdmin) {
      router.replace('/tenants');
    }
  }, [isSuperAdmin, router]);

  const fetchData = useCallback(async () => {
    try {
      const [tenantsRes, usersRes, usageRes, keysRes, detectionsRes] = await Promise.all([
        authFetch(`${AUTH_URL}/admin/tenants`),
        authFetch(`${AUTH_URL}/admin/tenants/${tenantId}/users`),
        authFetch(`${AUTH_URL}/admin/tenants/${tenantId}/usage`),
        authFetch(`${AUTH_URL}/admin/tenants/${tenantId}/keys`),
        authFetch(`${AUTH_URL}/admin/tenants/${tenantId}/detections?limit=50`),
      ]);

      if (tenantsRes.ok) {
        const data = await tenantsRes.json();
        const found = (data.tenants || []).find((t: TenantInfo) => t.id === tenantId);
        if (found) setTenant(found);
      }
      if (usersRes.ok) {
        const data = await usersRes.json();
        setUsers(data.users || []);
      }
      if (usageRes.ok) {
        setUsage(await usageRes.json());
      }
      if (keysRes.ok) {
        const data = await keysRes.json();
        setKeys(data.keys || []);
      }
      if (detectionsRes.ok) {
        const data = await detectionsRes.json();
        setDetections(data.detections || []);
      }
    } catch {
      setError('Failed to load tenant details');
    } finally {
      setLoading(false);
    }
  }, [authFetch, tenantId]);

  useEffect(() => {
    if (isSuperAdmin) {
      fetchData();
    }
  }, [isSuperAdmin, fetchData]);

  if (!isSuperAdmin) return null;

  return (
    <DashboardShell>
      <Group mb="xl">
        <Anchor component={Link} href="/tenants" c="dimmed" size="sm">
          <Group gap={4}>
            <IconArrowLeft size={16} />
            Back to Tenants
          </Group>
        </Anchor>
      </Group>

      {error && (
        <Text c="red" mb="md">
          {error}
        </Text>
      )}

      {loading ? (
        <Center py="xl">
          <Loader />
        </Center>
      ) : (
        <>
          {/* Header */}
          <Group justify="space-between" mb="xl">
            <Group>
              <Title order={2}>{tenant?.name || tCommon('tenant')}</Title>
              {tenant && (
                <>
                  <Badge color={PLAN_COLORS[tenant.plan] || 'gray'} variant="light" size="lg">
                    {tenant.plan}
                  </Badge>
                  {tenant.name === 'demo' && (
                    <Badge color="yellow" variant="light" size="lg">
                      Demo
                    </Badge>
                  )}
                  <Badge color={tenant.is_active ? 'green' : 'red'} variant="light" size="sm">
                    {tenant.is_active ? tCommon('active') : tCommon('inactive')}
                  </Badge>
                </>
              )}
            </Group>
          </Group>

          <Tabs defaultValue="overview">
            <Tabs.List mb="lg">
              <Tabs.Tab value="overview" leftSection={<IconChartBar size={16} />}>
                {t('usageTab')}
              </Tabs.Tab>
              <Tabs.Tab value="users" leftSection={<IconUsers size={16} />}>
                {t('usersTab')} ({users.length})
              </Tabs.Tab>
              <Tabs.Tab value="keys" leftSection={<IconKey size={16} />}>
                {t('keysTab')} ({keys.length})
              </Tabs.Tab>
              <Tabs.Tab value="detections" leftSection={<IconPhoto size={16} />}>
                {t('detectionsTab')} ({detections.length})
              </Tabs.Tab>
            </Tabs.List>

            {/* Overview Tab */}
            <Tabs.Panel value="overview">
              {/* Usage stats */}
              <SimpleGrid cols={{ base: 1, xs: 2, md: 4 }} mb="xl">
                {[
                  {
                    label: 'Total Requests',
                    value: usage?.total_requests?.toLocaleString() ?? '--',
                    icon: IconStack2,
                    color: 'blue',
                  },
                  {
                    label: 'Last Hour',
                    value: usage?.requests_last_hour?.toLocaleString() ?? '--',
                    icon: IconClock,
                    color: 'teal',
                  },
                  {
                    label: 'Last 24h',
                    value: usage?.requests_last_24h?.toLocaleString() ?? '--',
                    icon: IconChartBar,
                    color: 'violet',
                  },
                  {
                    label: 'API Keys',
                    value: keys.length.toString(),
                    icon: IconKey,
                    color: 'orange',
                  },
                ].map((stat) => (
                  <Paper key={stat.label} withBorder p="md" radius="md">
                    <Group justify="space-between">
                      <div>
                        <Text c="dimmed" tt="uppercase" fw={700} fz="xs">
                          {stat.label}
                        </Text>
                        <Text fw={700} fz="xl" mt={4}>
                          {stat.value}
                        </Text>
                      </div>
                      <ThemeIcon color={stat.color} variant="light" size={48} radius="md">
                        <stat.icon size={28} stroke={1.5} />
                      </ThemeIcon>
                    </Group>
                  </Paper>
                ))}
              </SimpleGrid>

              {/* Tenant limits */}
              {tenant?.limits && (
                <Paper withBorder p="lg" radius="md" mb="xl">
                  <Text fw={600} mb="sm">
                    Limits
                  </Text>
                  <SimpleGrid cols={{ base: 1, xs: 2, md: 3 }}>
                    {Object.entries(tenant.limits)
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
              )}

              {/* Per-key usage */}
              {usage?.keys && usage.keys.length > 0 && (
                <>
                  <Title order={4} mb="md">
                    Per-Key Usage (24h)
                  </Title>
                  <Table striped highlightOnHover>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Key Name</Table.Th>
                        <Table.Th>Type</Table.Th>
                        <Table.Th>Requests (24h)</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {usage.keys.map((k) => (
                        <Table.Tr key={k.id}>
                          <Table.Td>
                            <Text fw={500}>{k.name}</Text>
                          </Table.Td>
                          <Table.Td>
                            <Badge
                              color={k.is_master ? 'violet' : 'gray'}
                              variant="light"
                              size="sm"
                            >
                              {k.is_master ? 'Master' : 'Standard'}
                            </Badge>
                          </Table.Td>
                          <Table.Td>
                            <Text fw={500}>{k.requests_24h.toLocaleString()}</Text>
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </>
              )}
            </Tabs.Panel>

            {/* Users Tab */}
            <Tabs.Panel value="users">
              {users.length === 0 ? (
                <Text c="dimmed">No users in this tenant.</Text>
              ) : (
                <Table striped highlightOnHover>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Email</Table.Th>
                      <Table.Th>Role</Table.Th>
                      <Table.Th>Status</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {users.map((u) => (
                      <Table.Tr
                        key={u.id}
                        style={{ cursor: 'pointer' }}
                        onClick={() => router.push(`/users/${u.id}`)}
                      >
                        <Table.Td>
                          <Anchor component={Link} href={`/users/${u.id}`} fw={500}>
                            {u.email}
                          </Anchor>
                        </Table.Td>
                        <Table.Td>
                          <Badge
                            color={u.role === 'admin' ? 'violet' : 'gray'}
                            variant="light"
                            size="sm"
                          >
                            {u.role}
                          </Badge>
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
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              )}
            </Tabs.Panel>

            {/* Keys Tab */}
            <Tabs.Panel value="keys">
              {keys.length === 0 ? (
                <Text c="dimmed">No API keys for this tenant.</Text>
              ) : (
                <Table striped highlightOnHover>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Name</Table.Th>
                      <Table.Th>Key</Table.Th>
                      <Table.Th>Type</Table.Th>
                      <Table.Th>Rate Limit</Table.Th>
                      <Table.Th>Created</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {keys.map((k) => (
                      <Table.Tr key={k.id}>
                        <Table.Td>
                          <Text fw={500}>{k.name}</Text>
                        </Table.Td>
                        <Table.Td>
                          <Code>{k.key.length > 16 ? `${k.key.slice(0, 16)}...` : k.key}</Code>
                        </Table.Td>
                        <Table.Td>
                          <Badge
                            color={k.is_master ? 'violet' : 'gray'}
                            variant="light"
                            size="sm"
                          >
                            {k.is_master ? 'Master' : 'Standard'}
                          </Badge>
                        </Table.Td>
                        <Table.Td>
                          <Text size="sm">
                            {k.rate_limit != null ? `${k.rate_limit}/min` : 'Default'}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Text size="sm">
                            {new Date(k.created_at).toLocaleDateString()}
                          </Text>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              )}
            </Tabs.Panel>

            {/* Detections Tab */}
            <Tabs.Panel value="detections">
              {detections.length === 0 ? (
                <Text c="dimmed">No detections for this tenant.</Text>
              ) : (
                <Table striped highlightOnHover>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th />
                      <Table.Th>Image ID</Table.Th>
                      <Table.Th>Endpoint</Table.Th>
                      <Table.Th>Model</Table.Th>
                      <Table.Th>Detections</Table.Th>
                      <Table.Th>Date</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {detections.map((d) => (
                      <React.Fragment key={d.id}>
                        <Table.Tr
                          style={{ cursor: 'pointer' }}
                          onClick={() =>
                            setExpandedDetectionId(
                              expandedDetectionId === d.id ? null : d.id
                            )
                          }
                        >
                          <Table.Td w={30}>
                            {expandedDetectionId === d.id ? (
                              <IconChevronDown size={16} />
                            ) : (
                              <IconChevronRight size={16} />
                            )}
                          </Table.Td>
                          <Table.Td>
                            <Text size="sm" ff="monospace">
                              {d.image_id
                                ? d.image_id.length > 20
                                  ? `${d.image_id.slice(0, 20)}...`
                                  : d.image_id
                                : d.id.slice(0, 12)}
                            </Text>
                          </Table.Td>
                          <Table.Td>
                            {d.endpoint && (
                              <Badge
                                color={d.endpoint === 'censor' ? 'orange' : 'blue'}
                                variant="light"
                                size="sm"
                              >
                                {d.endpoint}
                              </Badge>
                            )}
                          </Table.Td>
                          <Table.Td>
                            <Text size="sm">{d.model_name || '--'}</Text>
                          </Table.Td>
                          <Table.Td>
                            <Badge variant="light" size="sm">
                              {d.detections?.length ?? 0}
                            </Badge>
                          </Table.Td>
                          <Table.Td>
                            <Text size="sm">
                              {d.created_at
                                ? new Date(d.created_at).toLocaleString()
                                : '--'}
                            </Text>
                          </Table.Td>
                        </Table.Tr>
                        {expandedDetectionId === d.id && (
                          <Table.Tr key={`${d.id}-detail`}>
                            <Table.Td colSpan={6}>
                              <Collapse expanded={expandedDetectionId === d.id}>
                                <Paper withBorder p="md" radius="md" mt="xs" mb="xs">
                                  {d.detections && d.detections.length > 0 ? (
                                    <>
                                      <Text fw={600} mb="sm">
                                        Detection Details
                                      </Text>
                                      <Table mb="md">
                                        <Table.Thead>
                                          <Table.Tr>
                                            <Table.Th>Label</Table.Th>
                                            <Table.Th>Score</Table.Th>
                                            <Table.Th>Box</Table.Th>
                                          </Table.Tr>
                                        </Table.Thead>
                                        <Table.Tbody>
                                          {d.detections.map((det, idx) => (
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
                                                <Text size="xs" c="dimmed" ff="monospace">
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
                                    </>
                                  ) : (
                                    <Text size="sm" c="dimmed" mb="md">
                                      No detections in this result.
                                    </Text>
                                  )}

                                  {(d.original_path || d.censored_path) && (
                                    <>
                                      <Text fw={600} mb="sm">
                                        Images
                                      </Text>
                                      <Group>
                                        {d.original_path && (
                                          <a
                                            href={`${API_URL}${d.original_path}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                          >
                                            <Paper withBorder p="xs" radius="md">
                                              <Text size="xs" c="dimmed" mb={4}>
                                                Original
                                              </Text>
                                              <Image
                                                src={`${API_URL}${d.original_path}`}
                                                alt="Original"
                                                w={200}
                                                h={150}
                                                fit="contain"
                                                radius="sm"
                                                fallbackSrc="https://placehold.co/200x150?text=No+Preview"
                                              />
                                            </Paper>
                                          </a>
                                        )}
                                        {d.censored_path && (
                                          <a
                                            href={`${API_URL}${d.censored_path}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                          >
                                            <Paper withBorder p="xs" radius="md">
                                              <Text size="xs" c="dimmed" mb={4}>
                                                Censored
                                              </Text>
                                              <Image
                                                src={`${API_URL}${d.censored_path}`}
                                                alt="Censored"
                                                w={200}
                                                h={150}
                                                fit="contain"
                                                radius="sm"
                                                fallbackSrc="https://placehold.co/200x150?text=No+Preview"
                                              />
                                            </Paper>
                                          </a>
                                        )}
                                      </Group>
                                    </>
                                  )}
                                </Paper>
                              </Collapse>
                            </Table.Td>
                          </Table.Tr>
                        )}
                      </React.Fragment>
                    ))}
                  </Table.Tbody>
                </Table>
              )}
            </Tabs.Panel>
          </Tabs>
        </>
      )}
    </DashboardShell>
  );
}
