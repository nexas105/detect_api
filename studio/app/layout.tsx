import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import './globals.css';
import { ColorSchemeScript, mantineHtmlProps, MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { IBM_Plex_Mono, Inter, Space_Grotesk } from 'next/font/google';
import React from 'react';
import { theme } from '../theme';
import { AuthProvider } from '@/lib/auth';
import { AuthGuard } from '@/components/AuthGuard/AuthGuard';
import { I18nProvider } from '@/i18n/I18nProvider';

// UI / body
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

// Display / headings
const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-space-grotesk',
  display: 'swap',
});

// Data (mono): keys, scores, hashes, IDs, labels, timestamps
const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-plex-mono',
  display: 'swap',
});

export const metadata = {
  title: 'EroHub Studio',
  description: 'EroHub admin dashboard',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const fontVars = `${inter.variable} ${spaceGrotesk.variable} ${plexMono.variable}`;
  return (
    <html lang="en" className={fontVars} {...mantineHtmlProps}>
      <head>
        <ColorSchemeScript defaultColorScheme="dark" />
        <link rel="shortcut icon" href="/favicon.svg" />
        <meta
          name="viewport"
          content="minimum-scale=1, initial-scale=1, width=device-width, user-scalable=no"
        />
      </head>
      <body>
        <MantineProvider theme={theme} defaultColorScheme="dark">
          <Notifications position="top-right" />
          <I18nProvider>
            <AuthProvider>
              <AuthGuard>{children}</AuthGuard>
            </AuthProvider>
          </I18nProvider>
        </MantineProvider>
      </body>
    </html>
  );
}
