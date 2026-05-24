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
  Text,
  ThemeIcon,
  Title,
} from '@mantine/core';
import {
  IconArrowLeft,
  IconChartBar,
  IconChevronDown,
  IconChevronRight,
  IconKey,
  IconMail,
  IconUser,
} from '@tabler/icons-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { DashboardShell } from '@/components/DashboardShell/DashboardShell';
import { API_URL, AUTH_URL, useAuth } from '@/lib/auth';

interface UserDetails {
  user: {
    id: string;
    email: string;
    role: string;
    tenant_id: string;
    is_active: boolean;
  };
  tenant_name: string;
  keys: Array<{
    id: string;
    name: string;
    key: string;
    is_master: boolean;
    rate_limit: number | null;
    created_at: string;
  }>;
  usage_24h: number;
  detections: Array<{
    id: string;
    image_id?: string;
    endpoint?: string;
    model_name?: string;
    detections?: Array<{ label: string; score: number; box?: number[] }>;
    original_path?: string;
    censored_path?: string;
    created_at?: string;
  }>;
}

export default function UserDetailPage() {
  const params = useParams();
  const router = useRouter();
  const userId = params.id as string;
  const { user: currentUser, authFetch, tenant_name } = useAuth();
  const t = useTranslations('users');
  const tApiKeys = useTranslations('apiKeys');
  const tDetections = useTranslations('detections');

  const isAdmin = currentUser?.role === 'admin';
  const isSuperAdmin = isAdmin && tenant_name === 'default';

  const [details, setDetails] = useState<UserDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedDetectionId, setExpandedDetectionId] = useState<string | null>(null);

  useEffect(() => {
    if (!isSuperAdmin) {
      router.replace('/users');
    }
  }, [isSuperAdmin, router]);

  const fetchData = useCallback(async () => {
    try {
      const res = await authFetch(`${AUTH_URL}/admin/users/${userId}/details`);
      if (res.ok) {
        setDetails(await res.json());
      } else {
        const err = await res.json().catch(() => ({}));
        setError(err.detail || 'Failed to load user details');
      }
    } catch {
      setError('Could not connect to auth service');
    } finally {
      setLoading(false);
    }
  }, [authFetch, userId]);

  useEffect(() => {
    if (isSuperAdmin) {
      fetchData();
    }
  }, [isSuperAdmin, fetchData]);

  if (!isSuperAdmin) return null;

  return (
    <DashboardShell>
      <Group mb="xl">
        <Anchor component={Link} href="/users" c="dimmed" size="sm">
          <Group gap={4}>
            <IconArrowLeft size={16} />
            Back to Users
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
      ) : details ? (
        <>
          {/* User info card */}
          <Paper withBorder p="lg" radius="md" mb="xl">
            <Group justify="space-between" mb="md">
              <Group>
                <ThemeIcon color="violet" variant="light" size={48} radius="md">
                  <IconUser size={28} stroke={1.5} />
                </ThemeIcon>
                <div>
                  <Title order={3}>{details.user.email}</Title>
                  <Group gap="xs" mt={4}>
                    <Badge
                      color={details.user.role === 'admin' ? 'violet' : 'gray'}
                      variant="light"
                      size="sm"
                    >
                      {details.user.role}
                    </Badge>
                    <Badge
                      color={details.user.is_active ? 'green' : 'red'}
                      variant="light"
                      size="sm"
                    >
                      {details.user.is_active ? 'Active' : 'Inactive'}
                    </Badge>
                  </Group>
                </div>
              </Group>
            </Group>

            <SimpleGrid cols={{ base: 1, xs: 2, md: 4 }}>
              <Stack gap={4}>
                <Text size="sm" c="dimmed">
                  Tenant
                </Text>
                <Anchor
                  component={Link}
                  href={`/tenants/${details.user.tenant_id}`}
                  fw={500}
                >
                  {details.tenant_name}
                </Anchor>
              </Stack>
              <Stack gap={4}>
                <Text size="sm" c="dimmed">
                  Requests (24h)
                </Text>
                <Text fw={500}>{details.usage_24h?.toLocaleString() ?? '0'}</Text>
              </Stack>
              <Stack gap={4}>
                <Text size="sm" c="dimmed">
                  API Keys
                </Text>
                <Text fw={500}>{details.keys?.length ?? 0}</Text>
              </Stack>
              <Stack gap={4}>
                <Text size="sm" c="dimmed">
                  Detections
                </Text>
                <Text fw={500}>{details.detections?.length ?? 0}</Text>
              </Stack>
            </SimpleGrid>
          </Paper>

          {/* Keys table */}
          <Title order={4} mb="md">
            {tApiKeys('title')}
          </Title>
          {details.keys && details.keys.length > 0 ? (
            <Table striped highlightOnHover mb="xl">
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
                {details.keys.map((k) => (
                  <Table.Tr key={k.id}>
                    <Table.Td>
                      <Text fw={500}>{k.name}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Code>
                        {k.key.length > 16 ? `${k.key.slice(0, 16)}...` : k.key}
                      </Code>
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
          ) : (
            <Paper withBorder p="lg" radius="md" mb="xl">
              <Text c="dimmed" ta="center">
                No API keys for this user.
              </Text>
            </Paper>
          )}

          {/* Detections table */}
          <Title order={4} mb="md">
            {tDetections('title')}
          </Title>
          {details.detections && details.detections.length > 0 ? (
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
                {details.detections.map((d) => (
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
          ) : (
            <Paper withBorder p="lg" radius="md">
              <Text c="dimmed" ta="center">
                No detections for this user.
              </Text>
            </Paper>
          )}
        </>
      ) : (
        <Text c="dimmed">User not found.</Text>
      )}
    </DashboardShell>
  );
}
