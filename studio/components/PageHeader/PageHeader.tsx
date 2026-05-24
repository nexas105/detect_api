'use client';

import { Group, Stack, Text, Title } from '@mantine/core';
import type { ReactNode } from 'react';

export interface PageHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}

export function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  return (
    <Group
      justify="space-between"
      align="flex-start"
      wrap="wrap"
      gap="md"
      mb="lg"
    >
      <Stack gap={4} style={{ minWidth: 0, flex: 1 }}>
        <Title order={2} fz={{ base: 22, sm: 26 }} lh={1.2}>
          {title}
        </Title>
        {subtitle ? (
          <Text c="dimmed" fz={{ base: 'sm', sm: 'md' }}>
            {subtitle}
          </Text>
        ) : null}
      </Stack>
      {actions ? <Group gap="xs">{actions}</Group> : null}
    </Group>
  );
}
