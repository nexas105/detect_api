'use client';

import { createTheme, rem, type MantineColorsTuple } from '@mantine/core';

// Fonts are wired via next/font in app/layout.tsx, which injects these CSS variables.
const inter = 'var(--font-inter), -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const spaceGrotesk = `var(--font-space-grotesk), ${inter}`;
const plexMono = 'var(--font-plex-mono), ui-monospace, SFMono-Regular, Menlo, monospace';

// Interactive / primary — cyan #38BDF8 lives at shade 5.
const cyan: MantineColorsTuple = [
  '#e3f6ff',
  '#c0ebfe',
  '#97defd',
  '#63cffb',
  '#40c4f9',
  '#38bdf8',
  '#1fa9e6',
  '#1587c0',
  '#0e6b9a',
  '#084d70',
];

// "Inspection Console" dark scale. dark[7] is Mantine's body/surface, dark[8] the app bg.
const dark: MantineColorsTuple = [
  '#e6eaf0', // text-hi
  '#c7ceda',
  '#8a94a6', // text-lo / dimmed
  '#5c6675',
  '#3a4351',
  '#262e3a', // hairline
  '#1f2630', // surface-2
  '#171c24', // surface
  '#0e1116', // bg
  '#090c10',
];

// Verdict trio — functional domain colors, exposed as named theme colors.
const allow: MantineColorsTuple = [
  '#e6fbf3', '#c4f5e2', '#9bedcd', '#66e2b4', '#43daa4',
  '#34d399', '#22b983', '#159068', '#0b6e4f', '#024a34',
];
const flag: MantineColorsTuple = [
  '#fef6e0', '#fceab6', '#fadc86', '#f8ce55', '#f7c534',
  '#fbbf24', '#e0a50f', '#b4830a', '#886206', '#5c4103',
];
const block: MantineColorsTuple = [
  '#fee9ec', '#fdcbd3', '#fba7b4', '#fa8798', '#f97587',
  '#fb7185', '#e84d64', '#c23350', '#92283e', '#63182a',
];

export const theme = createTheme({
  primaryColor: 'cyan',
  primaryShade: { light: 6, dark: 5 },
  colors: { cyan, dark, allow, flag, block },
  fontFamily: inter,
  fontFamilyMonospace: plexMono,
  headings: {
    fontFamily: spaceGrotesk,
    fontWeight: '600',
    sizes: {
      h1: { fontWeight: '600', lineHeight: '1.15' },
      h2: { fontWeight: '600', lineHeight: '1.2' },
      h3: { fontWeight: '500' },
    },
  },
  defaultRadius: 'sm',
  radius: { sm: rem(6) },
  cursorType: 'pointer',
  components: {
    Button: { defaultProps: { radius: 'sm' } },
    ActionIcon: { defaultProps: { radius: 'sm' } },
    Paper: { defaultProps: { radius: 'sm' } },
    Card: { defaultProps: { radius: 'sm', withBorder: true } },
    Badge: { defaultProps: { radius: 'sm' } },
    Table: { defaultProps: { highlightOnHover: true, verticalSpacing: 'sm', horizontalSpacing: 'md' } },
    Modal: {
      defaultProps: {
        radius: 'sm',
        centered: true,
        overlayProps: { blur: 3, opacity: 0.5 },
      },
    },
    Tooltip: { defaultProps: { withArrow: true, openDelay: 200 } },
  },
  other: {
    contentMaxWidth: rem(1400),
    formMaxWidth: rem(640),
    touchMin: rem(44),
    // Consumed by components + globals.css CSS vars of the same names.
    verdict: {
      allow: 'var(--verdict-allow)',
      flag: 'var(--verdict-flag)',
      block: 'var(--verdict-block)',
    },
  },
});
