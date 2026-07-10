'use client';

import {
  Badge,
  Box,
  Group,
  Paper,
  SimpleGrid,
  Stack,
  Table,
  Text,
  ThemeIcon,
  Title,
} from '@mantine/core';
import {
  IconChartBar,
  IconClock,
  IconStack2,
} from '@tabler/icons-react';
import { useTranslations } from 'next-intl';
import { DashboardShell } from '@/components/DashboardShell/DashboardShell';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { SkeletonList } from '@/components/SkeletonList/SkeletonList';
import { useAuthQuery } from '@/lib/use-auth-query';

interface KeyUsage {
  name: string;
  is_master: boolean;
  requests_24h: number;
}

interface UsageStats {
  total_requests: number;
  requests_last_hour: number;
  requests_last_24h: number;
  keys: KeyUsage[];
}

export default function UsagePage() {
  const t = useTranslations('usage');
  const tCommon = useTranslations('common');
  const { data: stats, isLoading: loading } = useAuthQuery<UsageStats>('/usage/stats');

  if (loading) {
    return (
      <DashboardShell>
        <PageHeader title={t('title')} subtitle={t('subtitle')} />
        <SkeletonList count={4} />
      </DashboardShell>
    );
  }

  if (!stats) {
    return (
      <DashboardShell>
        <PageHeader title={t('title')} subtitle={t('subtitle')} />
        <EmptyState icon={IconChartBar} message={tCommon('noData')} />
      </DashboardShell>
    );
  }

  const statCards = [
    {
      label: t('totalRequests'),
      value: stats.total_requests.toLocaleString(),
      icon: IconStack2,
      color: 'blue',
    },
    {
      label: t('requestsLastHour'),
      value: stats.requests_last_hour.toLocaleString(),
      icon: IconClock,
      color: 'teal',
    },
    {
      label: t('requestsLast24h'),
      value: stats.requests_last_24h.toLocaleString(),
      icon: IconChartBar,
      color: 'violet',
    },
  ];

  return (
    <DashboardShell>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />

      <SimpleGrid cols={{ base: 1, xs: 3 }} mb="xl">
        {statCards.map((stat) => (
          <Paper key={stat.label} withBorder p="md" radius="md">
            <Group justify="space-between">
              <div>
                <Text c="dimmed" tt="uppercase" fw={700} fz="xs">
                  {stat.label}
                </Text>
                <Text className="data-mono" fw={700} fz="xl" mt={4}>
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

      <Title order={4} mb="md">{t('perKey')}</Title>

      {stats.keys && stats.keys.length > 0 ? (
        <>
          <Box visibleFrom="sm">
            <Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{tCommon('name')}</Table.Th>
                  <Table.Th>{tCommon('status')}</Table.Th>
                  <Table.Th>{t('requestsLast24h')}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {stats.keys.map((k, idx) => (
                  <Table.Tr key={idx}>
                    <Table.Td>
                      <Text fw={500}>{k.name}</Text>
                    </Table.Td>
                    <Table.Td>
                      {k.is_master ? (
                        <Badge color="violet" variant="light" size="sm">Master</Badge>
                      ) : (
                        <Badge color="gray" variant="light" size="sm">Standard</Badge>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <Text className="data-mono" fw={500}>{k.requests_24h.toLocaleString()}</Text>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Box>
          <Stack hiddenFrom="sm" gap="xs">
            {stats.keys.map((k, idx) => (
              <Paper key={idx} p="md" withBorder radius="md">
                <Group justify="space-between" mb="xs" wrap="nowrap">
                  <Text fw={500} truncate>{k.name}</Text>
                  {k.is_master ? (
                    <Badge color="violet" variant="light" size="sm">Master</Badge>
                  ) : (
                    <Badge color="gray" variant="light" size="sm">Standard</Badge>
                  )}
                </Group>
                <Text size="sm" c="dimmed">
                  {t('requestsLast24h')}: <Text span className="data-mono" fw={500} c="inherit">{k.requests_24h.toLocaleString()}</Text>
                </Text>
              </Paper>
            ))}
          </Stack>
        </>
      ) : (
        <EmptyState message={tCommon('noData')} />
      )}
    </DashboardShell>
  );
}
