'use client';

import { createTheme, rem } from '@mantine/core';

const fontStack = 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

export const theme = createTheme({
  primaryColor: 'violet',
  fontFamily: fontStack,
  fontFamilyMonospace: 'JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, monospace',
  headings: {
    fontFamily: fontStack,
    fontWeight: '600',
  },
  defaultRadius: 'md',
  cursorType: 'pointer',
  components: {
    Button: {
      defaultProps: {
        radius: 'md',
      },
    },
    Paper: {
      defaultProps: {
        radius: 'md',
      },
    },
    Modal: {
      defaultProps: {
        radius: 'md',
        centered: true,
        overlayProps: { blur: 3, opacity: 0.45 },
      },
    },
    Tooltip: {
      defaultProps: {
        withArrow: true,
        openDelay: 200,
      },
    },
    ActionIcon: {
      defaultProps: {
        radius: 'md',
      },
    },
  },
  other: {
    contentMaxWidth: rem(1400),
    formMaxWidth: rem(640),
    touchMin: rem(44),
  },
});
