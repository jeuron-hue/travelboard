// travelboard headless harness (SPEC.md 11). Dev only: never shipped, never precached.
// - static file server over the repo root
// - mock of the tb_* RPCs that mirrors migration 0002 (strict last-write-wins, one
//   microsecond server_ts per batch, keyset pull) plus /auth/v1/health
// - browser context setup: timezone, fake session, controllable geolocation stub
// Needs the dev dependency in package.json (npm install here) or NODE_PATH pointing at
// an existing playwright install. Chromium: npx playwright install chromium.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..', '..');
const SUPA = 'https://nyjsrnntxdgfykkmihpx.supabase.co';
const UID = '11111111-2222-4333-8444-555555555555';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json' };

function startServer(port, overrides = {}) {
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    let rel = decodeURIComponent(u.pathname).replace(/^\/+/, '') || 'index.html';
    let body;
    if (overrides[rel] !== undefined) body = Buffer.from(overrides[rel]);
    else {
      const f = path.join(ROOT, rel);
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
      body = fs.readFileSync(f);
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(rel)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(body);
  });
  return new Promise((r) => srv.listen(port, '127.0.0.1', () => r(srv)));
}

// ---------- mock of migration 0002 ----------
function makeMock() {
  const m = { rows: new Map(), offline: false, unauth: false, seq: 0, calls: [] };
  m.serverTs = () => {
    // microsecond strings like Postgres; all rows of one batch share one value (now() per transaction)
    m.seq++;
    const us = String(m.seq).padStart(6, '0');
    return `2026-10-04T05:00:00.${us}+00:00`;
  };
  m.upsertBatch = (arr) => {
    const ts = m.serverTs();
    return arr.map((p) => {
      if (typeof p.body === 'string' && [...p.body].length > 20000) throw new Error('body too long');
      if (!p.tz) throw new Error('tz required');
      if (!['note', 'journal'].includes(p.kind || 'note')) throw new Error('bad kind');
      const ex = m.rows.get(p.id);
      if (!ex || Date.parse(ex.updated_at) < Date.parse(p.updated_at)) {
        const row = Object.assign({}, p, { server_ts: ts });
        m.rows.set(p.id, row);
        return { id: p.id, applied: true, server_ts: ts };
      }
      return { id: p.id, applied: false, server_ts: ex.server_ts };
    });
  };
  m.since = (ts, id) => {
    const key = (r) => r.server_ts + '|' + r.id;
    const cur = (ts || '') + '|' + (id || '');
    const rows = [...m.rows.values()].filter((r) => !ts || key(r) > cur).sort((a, b) => (key(a) < key(b) ? -1 : 1)).slice(0, 500);
    if (!rows.length) return { rows: [], next_cursor: { server_ts: ts, id } };
    const last = rows[rows.length - 1];
    return { rows, next_cursor: { server_ts: last.server_ts, id: last.id } };
  };
  // Server-side change, e.g. from the dashboard: newer updated_at, new server_ts.
  m.serverEdit = (id, patch) => {
    const ex = m.rows.get(id);
    m.rows.set(id, Object.assign({}, ex, patch, { server_ts: m.serverTs() }));
  };
  return m;
}

async function attachMock(ctx, m) {
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
  await ctx.route(SUPA + '/**', async (route) => {
    const req = route.request();
    if (m.offline) return route.abort('internetdisconnected');
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const u = new URL(req.url());
    if (u.pathname === '/auth/v1/health') return route.fulfill({ status: 200, headers: cors, body: '{}' });
    const json = (status, obj) => route.fulfill({ status, headers: Object.assign({ 'content-type': 'application/json' }, cors), body: JSON.stringify(obj) });
    if (m.unauth) return json(401, { code: 'PGRST301', message: 'JWT expired' });
    const body = req.postDataJSON ? req.postDataJSON() : null;
    m.calls.push(u.pathname);
    try {
      if (u.pathname === '/rest/v1/rpc/tb_captures_upsert') return json(200, m.upsertBatch(body.p));
      if (u.pathname === '/rest/v1/rpc/tb_captures_since') return json(200, m.since(body.p_since_ts, body.p_since_id));
      if (u.pathname === '/rest/v1/rpc/tb_whoami') return json(200, { uid: UID, email: 'gary@travelboard.local' });
    } catch (e) { return json(400, { code: '22023', message: e.message }); }
    return json(404, { message: 'not mocked: ' + u.pathname });
  });
}

function b64u(o) { return Buffer.from(JSON.stringify(o)).toString('base64url'); }
function sessionJson() {
  const exp = 4102444800;
  const jwt = b64u({ alg: 'HS256', typ: 'JWT' }) + '.' + b64u({ sub: UID, role: 'authenticated', exp, aud: 'authenticated', email: 'gary@travelboard.local' }) + '.sig';
  return JSON.stringify({ access_token: jwt, token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: 'refresh-fake',
    user: { id: UID, aud: 'authenticated', role: 'authenticated', email: 'gary@travelboard.local', app_metadata: {}, user_metadata: {}, created_at: '2026-10-04T00:00:00Z' } });
}

// Geolocation stub so the test controls timing: mode deny | grant | hold.
const GEO_INIT = `
  window.__geo = { mode: 'deny', pending: [], calls: 0, lastOpts: null };
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
    getCurrentPosition(ok, err, opts) {
      const g = window.__geo; g.calls++; g.lastOpts = opts;
      const fix = { coords: { latitude: 13.7466, longitude: 100.5393, accuracy: 12.5 }, timestamp: Date.now() };
      if (g.mode === 'deny') setTimeout(() => err && err({ code: 1, message: 'User denied Geolocation' }), 10);
      else if (g.mode === 'hold') g.pending.push(() => ok(fix));
      else setTimeout(() => ok(fix), 10);
    },
    watchPosition() { return 0; }, clearWatch() {}
  }});
`;

async function newContext(browser, { tz, session, swBlock = true }) {
  const ctx = await browser.newContext({ timezoneId: tz, locale: 'en-GB', serviceWorkers: swBlock ? 'block' : 'allow', viewport: { width: 412, height: 860 }, acceptDownloads: true });
  await ctx.addInitScript(GEO_INIT);
  if (session) await ctx.addInitScript(`try { if (!localStorage.getItem('tb-auth')) localStorage.setItem('tb-auth', ${JSON.stringify(sessionJson())}); } catch (e) {}`);
  return ctx;
}

module.exports = { chromium, startServer, makeMock, attachMock, newContext, SUPA, UID };
