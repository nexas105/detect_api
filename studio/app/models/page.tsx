'use client';

import {
  Badge,
  Card,
  Group,
  SimpleGrid,
  Text,
} from '@mantine/core';
import { IconBrain } from '@tabler/icons-react';
import { useTranslations } from 'next-intl';
import { DashboardShell } from '@/components/DashboardShell/DashboardShell';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { SkeletonList } from '@/components/SkeletonList/SkeletonList';
import { useAuthQuery } from '@/lib/use-auth-query';

interface Model {
  name: string;
  description?: string;
  labels?: string[];
}

export default function ModelsPage() {
  const t = useTranslations('models');
  const tCommon = useTranslations('common');
  const { data, error, isLoading: loading } = useAuthQuery<Model[] | { models: Model[] }>(
    '/models',
    { base: 'api' }
  );
  const models = Array.isArray(data) ? data : data?.models ?? [];

  return (
    <DashboardShell>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />

      {loading ? (
        <SkeletonList count={3} />
      ) : error ? (
        <Text c="red">{error}</Text>
      ) : models.length === 0 ? (
        <EmptyState icon={IconBrain} message={tCommon('noData')} />
      ) : (
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
          {models.map((model) => (
            <Card key={model.name} withBorder radius="md" padding="lg">
              <Group mb="sm">
                <IconBrain size={24} stroke={1.5} color="var(--mantine-color-violet-5)" />
                <Text fw={600} size="lg">
                  {model.name}
                </Text>
              </Group>
              {model.description && (
                <Text size="sm" c="dimmed" mb="md">
                  {model.description}
                </Text>
              )}
              {model.labels && model.labels.length > 0 && (
                <Group gap="xs">
                  {model.labels.map((label) => (
                    <Badge key={label} className="data-mono" variant="light" size="sm">
                      {label}
                    </Badge>
                  ))}
                </Group>
              )}
            </Card>
          ))}
        </SimpleGrid>
      )}
    </DashboardShell>
  );
}
