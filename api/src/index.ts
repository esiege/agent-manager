// Registers every HTTP function with the Azure Functions host (Node v4 programming model).
// Routes sit under the default "api" prefix: /api/v1/...

import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { guarded, type Ctx, type Handler } from './http';
import { getStore } from './store';
import { heartbeat, postLogs, report } from './handlers/ingest';
import { agent, agents, getLogs, me } from './handlers/read';
import { createKey, listKeys, revokeKey } from './handlers/keys';
import { deleteAlert, listAlerts, saveAlert, sweepAlerts, testAlert } from './handlers/alerts';

function register(name: string, method: 'GET' | 'POST', route: string, handler: Handler) {
  app.http(name, {
    methods: [method],
    route,
    authLevel: 'anonymous', // callers are checked in code: the owner's sign-in or a machine key
    handler: async (request: HttpRequest, invocation: InvocationContext): Promise<HttpResponseInit> => {
      const env = process.env;
      let ctx: Ctx;
      try {
        ctx = { store: getStore(env), now: () => new Date(), env };
      } catch (e) {
        invocation.error((e as Error).message);
        return { status: 500, jsonBody: { error: (e as Error).message } };
      }
      const body = method === 'GET' ? '' : await request.text();
      const res = await guarded(handler, (m) => invocation.error(m))(
        { method: request.method, url: request.url, headers: request.headers as unknown as Headers, body },
        ctx,
      );
      // Refusals go to Application Insights with their reason (never secrets: errors don't contain them).
      if (res.status >= 400 && res.status < 500) {
        invocation.warn(`${name} answered ${res.status}: ${(res.body as { error?: string }).error ?? ''}`);
      }
      return { status: res.status, jsonBody: res.body, headers: { 'cache-control': 'no-store', ...res.headers } };
    },
  });
}

register('report', 'POST', 'v1/report', report);
register('heartbeat', 'POST', 'v1/heartbeat', heartbeat);
register('postLogs', 'POST', 'v1/logs', postLogs);

register('me', 'GET', 'v1/me', me);
register('agents', 'GET', 'v1/agents', agents);
register('agent', 'GET', 'v1/agent', agent);
register('getLogs', 'GET', 'v1/logs', getLogs);

register('listKeys', 'GET', 'v1/keys', listKeys);
register('createKey', 'POST', 'v1/keys', createKey);
register('revokeKey', 'POST', 'v1/keys/revoke', revokeKey);

register('listAlerts', 'GET', 'v1/alerts', listAlerts);
register('saveAlert', 'POST', 'v1/alerts', saveAlert);
register('deleteAlert', 'POST', 'v1/alerts/delete', deleteAlert);
register('testAlert', 'POST', 'v1/alerts/test', testAlert);
register('sweepAlerts', 'POST', 'v1/alerts/sweep', sweepAlerts);
