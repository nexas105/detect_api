'use client';

import {
  ActionIcon,
  AppShell,
  Badge,
  Box,
  Burger,
  Group,
  Menu,
  ScrollArea,
  Text,
  Title,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import { useDisclosure, useLocalStorage, useMediaQuery } from '@mantine/hooks';
import {
  IconBrain,
  IconBuilding,
  IconChartBar,
  IconChevronLeft,
  IconChevronRight,
  IconDashboard,
  IconFlask,
  IconKey,
  IconListCheck,
  IconLogout,
  IconMovie,
  IconPhoto,
  IconScan,
  IconShieldCheck,
  IconStars,
  IconTag,
  IconUpload,
  IconUser,
  IconUserOff,
  IconUsers,
  IconVectorBezier2,
  IconWebhook,
  IconYoga,
} from '@tabler/icons-react';
import { usePathname, useRouter } from 'next/navigation';
import type { ComponentType, ReactNode } from 'react';
import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/auth';
import { ColorSchemeToggleButton } from '@/components/ColorSchemeToggleButton/ColorSchemeToggleButton';
import { DetectionFrame } from '@/components/DetectionFrame';
import { LanguageToggle } from '@/components/LanguageToggle/LanguageToggle';

type NavKey =
  | 'dashboard'
  | 'usage'
  | 'apiKeys'
  | 'upload'
  | 'rateMe'
  | 'detections'
  | 'faces'
  | 'jobs'
  | 'webhooks'
  | 'users'
  | 'tenants'
  | 'demoStats'
  | 'models'
  | 'moderate'
  | 'anonymize'
  | 'embed'
  | 'tag'
  | 'pose'
  | 'scenes';

type NavItem = {
  key: NavKey;
  href: string;
  icon: ComponentType<{ size?: number; stroke?: number }>;
  section: 'detection' | 'account' | 'admin';
  adminOnly?: boolean;
  superAdminOnly?: boolean;
  fallbackLabel?: string;
};

const NAV_ITEMS: NavItem[] = [
  { key: 'dashboard', href: '/', icon: IconDashboard, section: 'account' },
  { key: 'upload', href: '/upload', icon: IconUpload, section: 'detection' },
  { key: 'rateMe', href: '/rateme', icon: IconStars, section: 'detection' },
  { key: 'moderate', href: '/moderate', icon: IconShieldCheck, section: 'detection' },
  { key: 'anonymize', href: '/anonymize', icon: IconUserOff, section: 'detection' },
  { key: 'embed', href: '/embed', icon: IconVectorBezier2, section: 'detection' },
  { key: 'tag', href: '/tag', icon: IconTag, section: 'detection' },
  { key: 'pose', href: '/pose', icon: IconYoga, section: 'detection' },
  { key: 'scenes', href: '/scenes', icon: IconMovie, section: 'detection' },
  { key: 'faces', href: '/faces', icon: IconScan, section: 'detection', fallbackLabel: 'Faces' },
  { key: 'detections', href: '/detections', icon: IconPhoto, section: 'detection' },
  { key: 'models', href: '/models', icon: IconBrain, section: 'detection' },
  { key: 'jobs', href: '/jobs', icon: IconListCheck, section: 'account', fallbackLabel: 'Jobs' },
  { key: 'usage', href: '/usage', icon: IconChartBar, section: 'account' },
  { key: 'apiKeys', href: '/api-keys', icon: IconKey, section: 'account' },
  { key: 'webhooks', href: '/webhooks', icon: IconWebhook, section: 'account', fallbackLabel: 'Webhooks' },
  { key: 'users', href: '/users', icon: IconUsers, section: 'admin', adminOnly: true },
  { key: 'tenants', href: '/tenants', icon: IconBuilding, section: 'admin', adminOnly: true },
  { key: 'demoStats', href: '/demo-stats', icon: IconFlask, section: 'admin', superAdminOnly: true },
];

const SECTION_ORDER: Array<{ key: 'detection' | 'account' | 'admin'; labelKey: string; fallback: string }> = [
  { key: 'detection', labelKey: 'detection', fallback: 'Detection' },
  { key: 'account', labelKey: 'account', fallback: 'Account' },
  { key: 'admin', labelKey: 'admin', fallback: 'Admin' },
];

function safeT(t: (k: string) => string, key: string, fallback: string): string {
  try {
    const v = t(key);
    return v && v !== key ? v : fallback;
  } catch {
    return fallback;
  }
}

interface NavButtonProps {
  item: NavItem;
  label: string;
  active: boolean;
  collapsed: boolean;
  onClick: () => void;
}

function NavButton({ item, label, active, collapsed, onClick }: NavButtonProps) {
  const Icon = item.icon;
  const button = (
    <UnstyledButton
      className="studio-nav-item"
      onClick={onClick}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        width: '100%',
        minHeight: 40,
        padding: collapsed ? '10px 0' : '8px 12px',
        justifyContent: collapsed ? 'center' : 'flex-start',
        borderRadius: 'var(--mantine-radius-sm)',
        color: active ? 'var(--mantine-color-cyan-5)' : 'var(--text-hi)',
        background: active ? 'var(--surface-2)' : 'transparent',
        fontSize: 14,
        fontWeight: active ? 600 : 500,
      }}
    >
      <Icon size={20} stroke={active ? 1.9 : 1.6} />
      {!collapsed && <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>}
    </UnstyledButton>
  );

  // Signature Detection-Bracket frames only the active item.
  return (
    <DetectionFrame
      active={active}
      color="var(--mantine-color-cyan-5)"
      size={7}
      inset={-1}
      weight={1.5}
      style={{ width: '100%' }}
    >
      {collapsed ? (
        <Tooltip label={label} position="right" withArrow>
          {button}
        </Tooltip>
      ) : (
        button
      )}
    </DetectionFrame>
  );
}

export function DashboardShell({ children }: { children: ReactNode }) {
  const [mobileOpened, { toggle: toggleMobile, close: closeMobile }] = useDisclosure();
  const [desktopCollapsed, setDesktopCollapsed] = useLocalStorage<boolean>({
    key: 'studio-sidebar-collapsed',
    defaultValue: false,
    getInitialValueInEffect: true,
  });
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const { user, logout, tenant_name } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const tNav = useTranslations('nav');
  const tCommon = useTranslations('common');

  const isAdmin = user?.role === 'admin';
  const isSuperAdmin = isAdmin && tenant_name === 'default';

  // Close mobile drawer on route change
  useEffect(() => {
    closeMobile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  const visibleItems = NAV_ITEMS.filter((item) => {
    if (item.superAdminOnly) return isSuperAdmin;
    if (item.adminOnly) return isAdmin;
    return true;
  });

  const handleNav = (href: string) => {
    router.push(href);
    closeMobile();
  };

  const handleLogout = () => {
    logout();
    router.push('/login');
  };

  const navbarWidth = desktopCollapsed ? 72 : 240;

  const navContent = (
    <ScrollArea style={{ height: '100%' }} scrollbarSize={6}>
      <Box p={desktopCollapsed ? 8 : 12}>
        {SECTION_ORDER.map((section) => {
          const items = visibleItems.filter((i) => i.section === section.key);
          if (items.length === 0) return null;
          return (
            <Box key={section.key} mb="md">
              {!desktopCollapsed && (
                <Text
                  className="data-mono"
                  tt="uppercase"
                  fz={10}
                  fw={600}
                  c="dimmed"
                  px="sm"
                  mb={8}
                  lts={1.2}
                >
                  {safeT(tNav, section.labelKey, section.fallback)}
                </Text>
              )}
              <Box style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {items.map((item) => {
                  const label = safeT(tNav, item.key, item.fallbackLabel ?? item.key);
                  const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
                  return (
                    <NavButton
                      key={item.href}
                      item={item}
                      label={label}
                      active={active}
                      collapsed={desktopCollapsed && !!isDesktop}
                      onClick={() => handleNav(item.href)}
                    />
                  );
                })}
              </Box>
            </Box>
          );
        })}
      </Box>
    </ScrollArea>
  );

  return (
    <AppShell
      header={{ height: 56 }}
      navbar={{
        width: navbarWidth,
        breakpoint: 'md',
        collapsed: { mobile: !mobileOpened },
      }}
      padding={0}
      layout="alt"
    >
      <AppShell.Header
        withBorder
        style={{
          background: 'var(--surface)',
          backdropFilter: 'saturate(180%) blur(8px)',
        }}
      >
        <Group h="100%" px={{ base: 'sm', md: 'lg' }} justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            <Burger
              opened={mobileOpened}
              onClick={toggleMobile}
              hiddenFrom="md"
              size="sm"
              aria-label="Toggle navigation"
            />
            <Group gap={8} align="baseline" wrap="nowrap">
              <Title order={4} c="cyan.5" style={{ letterSpacing: -0.4 }}>
                EroHub
              </Title>
              <Text className="data-mono" fz={10} fw={600} c="dimmed" tt="uppercase" lts={2} visibleFrom="xs">
                Studio
              </Text>
            </Group>
          </Group>
          <Group gap={6} wrap="nowrap">
            <LanguageToggle />
            <ColorSchemeToggleButton />
            {user && (
              <Menu shadow="md" width={220} position="bottom-end">
                <Menu.Target>
                  <UnstyledButton
                    aria-label="User menu"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '6px 10px',
                      borderRadius: 'var(--mantine-radius-md)',
                      minHeight: 36,
                    }}
                  >
                    <IconUser size={18} />
                    <Text size="sm" visibleFrom="sm" style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {user.email}
                    </Text>
                  </UnstyledButton>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Label>
                    <Group justify="space-between" wrap="nowrap">
                      <Text size="xs" truncate>{user.email}</Text>
                      <Badge size="xs" variant="light" color={isAdmin ? 'violet' : 'gray'}>
                        {user.role}
                      </Badge>
                    </Group>
                  </Menu.Label>
                  <Menu.Divider />
                  <Menu.Item leftSection={<IconLogout size={16} />} onClick={handleLogout} color="red">
                    {tNav('logout')}
                  </Menu.Item>
                </Menu.Dropdown>
              </Menu>
            )}
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar withBorder style={{ background: 'var(--surface)' }}>
        <Box style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          <Box style={{ flex: 1, minHeight: 0 }}>{navContent}</Box>
          <Box
            p="xs"
            style={{
              borderTop: '1px solid var(--mantine-color-default-border)',
            }}
            visibleFrom="md"
          >
            <Tooltip
              label={desktopCollapsed ? safeT(tCommon, 'expand', 'Expand') : safeT(tCommon, 'collapse', 'Collapse')}
              position="right"
            >
              <ActionIcon
                variant="default"
                size="lg"
                onClick={() => setDesktopCollapsed(!desktopCollapsed)}
                aria-label="Toggle sidebar"
                style={{ width: '100%' }}
              >
                {desktopCollapsed ? <IconChevronRight size={16} /> : <IconChevronLeft size={16} />}
              </ActionIcon>
            </Tooltip>
          </Box>
        </Box>
      </AppShell.Navbar>

      <AppShell.Main
        style={{
          background: 'var(--bg)',
          minHeight: '100vh',
        }}
      >
        <Box
          style={{
            maxWidth: 1400,
            margin: '0 auto',
            padding: 'clamp(16px, 4vw, 40px)',
          }}
        >
          {children}
        </Box>
      </AppShell.Main>
    </AppShell>
  );
}
