/**
 * A tiny in-memory stand-in for the parts of Supabase the site uses (email + password auth and the
 * `fingerprints` table), installed with Playwright request routing. Shared between browser contexts,
 * so two contexts behave like two devices using one account. Enforces "only your own row" like the
 * real row-level security policies do.
 */
import type { BrowserContext, Route } from '@playwright/test';

export const MOCK_URL = 'https://mock.supabase.test';

type MockUser = { id: string; email: string; password: string };

export class MockSupabase {
  users = new Map<string, MockUser>(); // by email
  rows = new Map<string, unknown>(); // fingerprints by user id
  calls: string[] = [];
  private n = 0;

  private session(u: MockUser) {
    return {
      access_token: `tok-${u.id}`,
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      refresh_token: `ref-${u.id}`,
      user: this.userJson(u),
    };
  }

  private userJson(u: MockUser) {
    return {
      id: u.id,
      aud: 'authenticated',
      role: 'authenticated',
      email: u.email,
      email_confirmed_at: new Date().toISOString(),
      app_metadata: { provider: 'email' },
      user_metadata: {},
      created_at: new Date().toISOString(),
    };
  }

  private byToken(auth: string | undefined): MockUser | undefined {
    const id = auth?.replace(/^Bearer tok-/, '');
    return [...this.users.values()].find((u) => u.id === id);
  }

  async install(ctx: BrowserContext) {
    await ctx.route(`${MOCK_URL}/**`, (route) => this.handle(route));
  }

  private json(route: Route, status: number, body: unknown) {
    return route.fulfill({
      status,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: body === undefined ? '' : JSON.stringify(body),
    });
  }

  private async handle(route: Route) {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    const method = req.method();
    if (method === 'OPTIONS') {
      return route.fulfill({
        status: 204,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-headers': '*',
          'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
        },
      });
    }
    this.calls.push(`${method} ${path}`);
    const body = req.postData() ? JSON.parse(req.postData()!) : undefined;
    const me = this.byToken(req.headers()['authorization']);

    if (path === '/auth/v1/signup' && method === 'POST') {
      if (this.users.has(body.email)) return this.json(route, 422, { code: 422, msg: 'User already registered' });
      const u = { id: `00000000-0000-4000-8000-${String(++this.n).padStart(12, '0')}`, email: body.email, password: body.password };
      this.users.set(u.email, u);
      return this.json(route, 200, this.session(u));
    }
    if (path === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') {
      const u = this.users.get(body.email);
      if (!u || u.password !== body.password) {
        return this.json(route, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials' });
      }
      return this.json(route, 200, this.session(u));
    }
    if (path === '/auth/v1/user' && method === 'GET') {
      return me ? this.json(route, 200, this.userJson(me)) : this.json(route, 401, { msg: 'invalid JWT' });
    }
    if (path === '/auth/v1/logout') return route.fulfill({ status: 204 });

    if (path === '/rest/v1/fingerprints') {
      if (!me) return this.json(route, 401, { message: 'not signed in' });
      if (method === 'GET') {
        const asked = url.searchParams.get('user_id')?.replace('eq.', '');
        // Row-level security: only the caller's own row is ever visible.
        const rows = asked === me.id && this.rows.has(me.id) ? [{ data: this.rows.get(me.id) }] : [];
        return this.json(route, 200, rows);
      }
      if (method === 'POST') {
        const rows = Array.isArray(body) ? body : [body];
        for (const r of rows) {
          if (r.user_id !== me.id) return this.json(route, 403, { message: 'new row violates row-level security policy' });
          this.rows.set(me.id, r.data);
        }
        return route.fulfill({ status: 201, headers: { 'access-control-allow-origin': '*' } });
      }
    }
    if (path === '/rest/v1/rpc/delete_my_account' && method === 'POST') {
      if (!me) return this.json(route, 401, { message: 'not signed in' });
      this.rows.delete(me.id);
      this.users.delete(me.email);
      return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
    }
    return this.json(route, 404, { message: `mock has no ${method} ${path}` });
  }
}
