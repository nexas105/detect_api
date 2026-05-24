'use client';

import { Alert, Button, Center, Stack, Text } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <Center mih="50vh">
      <Stack align="center" gap="md" maw={400}>
        <IconAlertTriangle size={48} color="var(--mantine-color-red-6)" />
        <Text fw={600} fz="lg" ta="center">
          Something went wrong
        </Text>
        <Text c="dimmed" size="sm" ta="center">
          {error.message || 'An unexpected error occurred'}
        </Text>
        <Button onClick={reset} variant="light">
          Try again
        </Button>
      </Stack>
    </Center>
  );
}
