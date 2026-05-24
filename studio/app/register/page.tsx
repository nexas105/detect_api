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
import { IconUserPlus } from '@tabler/icons-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { AUTH_URL } from '@/lib/auth';
import { LanguageToggle } from '@/components/LanguageToggle/LanguageToggle';
import { ColorSchemeToggleButton } from '@/components/ColorSchemeToggleButton/ColorSchemeToggleButton';

export default function RegisterPage() {
  const router = useRouter();
  const t = useTranslations('auth');
  const tCommon = useTranslations('common');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password !== confirm) {
      setError(t('passwordsMismatch'));
      return;
    }
    if (password.length < 8) {
      setError(t('passwordTooShort'));
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${AUTH_URL}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || t('registrationFailed'));
      }
      const data = await res.json();
      localStorage.setItem('access_token', data.access_token);
      localStorage.setItem('refresh_token', data.refresh_token);
      router.push('/');
      router.refresh();
    } catch (err: any) {
      setError(err.message || t('registrationFailed'));
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
          <IconUserPlus size={48} color="var(--mantine-color-violet-5)" />
        </Center>
        <Title ta="center" order={2} mb={4}>
          {t('createAccount')}
        </Title>
        <Text c="dimmed" size="sm" ta="center" mb="xl">
          {t('freeTier')}
        </Text>

        <Paper withBorder shadow="md" p={30} radius="md">
          <form onSubmit={handleSubmit}>
            <Stack>
              <TextInput
                label={tCommon('email')}
                placeholder={t('registerEmailPlaceholder')}
                required
                value={email}
                onChange={(e) => setEmail(e.currentTarget.value)}
              />
              <PasswordInput
                label={tCommon('password')}
                placeholder={t('registerPasswordPlaceholder')}
                required
                value={password}
                onChange={(e) => setPassword(e.currentTarget.value)}
              />
              <PasswordInput
                label={t('confirmPassword')}
                placeholder={t('confirmPasswordPlaceholder')}
                required
                value={confirm}
                onChange={(e) => setConfirm(e.currentTarget.value)}
              />
              {error && (
                <Text c="red" size="sm">
                  {error}
                </Text>
              )}
              <Button type="submit" fullWidth loading={loading}>
                {t('createAccount')}
              </Button>
              <Text c="dimmed" size="sm" ta="center">
                {t('haveAccount')}{' '}
                <Anchor href="/login" size="sm">
                  {t('signIn')}
                </Anchor>
              </Text>
            </Stack>
          </form>
        </Paper>
      </Container>
    </Box>
  );
}
