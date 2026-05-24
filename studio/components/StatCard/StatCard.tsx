'use client';

import { Group, Paper, Text, ThemeIcon } from '@mantine/core';
import type { ComponentType, ReactNode } from 'react';

export interface StatCardProps {
  label: ReactNode;
  value: ReactNode;
  icon?: ComponentType<{ size?: number; stroke?: number }>;
  color?: string;
  delta?: ReactNode;
  deltaPositive?: boolean;
}

export function StatCard({
  label,
  value,
  icon: Icon,
  color = 'violet',
  delta,
  deltaPositive,
}: StatCardProps) {
  return (
    <Paper withBorder p="md" radius="md">
      <Group justify="space-between" wrap="nowrap">
        <div style={{ minWidth: 0 }}>
          <Text c="dimmed" tt="uppercase" fw={700} fz="xs" truncate>
            {label}
          </Text>
          <Text fw={700} fz="xl" mt={4} truncate>
            {value}
          </Text>
          {delta != null ? (
            <Text
              fz="xs"
              mt={2}
              c={deltaPositive === undefined ? 'dimmed' : deltaPositive ? 'teal' : 'red'}
            >
              {delta}
            </Text>
          ) : null}
        </div>
        {Icon ? (
          <ThemeIcon color={color} variant="light" size={48} radius="md">
            <Icon size={26} stroke={1.5} />
          </ThemeIcon>
        ) : null}
      </Group>
    </Paper>
  );
}
