'use client';

import {
  Badge,
  Center,
  Group,
  Loader,
  Paper,
  SimpleGrid,
  Stack,
  Text,
} from '@mantine/core';
import {
  IconClock,
  IconKey,
  IconStack2,
  IconStar,
} from '@tabler/icons-react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { DashboardShell } from '@/components/DashboardShell/DashboardShell';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { StatCard } from '@/components/StatCard/StatCard';
import { AUTH_URL, useAuth } from '@/lib/auth';

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

export default function DashboardPage() {
  const { user, authFetch } = useAuth();
  const t = useTranslations('dashboard');
  const tCommon = useTranslations('common');
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [tenant, setTenant] = useState<TenantInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const [statsRes, tenantRes] = await Promise.all([
        authFetch(`${AUTH_URL}/usage/stats`),
        authFetch(`${AUTH_URL}/tenant`),
      ]);
      if (statsRes.ok) {
        setStats(await statsRes.json());
      }
      if (tenantRes.ok) {
        setTenant(await tenantRes.json());
      }
    } finally {
      setLoading(false);
    }
  }, [authFetch]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const statCards = [
    {
      label: t('requests24h'),
      value: stats?.requests_last_24h?.toLocaleString() ?? '--',
      icon: IconStack2,
      color: 'blue',
    },
    {
      label: t('requestsHour'),
      value: stats?.requests_last_hour?.toLocaleString() ?? '--',
      icon: IconClock,
      color: 'teal',
    },
    {
      label: t('activeKeys'),
      value: tenant?.key_count?.toString() ?? '--',
      icon: IconKey,
      color: 'violet',
    },
    {
      label: t('plan'),
      value: tenant?.plan ?? '--',
      icon: IconStar,
      color: 'orange',
    },
  ];

  return (
    <DashboardShell>
      <PageHeader
        title={t('welcome', { name: user?.email?.split('@')[0] ?? tCommon('user') })}
        subtitle={t('overview')}
      />

      {loading ? (
        <Center py="xl">
          <Loader />
        </Center>
      ) : (
        <>
          <SimpleGrid cols={{ base: 1, xs: 2, md: 4 }} mb="xl">
            {statCards.map((stat) => (
              <StatCard
                key={stat.label as string}
                label={stat.label}
                value={stat.value}
                icon={stat.icon}
                color={stat.color}
              />
            ))}
          </SimpleGrid>

          {tenant && (
            <Paper withBorder p="lg" radius="md">
              <Group justify="space-between" mb="md">
                <Text fw={600} fz="lg">{t('tenantInfo')}</Text>
                <Badge color="violet" variant="light" size="lg">{tenant.plan}</Badge>
              </Group>
              <SimpleGrid cols={{ base: 1, xs: 2, md: 3 }}>
                <Stack gap={4}>
                  <Text size="sm" c="dimmed">{t('tenantName')}</Text>
                  <Text fw={500}>{tenant.name}</Text>
                </Stack>
                <Stack gap={4}>
                  <Text size="sm" c="dimmed">{t('userCount')}</Text>
                  <Text fw={500}>{tenant.user_count}</Text>
                </Stack>
                <Stack gap={4}>
                  <Text size="sm" c="dimmed">{t('keyCount')}</Text>
                  <Text fw={500}>{tenant.key_count}</Text>
                </Stack>
                {tenant.limits && Object.entries(tenant.limits).map(([key, value]) => (
                  <Stack gap={4} key={key}>
                    <Text size="sm" c="dimmed">{key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}</Text>
                    <Text fw={500}>{String(value)}</Text>
                  </Stack>
                ))}
              </SimpleGrid>
            </Paper>
          )}
        </>
      )}
    </DashboardShell>
  );
}
