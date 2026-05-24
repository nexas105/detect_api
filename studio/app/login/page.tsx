'use client';

import {
  Anchor,
  Box,
  Button,
  Center,
  Container,
  Paper,
  PasswordInput,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { IconLock } from '@tabler/icons-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/auth';
import { LanguageToggle } from '@/components/LanguageToggle/LanguageToggle';
import { ColorSchemeToggleButton } from '@/components/ColorSchemeToggleButton/ColorSchemeToggleButton';

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const t = useTranslations('auth');
  const tCommon = useTranslations('common');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      router.push('/');
    } catch (err: any) {
      setError(err.message || t('loginFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        background: 'var(--mantine-color-dark-8)',
      }}
    >
      <Box style={{ position: 'absolute', top: 16, right: 16, display: 'flex', gap: 8 }}>
        <LanguageToggle />
        <ColorSchemeToggleButton />
      </Box>
      <Container size={440} w="100%">
        <Center mb="xl">
          <IconLock size={48} color="var(--mantine-color-violet-5)" />
        </Center>
        <Title ta="center" order={2} mb={4}>
          {tCommon('appName')}
        </Title>
        <Text c="dimmed" size="sm" ta="center" mb="xl">
          {t('signInTitle')}
        </Text>

        <Paper withBorder shadow="md" p={30} radius="md">
          <form onSubmit={handleSubmit}>
            <Stack>
              <TextInput
                label={tCommon('email')}
                placeholder={t('emailPlaceholder')}
                required
                value={email}
                onChange={(e) => setEmail(e.currentTarget.value)}
              />
              <PasswordInput
                label={tCommon('password')}
                placeholder={t('passwordPlaceholder')}
                required
                value={password}
                onChange={(e) => setPassword(e.currentTarget.value)}
              />
              {error && (
                <Text c="red" size="sm">
                  {error}
                </Text>
              )}
              <Button type="submit" fullWidth loading={loading}>
                {t('signIn')}
              </Button>
              <Text c="dimmed" size="sm" ta="center">
                {t('noAccount')}{' '}
                <Anchor href="/register" size="sm">
                  {t('createOneFree')}
                </Anchor>
              </Text>
              <Text c="dimmed" size="xs" ta="center">
                {t('or')}{' '}
                <Anchor href="/demo" size="xs">
                  {t('tryDemo')}
                </Anchor>
              </Text>
            </Stack>
          </form>
        </Paper>
      </Container>
    </Box>
  );
}
