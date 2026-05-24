import { getRequestConfig } from 'next-intl/server';
import { cookies, headers } from 'next/headers';
import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE } from './config';
import enMessages from '../messages/en.json';
import deMessages from '../messages/de.json';

const MESSAGES = {
  en: enMessages,
  de: deMessages,
} as const;

export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get(LOCALE_COOKIE)?.value;

  let locale = DEFAULT_LOCALE;
  if (isLocale(cookieLocale)) {
    locale = cookieLocale;
  } else {
    try {
      const hdrs = await headers();
      const accept = hdrs.get('accept-language') ?? '';
      const primary = accept.split(',')[0]?.trim().slice(0, 2).toLowerCase();
      if (isLocale(primary)) locale = primary;
    } catch {
      // no-op
    }
  }

  return {
    locale,
    messages: MESSAGES[locale],
  };
});
