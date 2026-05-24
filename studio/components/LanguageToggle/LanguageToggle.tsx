'use client';

import { Button, Menu, Tooltip } from '@mantine/core';
import { IconLanguage } from '@tabler/icons-react';
import { useLocale, SUPPORTED_LOCALES } from '@/i18n/I18nProvider';
import { useTranslations } from 'next-intl';

const LABELS: Record<string, string> = { en: 'EN', de: 'DE' };

export function LanguageToggle() {
  const { locale, setLocale } = useLocale();
  const t = useTranslations('nav');

  return (
    <Menu shadow="md" width={120} position="bottom-end">
      <Menu.Target>
        <Tooltip label={t('language')}>
          <Button
            variant="default"
            size="xs"
            leftSection={<IconLanguage size={14} />}
            px="xs"
          >
            {LABELS[locale] ?? locale.toUpperCase()}
          </Button>
        </Tooltip>
      </Menu.Target>
      <Menu.Dropdown>
        {SUPPORTED_LOCALES.map((l) => (
          <Menu.Item
            key={l}
            onClick={() => setLocale(l)}
            fw={l === locale ? 700 : 400}
          >
            {LABELS[l] ?? l.toUpperCase()}
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  );
}
