'use client';

import {
  Group,
  Paper,
  SimpleGrid,
  Table,
  Text,
  ThemeIcon,
  Title,
} from '@mantine/core';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { SkeletonList } from '@/components/SkeletonList/SkeletonList';
import {
  IconChartBar,
  IconClock,
  IconDeviceDesktop,
  IconPhoto,
  IconStack2,
} from '@tabler/icons-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { DashboardShell } from '@/components/DashboardShell/DashboardShell';
import { AUTH_URL, useAuth } from '@/lib/auth';

interface DemoStats {
  total_requests: number;
  requests_last_hour: number;
  requests_last_24h: number;
  images_last_24h: number;
  unique_ips_24h: number;
  top_ips: Array<{ ip: string; requests: number; images: number }>;
}

export default function DemoStatsPage() {
  const { user, authFetch, tenant_name } = useAuth();
  const router = useRouter();
  const t = useTranslations('demoStats');
  const tUsage = useTranslations('usage');
  const tCommon = useTranslations('common');

  const isAdmin = user?.role === 'admin';
  const isSuperAdmin = isAdmin && tenant_name === 'default';

  const [stats, setStats] = useState<DemoStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isSuperAdmin) {
      router.replace('/');
    }
  }, [isSuperAdmin, router]);

  const fetchStats = useCallback(async () => {
    try {
      const res = await authFetch(`${AUTH_URL}/demo/stats`);
      if (res.ok) {
        setStats(await res.json());
      } else {
        const err = await res.json().catch(() => ({}));
        setError(err.detail || tCommon('error'));
      }
    } catch {
      setError(tCommon('error'));
    } finally {
      setLoading(false);
    }
  }, [authFetch]);

  useEffect(() => {
    if (isSuperAdmin) {
      fetchStats();
    }
  }, [isSuperAdmin, fetchStats]);

  if (!isSuperAdmin) return null;

  const statCards = stats
    ? [
        {
          label: tUsage('totalRequests'),
          value: stats.total_requests.toLocaleString(),
          icon: IconStack2,
          color: 'blue',
        },
        {
          label: tUsage('requestsLastHour'),
          value: stats.requests_last_hour.toLocaleString(),
          icon: IconClock,
          color: 'teal',
        },
        {
          label: tUsage('requestsLast24h'),
          value: stats.requests_last_24h.toLocaleString(),
          icon: IconChartBar,
          color: 'violet',
        },
        {
          label: `Images (24h)`,
          value: stats.images_last_24h.toLocaleString(),
          icon: IconPhoto,
          color: 'orange',
        },
        {
          label: `${t('ip')} (24h)`,
          value: stats.unique_ips_24h.toLocaleString(),
          icon: IconDeviceDesktop,
          color: 'pink',
        },
      ]
    : [];

  return (
    <DashboardShell>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />

      {error && (
        <Text c="red" mb="md">
          {error}
        </Text>
      )}

      {loading ? (
        <SkeletonList count={5} />
      ) : stats ? (
        <>
          <SimpleGrid cols={{ base: 1, xs: 2, md: 3, lg: 5 }} mb="xl">
            {statCards.map((stat) => (
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

          <Title order={4} mb="md">
            {`${t('ip')} (24h)`}
          </Title>
          {stats.top_ips && stats.top_ips.length > 0 ? (
            <Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>#</Table.Th>
                  <Table.Th>{t('ip')}</Table.Th>
                  <Table.Th>{t('requests')}</Table.Th>
                  <Table.Th>Images</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {stats.top_ips.map((entry, idx) => (
                  <Table.Tr key={entry.ip}>
                    <Table.Td>
                      <Text size="sm" c="dimmed">
                        {idx + 1}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" ff="monospace">
                        {entry.ip}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text fw={500}>{entry.requests.toLocaleString()}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text fw={500}>{entry.images.toLocaleString()}</Text>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          ) : (
            <EmptyState message={tCommon('noData')} />
          )}
        </>
      ) : (
        <EmptyState message={tCommon('noData')} />
      )}
    </DashboardShell>
  );
}
