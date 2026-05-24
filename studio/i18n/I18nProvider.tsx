'use client';

import { NextIntlClientProvider } from 'next-intl';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE, type Locale, SUPPORTED_LOCALES } from './config';

// Only import default locale statically for SSR/initial render
import defaultMessages from '../messages/en.json';

interface LocaleCtx {
  locale: Locale;
  setLocale: (l: Locale) => void;
  toggleLocale: () => void;
}

const Ctx = createContext<LocaleCtx | null>(null);

const messageLoaders: Record<Locale, () => Promise<Record<string, unknown>>> = {
  en: () => import('../messages/en.json').then((m) => m.default as Record<string, unknown>),
  de: () => import('../messages/de.json').then((m) => m.default as Record<string, unknown>),
};

function detectInitialLocale(): Locale {
  if (typeof document === 'undefined') return DEFAULT_LOCALE;
  const match = document.cookie.match(/(?:^|;\s*)NEXT_LOCALE=([^;]+)/);
  if (match && isLocale(match[1])) return match[1];
  const nav = navigator.language?.slice(0, 2).toLowerCase();
  if (isLocale(nav)) return nav;
  return DEFAULT_LOCALE;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);
  const [messages, setMessages] = useState<Record<string, unknown>>(defaultMessages as Record<string, unknown>);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const initial = detectInitialLocale();
    setLocaleState(initial);
    document.documentElement.lang = initial;
    if (initial !== DEFAULT_LOCALE) {
      messageLoaders[initial]().then(setMessages);
    }
    setReady(true);
  }, []);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    document.cookie = `${LOCALE_COOKIE}=${l};path=/;max-age=${60 * 60 * 24 * 365};SameSite=Lax`;
    document.documentElement.lang = l;
    messageLoaders[l]().then(setMessages);
  }, []);

  const toggleLocale = useCallback(() => {
    setLocale(locale === 'en' ? 'de' : 'en');
  }, [locale, setLocale]);

  const value = useMemo(() => ({ locale, setLocale, toggleLocale }), [locale, setLocale, toggleLocale]);

  const activeLocale = ready ? locale : DEFAULT_LOCALE;

  return (
    <Ctx.Provider value={value}>
      <NextIntlClientProvider locale={activeLocale} messages={messages}>
        {children}
      </NextIntlClientProvider>
    </Ctx.Provider>
  );
}

export function useLocale() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useLocale must be used inside I18nProvider');
  return ctx;
}

export { SUPPORTED_LOCALES };
