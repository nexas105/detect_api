'use client';

import {
  Badge,
  Box,
  Center,
  Group,
  Loader,
  Paper,
  SimpleGrid,
  Stack,
  Text,
} from '@mantine/core';
import { IconClock, IconKey, IconStar, IconUsers } from '@tabler/icons-react';
import { useTranslations } from 'next-intl';
import { DashboardShell } from '@/components/DashboardShell/DashboardShell';
import { DetectionFrame } from '@/components/DetectionFrame';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { StatCard } from '@/components/StatCard/StatCard';
import { useAuth } from '@/lib/auth';
import { useAuthQuery } from '@/lib/use-auth-query';

interface UsageStats {
  total_requests: number;
  requests_last_hour: number;
  requests_last_24h: number;
  keys: Array<{ name: string; is_master: boolean; requests_24h: number }>;
}

interface TenantInfo {
  id: string;
  name: string;
  plan: string;
  limits: Record<string, unknown>;
  user_count: number;
  key_count: number;
}

const VERDICTS: Array<{ key: 'allow' | 'flag' | 'block'; cssVar: string }> = [
  { key: 'allow', cssVar: 'var(--verdict-allow)' },
  { key: 'flag', cssVar: 'var(--verdict-flag)' },
  { key: 'block', cssVar: 'var(--verdict-block)' },
];

export default function DashboardPage() {
  const { user } = useAuth();
  const t = useTranslations('dashboard');
  const tCommon = useTranslations('common');

  // useAuthQuery replaces the useState + useEffect + try/catch boilerplate.
  const { data: stats, isLoading: statsLoading } = useAuthQuery<UsageStats>('/usage/stats');
  const { data: tenant, isLoading: tenantLoading } = useAuthQuery<TenantInfo>('/tenant');
  const loading = statsLoading || tenantLoading;

  const keys = stats?.keys ?? [];
  const maxKey = Math.max(1, ...keys.map((k) => k.requests_24h));

  const statCards = [
    { label: t('requestsHour'), value: stats?.requests_last_hour?.toLocaleString() ?? '--', icon: IconClock },
    { label: t('activeKeys'), value: tenant?.key_count?.toString() ?? '--', icon: IconKey },
    { label: t('userCount'), value: tenant?.user_count?.toString() ?? '--', icon: IconUsers },
    { label: t('plan'), value: tenant?.plan ?? '--', icon: IconStar },
  ];

  return (
    <DashboardShell>
      <PageHeader
        title={t('welcome', { name: user?.email?.split('@')[0] ?? tCommon('user') })}
        subtitle={t('overview')}
      />

      {loading ? (
        <Center py="xl">
          <Loader color="cyan" />
        </Center>
      ) : (
        <Stack gap="xl">
          {/* HERO — detection-traffic console, framed by the signature bracket. */}
          <DetectionFrame color="var(--mantine-color-cyan-5)" size={16} inset={-4} weight={2}>
            <Paper withBorder p={{ base: 'lg', sm: 'xl' }} style={{ background: 'var(--surface)' }}>
              <Group justify="space-between" align="flex-start" wrap="wrap" gap="xl">
                <Box>
                  <Group gap={8} mb={4}>
                    <Box
                      w={7}
                      h={7}
                      style={{ borderRadius: '50%', background: 'var(--verdict-allow)' }}
                    />
                    <Text className="data-mono" fz={11} fw={600} tt="uppercase" lts={1.5} c="dimmed">
                      {t('heroEyebrow')}
                    </Text>
                  </Group>
                  <Text
                    className="data-mono"
                    fw={600}
                    lh={1}
                    style={{ fontSize: 'clamp(44px, 9vw, 68px)' }}
                  >
                    {stats?.requests_last_24h?.toLocaleString() ?? '0'}
                  </Text>
                  <Text fz="sm" c="dimmed" mt={6}>
                    {t('heroLabel')}
                  </Text>
                </Box>

                <Group gap="xl" wrap="wrap">
                  <Stack gap={2}>
                    <Text className="data-mono" fz={24} fw={600}>
                      {stats?.requests_last_hour?.toLocaleString() ?? '0'}
                    </Text>
                    <Text className="data-mono" fz={10} tt="uppercase" lts={1} c="dimmed">
                      {t('perHour')}
                    </Text>
                  </Stack>
                  <Stack gap={2}>
                    <Text className="data-mono" fz={24} fw={600}>
                      {stats?.total_requests?.toLocaleString() ?? '0'}
                    </Text>
                    <Text className="data-mono" fz={10} tt="uppercase" lts={1} c="dimmed">
                      {t('allTime')}
                    </Text>
                  </Stack>
                </Group>
              </Group>

              {/* Decision-class legend — the verdict vocabulary the console speaks. */}
              <Group gap="md" mt="lg" pt="md" style={{ borderTop: '1px solid var(--hairline)' }}>
                <Text className="data-mono" fz={10} tt="uppercase" lts={1} c="dimmed">
                  {t('verdictLegend')}
                </Text>
                {VERDICTS.map((v) => (
                  <Group key={v.key} gap={6}>
                    <Box w={8} h={8} style={{ borderRadius: 2, background: v.cssVar }} />
                    <Text className="data-mono" fz="xs" c="var(--text-hi)">
                      {t(v.key)}
                    </Text>
                  </Group>
                ))}
              </Group>
            </Paper>
          </DetectionFrame>

          <SimpleGrid cols={{ base: 1, xs: 2, md: 4 }}>
            {statCards.map((stat) => (
              <StatCard key={stat.label} label={stat.label} value={stat.value} icon={stat.icon} />
            ))}
          </SimpleGrid>

          {/* Per-key activity — real requests_24h breakdown. */}
          {keys.length > 0 && (
            <Paper withBorder p="lg" style={{ background: 'var(--surface)' }}>
              <Text fw={600} fz="sm" tt="uppercase" lts={0.5} mb="md" c="dimmed">
                {t('keyActivity')}
              </Text>
              <Stack gap="sm">
                {keys.map((k) => (
                  <Group key={k.name} wrap="nowrap" gap="md">
                    <Group gap={8} w={180} wrap="nowrap" style={{ flexShrink: 0 }}>
                      <Text className="data-mono" fz="xs" truncate>
                        {k.name}
                      </Text>
                      {k.is_master && (
                        <Badge size="xs" variant="light" color="cyan">
                          master
                        </Badge>
                      )}
                    </Group>
                    <Box style={{ flex: 1, minWidth: 0 }}>
                      <Box
                        h={8}
                        style={{
                          width: `${Math.max(2, (k.requests_24h / maxKey) * 100)}%`,
                          background: 'var(--mantine-color-cyan-5)',
                          borderRadius: 3,
                          transition: 'width 200ms ease',
                        }}
                      />
                    </Box>
                    <Text className="data-mono" fz="xs" c="dimmed" w={64} ta="right" style={{ flexShrink: 0 }}>
                      {k.requests_24h.toLocaleString()}
                    </Text>
                  </Group>
                ))}
              </Stack>
            </Paper>
          )}

          {tenant && (
            <Paper withBorder p="lg" style={{ background: 'var(--surface)' }}>
              <Group justify="space-between" mb="md">
                <Text fw={600} fz="lg">
                  {t('tenantInfo')}
                </Text>
                <Badge color="cyan" variant="light" size="lg">
                  {tenant.plan}
                </Badge>
              </Group>
              <SimpleGrid cols={{ base: 1, xs: 2, md: 3 }}>
                <Stack gap={4}>
                  <Text size="sm" c="dimmed">
                    {t('tenantName')}
                  </Text>
                  <Text fw={500}>{tenant.name}</Text>
                </Stack>
                <Stack gap={4}>
                  <Text size="sm" c="dimmed">
                    {t('userCount')}
                  </Text>
                  <Text className="data-mono" fw={500}>
                    {tenant.user_count}
                  </Text>
                </Stack>
                <Stack gap={4}>
                  <Text size="sm" c="dimmed">
                    {t('keyCount')}
                  </Text>
                  <Text className="data-mono" fw={500}>
                    {tenant.key_count}
                  </Text>
                </Stack>
                {tenant.limits &&
                  Object.entries(tenant.limits).map(([key, value]) => (
                    <Stack gap={4} key={key}>
                      <Text size="sm" c="dimmed">
                        {key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                      </Text>
                      <Text className="data-mono" fw={500}>
                        {String(value)}
                      </Text>
                    </Stack>
                  ))}
              </SimpleGrid>
            </Paper>
          )}
        </Stack>
      )}
    </DashboardShell>
  );
}
