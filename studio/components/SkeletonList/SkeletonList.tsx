'use client';

import { Skeleton, Stack } from '@mantine/core';

export interface SkeletonListProps {
  count?: number;
  height?: number;
  radius?: number | string;
}

export function SkeletonList({ count = 5, height = 56, radius = 'sm' }: SkeletonListProps) {
  return (
    <Stack gap="xs">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} height={height} radius={radius} />
      ))}
    </Stack>
  );
}
