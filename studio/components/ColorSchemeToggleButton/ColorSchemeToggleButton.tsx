'use client';

import { ActionIcon, Tooltip, useMantineColorScheme } from '@mantine/core';
import { IconMoon, IconSun } from '@tabler/icons-react';
import { useTranslations } from 'next-intl';

export function ColorSchemeToggleButton() {
  const { colorScheme, toggleColorScheme } = useMantineColorScheme();
  const t = useTranslations('nav');
  const isDark = colorScheme === 'dark';

  return (
    <Tooltip label={isDark ? t('lightMode') : t('darkMode')}>
      <ActionIcon variant="default" size="lg" onClick={() => toggleColorScheme()} aria-label="Toggle color scheme">
        {isDark ? <IconSun size={18} /> : <IconMoon size={18} />}
      </ActionIcon>
    </Tooltip>
  );
}
