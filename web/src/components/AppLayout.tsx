// The shell: title, tabs across the top, who is signed in, the theme switch and sign-out.

import {
  ActionIcon,
  Anchor,
  AppShell,
  Badge,
  Box,
  Button,
  Container,
  Group,
  Text,
  Tooltip,
} from '@mantine/core';
import {
  IconAdjustmentsHorizontal,
  IconChartHistogram,
  IconCompass,
  IconGauge,
  IconHandStop,
  IconKey,
  IconLayoutDashboard,
  IconLogout,
  IconLogs,
  IconRadar2,
  IconRobot,
} from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { api, LOGOUT_URL } from '../lib/api';
import { useSiteTheme } from '../lib/siteTheme';
import { useMe } from './AuthGate';
import { Logo } from './Logo';
import { ThemeSwitch } from './ThemeSwitch';

const TABS = [
  { to: '/', label: 'Overview', icon: IconRadar2 },
  { to: '/dashboard', label: 'Dashboard', icon: IconLayoutDashboard },
  { to: '/blockers', label: 'Blockers', icon: IconHandStop },
  { to: '/reporting', label: 'Reporting', icon: IconChartHistogram },
  { to: '/performance', label: 'Game', icon: IconGauge },
  { to: '/agents', label: 'Agents', icon: IconRobot },
  { to: '/logs', label: 'Logs', icon: IconLogs },
  { to: '/instructions', label: 'Instructions', icon: IconCompass },
  { to: '/keys', label: 'Keys', icon: IconKey },
  { to: '/settings', label: 'Settings', icon: IconAdjustmentsHorizontal },
] as const;

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
  const { headerTone } = useSiteTheme();

  return (
    <AppShell header={{ height: 127 }} padding={{ base: 'sm', sm: 'md' }}>
      <AppShell.Header withBorder={false} className="am-header" data-tone={headerTone}>
        <Box h="100%" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <Group h={82} px={{ base: 'sm', sm: 'md' }} justify="space-between" wrap="nowrap" gap="sm">
            <Anchor component={Link} to="/" underline="never" c="inherit" aria-label="Agent Manager Delux" style={{ flexShrink: 0 }}>
              <Logo height={72} />
            </Anchor>
            <Group gap="xs" wrap="nowrap" miw={0}>
              <Text size="sm" c="dimmed" truncate="end" maw={240} visibleFrom="sm" title={`Signed in as ${me.login}`}>
                {me.login}
              </Text>
              <ThemeSwitch />
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
          <nav className="am-nav" aria-label="Sections">
            {TABS.map(({ to, label, icon: Icon }) => (
              <NavLink key={to} to={to} end={to === '/'} className="am-nav-link">
                <span className="am-nav-inner">
                  <Icon className="am-nav-icon" size={16} stroke={1.75} aria-hidden />
                  <span className="am-nav-label" data-label={label}>
                    {label}
                  </span>
                  {to === '/blockers' && openBlockers > 0 && (
                    <Badge size="xs" circle color="red" aria-label={`${openBlockers} open`}>
                      {openBlockers}
                    </Badge>
                  )}
                </span>
              </NavLink>
            ))}
          </nav>
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
