import bundleAnalyzer from '@next/bundle-analyzer';
import createNextIntlPlugin from 'next-intl/plugin';

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
});

const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

export default withNextIntl(
  withBundleAnalyzer({
    reactStrictMode: false,
    allowedDevOrigins: ['mbp', 'mbp.local', '192.168.188.53'],
    experimental: {
      optimizePackageImports: ['@mantine/core', '@mantine/hooks', '@tabler/icons-react', 'next-intl'],
    },
  })
);
