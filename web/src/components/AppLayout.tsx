// The shell: title, tabs across the top, who is signed in, theme toggle and sign-out.

import {
  ActionIcon,
  Anchor,
  AppShell,
  Badge,
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
import { useEffect, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router';
import { api, LOGOUT_URL } from '../lib/api';
import { useMe } from './AuthGate';

const TABS = [
  { to: '/', label: 'Overview' },
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/blockers', label: 'Blockers' },
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

const BLOCKER_COUNT_MS = 20_000;

/**
 * How many blockers are open, for the tab's badge. Quiet on errors: the pages say when the API
 * is unreachable. Reloads on navigation, so answering one updates the badge.
 */
function useOpenBlockers(pathname: string): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const load = () => {
      if (document.visibilityState !== 'visible') return;
      api
        .blockers(controller.signal)
        .then((r) => setCount(r.blockers.filter((b) => b.status === 'open').length))
        .catch(() => {});
    };
    load();
    const timer = setInterval(load, BLOCKER_COUNT_MS);
    document.addEventListener('visibilitychange', load);
    return () => {
      controller.abort();
      clearInterval(timer);
      document.removeEventListener('visibilitychange', load);
    };
  }, [pathname]);
  return count;
}

export function AppLayout() {
  const me = useMe();
  const { pathname } = useLocation();
  const openBlockers = useOpenBlockers(pathname);

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
                <Tabs.Tab
                  key={tab.to}
                  value={tab.to}
                  renderRoot={(props) => <Link {...props} to={tab.to} />}
                  rightSection={
                    tab.to === '/blockers' && openBlockers > 0 ? (
                      <Badge size="xs" circle color="red" aria-label={`${openBlockers} open`}>
                        {openBlockers}
                      </Badge>
                    ) : undefined
                  }
                >
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
