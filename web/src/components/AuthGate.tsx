// Shows the app only to the signed-in owner. 401 shows a sign-in card, 403 says whose account it is.

import type { MeResponse } from '@agent-manager/shared';
import { Button, Center, Loader, Paper, Stack, Text, Title } from '@mantine/core';
import { IconLogin, IconLogout } from '@tabler/icons-react';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router';
import { api, fetchSignedInName, LOGOUT_URL, loginUrl, onAuthProblem, toRequestError } from '../lib/api';

type AuthState =
  | { status: 'checking' }
  | { status: 'owner'; me: MeResponse }
  | { status: 'signed-out' }
  | { status: 'not-owner'; name: string | null; reason: string }
  | { status: 'error'; message: string };

const MeContext = createContext<MeResponse | null>(null);

/** The signed-in owner. Only valid inside the gate. */
export function useMe(): MeResponse {
  const me = useContext(MeContext);
  if (!me) throw new Error('useMe() is only available inside <AuthGate>.');
  return me;
}

function Card({ children }: { children: ReactNode }) {
  return (
    <Center mih="100vh" p="md">
      <Paper withBorder shadow="sm" radius="md" p="xl" maw={420} w="100%">
        <Stack gap="md">
          <Title order={1} size="h3">
            Agent Manager
          </Title>
          {children}
        </Stack>
      </Paper>
    </Center>
  );
}

export function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'checking' });
  const location = useLocation();
  const checking = useRef(false);
  const signedIn = useRef(false);

  useEffect(() => {
    signedIn.current = state.status === 'owner';
  }, [state.status]);

  const check = useCallback(async () => {
    if (checking.current) return;
    checking.current = true;
    try {
      const me = await api.me();
      setState({ status: 'owner', me });
    } catch (e) {
      const error = toRequestError(e);
      if (error.status === 401) setState({ status: 'signed-out' });
      else if (error.status === 403) setState({ status: 'not-owner', name: await fetchSignedInName(), reason: error.message });
      // A passing network error shouldn't throw the owner out of the app.
      else setState((s) => (s.status === 'owner' ? s : { status: 'error', message: error.message }));
    } finally {
      checking.current = false;
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  // A request that comes back 401 or 403 while signed in (an expired session, say) checks again.
  useEffect(() => {
    let pending: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = onAuthProblem(() => {
      if (!signedIn.current) return;
      clearTimeout(pending);
      pending = setTimeout(() => void check(), 200);
    });
    return () => {
      clearTimeout(pending);
      unsubscribe();
    };
  }, [check]);

  switch (state.status) {
    case 'checking':
      return (
        <Center mih="100vh">
          <Loader aria-label="Loading" />
        </Center>
      );
    case 'signed-out':
      return (
        <Card>
          <Text>Sign in to see your agents.</Text>
          <Button
            component="a"
            href={loginUrl(location.pathname + location.search)}
            leftSection={<IconLogin size={18} />}
          >
            Sign in
          </Button>
        </Card>
      );
    case 'not-owner':
      return (
        <Card>
          <Text>
            {state.name ? (
              <>
                Signed in as <b>{state.name}</b>, which isn&apos;t the owner account.
              </>
            ) : (
              <>You&apos;re signed in with an account that isn&apos;t the owner account.</>
            )}
          </Text>
          <Text size="sm" c="dimmed">
            The server said: {state.reason}
          </Text>
          <Button component="a" href={LOGOUT_URL} variant="default" leftSection={<IconLogout size={18} />}>
            Sign out
          </Button>
        </Card>
      );
    case 'error':
      return (
        <Card>
          <Text c="red">{state.message}</Text>
          <Button
            variant="default"
            onClick={() => {
              setState({ status: 'checking' });
              void check();
            }}
          >
            Try again
          </Button>
        </Card>
      );
    case 'owner':
      return <MeContext.Provider value={state.me}>{children}</MeContext.Provider>;
  }
}
