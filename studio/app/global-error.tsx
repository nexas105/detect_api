'use client';

import { Button, Center, Stack, Text } from '@mantine/core';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body>
        <Center mih="100vh">
          <Stack align="center" gap="md" maw={400}>
            <Text fw={600} fz="xl" ta="center">
              Something went wrong
            </Text>
            <Text c="dimmed" size="sm" ta="center">
              {error.message || 'A critical error occurred'}
            </Text>
            <Button onClick={reset}>Try again</Button>
          </Stack>
        </Center>
      </body>
    </html>
  );
}
