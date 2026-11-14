// The shell: title, tabs across the top, who is signed in, theme toggle and sign-out.

import {
  ActionIcon,
  Anchor,
  AppShell,
  Box,
  Button,
  Container,
  Group,
  Tabs,
  Text,
  Tooltip,
  useComputedColorScheme,
  useMantineColorScheme,
} from '@mantine/core';
import { IconLogout, IconMoon, IconSun } from '@tabler/icons-react';
import { Link, Outlet, useLocation } from 'react-router';
import { LOGOUT_URL } from '../lib/api';
import { useMe } from './AuthGate';

const TABS = [
  { to: '/', label: 'Overview' },
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/reporting', label: 'Reporting' },
  { to: '/performance', label: 'Performance' },
  { to: '/agents', label: 'Agents' },
  { to: '/logs', label: 'Logs' },
  { to: '/instructions', label: 'Instructions' },
  { to: '/settings', label: 'Settings' },
] as const;

function currentTab(pathname: string): string | null {
  if (pathname === '/') return '/';
  const match = TABS.find((t) => t.to !== '/' && (pathname === t.to || pathname.startsWith(`${t.to}/`)));
  return match?.to ?? null;
}

function ThemeToggle() {
  const { setColorScheme } = useMantineColorScheme();
  const computed = useComputedColorScheme('light', { getInitialValueInEffect: true });
  const next = computed === 'dark' ? 'light' : 'dark';
  return (
    <Tooltip label={`Switch to ${next} theme`}>
      <ActionIcon variant="default" size="lg" onClick={() => setColorScheme(next)} aria-label={`Switch to ${next} theme`}>
        {computed === 'dark' ? <IconSun size={18} /> : <IconMoon size={18} />}
      </ActionIcon>
    </Tooltip>
  );
}

export function AppLayout() {
  const me = useMe();
  const { pathname } = useLocation();

  return (
    <AppShell header={{ height: 96 }} padding={{ base: 'sm', sm: 'md' }}>
      <AppShell.Header withBorder={false}>
        <Box h="100%" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <Group h={54} px={{ base: 'sm', sm: 'md' }} justify="space-between" wrap="nowrap" gap="sm">
            <Anchor component={Link} to="/" underline="never" c="inherit" fw={700} fz="lg" style={{ whiteSpace: 'nowrap' }}>
              Agent Manager Deluxe
            </Anchor>
            <Group gap="xs" wrap="nowrap" miw={0}>
              <Text size="sm" c="dimmed" truncate="end" maw={240} visibleFrom="sm" title={`Signed in as ${me.login}`}>
                {me.login}
              </Text>
              <ThemeToggle />
              <Button
                component="a"
                href={LOGOUT_URL}
                variant="default"
                leftSection={<IconLogout size={16} />}
                visibleFrom="sm"
              >
                Sign out
              </Button>
              <Tooltip label="Sign out">
                <ActionIcon component="a" href={LOGOUT_URL} variant="default" size="lg" aria-label="Sign out" hiddenFrom="sm">
                  <IconLogout size={18} />
                </ActionIcon>
              </Tooltip>
            </Group>
          </Group>
          <Tabs value={currentTab(pathname)} activateTabWithKeyboard>
            <Tabs.List className="am-tabs" px={{ base: 4, sm: 'xs' }} aria-label="Sections">
              {TABS.map((tab) => (
                <Tabs.Tab key={tab.to} value={tab.to} renderRoot={(props) => <Link {...props} to={tab.to} />}>
                  {tab.label}
                </Tabs.Tab>
              ))}
            </Tabs.List>
          </Tabs>
        </Box>
      </AppShell.Header>
      <AppShell.Main>
        <Container fluid maw={1600} px={0}>
          <Outlet />
        </Container>
      </AppShell.Main>
    </AppShell>
  );
}
