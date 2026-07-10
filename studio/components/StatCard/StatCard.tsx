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
  color = 'cyan',
  delta,
  deltaPositive,
}: StatCardProps) {
  return (
    <Paper withBorder p="md" style={{ background: 'var(--surface)' }}>
      <Group justify="space-between" wrap="nowrap" align="flex-start">
        <div style={{ minWidth: 0 }}>
          <Text c="dimmed" tt="uppercase" fw={600} fz={11} lts={0.6} truncate>
            {label}
          </Text>
          <Text className="data-mono" fw={600} fz={26} mt={6} lh={1.1} truncate>
            {value}
          </Text>
          {delta != null ? (
            <Text
              className="data-mono"
              fz="xs"
              mt={4}
              c={deltaPositive === undefined ? 'dimmed' : deltaPositive ? 'allow.6' : 'block.6'}
            >
              {delta}
            </Text>
          ) : null}
        </div>
        {Icon ? (
          <ThemeIcon color={color} variant="light" size={40} radius="sm">
            <Icon size={22} stroke={1.6} />
          </ThemeIcon>
        ) : null}
      </Group>
    </Paper>
  );
}
