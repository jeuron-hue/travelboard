// travelboard headless harness (SPEC.md 11). Dev only: never shipped, never precached.
// - static file server over the repo root
// - mock of the tb_* RPCs that mirrors migration 0002 (strict last-write-wins, one
//   microsecond server_ts per batch, keyset pull) plus /auth/v1/health
// - mock of the journal RPCs (migrations 0003, 0004) and of the tb-journal Edge Function,
//   built on the function's own context.mjs, with switchable failure modes
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
  addJournal(m);
  return m;
}

// ---------- mock of migrations 0003 and 0004, and of tb-journal ----------
// Same semantics as the SQL: turn upsert by id never changes a stored turn; one reply per
// turn; thread order is user turns by (created_at, id), each reply straight after its turn.
// The simulated tb-journal builds its prompt with the function's own context.mjs.
let context = null;
async function loadContext() {
  if (!context) context = await import(path.join(ROOT, 'supabase', 'functions', 'tb-journal', 'context.mjs'));
  return context;
}
function addJournal(m) {
  m.jrows = new Map();          // id -> message row
  m.jdays = new Map();          // local_date -> { suffix, server_ts }
  m.claude = [];                // every simulated Claude call: { system, messages }
  m.fnMode = 'ok';              // ok | anthropic_auth | busy | refusal | hang
  m.fnCalls = [];               // every tb-journal request body
  m.fnDelayMs = 0;
  const key = (r) => r.role === 'assistant' ? [m.jrows.get(r.reply_to).created_at, r.reply_to, 1] : [r.created_at, r.id, 0];
  const cmp = (a, b) => {
    const x = key(a), y = key(b);
    for (let i = 0; i < 3; i++) {
      const p = i === 0 ? Date.parse(x[i]) : x[i], q = i === 0 ? Date.parse(y[i]) : y[i];
      if (p < q) return -1; if (p > q) return 1;
    }
    return 0;
  };
  m.jorder = (rows) => rows.slice().sort(cmp);
  const replyOf = (id) => [...m.jrows.values()].find((r) => r.role === 'assistant' && r.reply_to === id) || null;
  m.turn = (p) => {
    if (!p.message_id || !p.local_date || !p.created_at) throw new Error('message_id, local_date and created_at are required');
    if (!String(p.content || '').trim()) throw new Error('content is empty');
    let u = m.jrows.get(p.message_id);
    if (u && u.role !== 'user') { const e = new Error('not a user turn'); e.code = '42501'; throw e; }
    if (!u) {
      u = { id: p.message_id, local_date: p.local_date, role: 'user', content: p.content, reply_to: null, model: null,
        input_tokens: null, output_tokens: null, created_at: p.created_at, server_ts: m.serverTs() };
      m.jrows.set(u.id, u);
    }
    const reply = replyOf(u.id);
    if (reply) return { user: u, reply };
    const thread = m.jorder([...m.jrows.values()].filter((r) => r.local_date === u.local_date))
      .filter((r) => cmp(r, u) <= 0).map((r) => ({ id: r.id, role: r.role, content: r.content, created_at: r.created_at }));
    const captures = [...m.rows.values()].filter((c) => c.local_date === u.local_date && !c.deleted_at)
      .sort((a, b) => (a.captured_at < b.captured_at ? -1 : 1));
    return { user: u, reply: null, thread, captures };
  };
  m.reply = (p) => {
    const parent = m.jrows.get(p.reply_to);
    if (!parent || parent.role !== 'user') throw new Error('reply_to is not one of your user turns');
    const ex = replyOf(parent.id);
    if (ex) return { reply: ex, inserted: false };
    const ts = m.serverTs();
    const r = { id: crypto.randomUUID(), local_date: parent.local_date, role: 'assistant', content: p.content,
      reply_to: parent.id, model: p.model, input_tokens: p.input_tokens, output_tokens: p.output_tokens,
      created_at: new Date().toISOString(), server_ts: ts };
    m.jrows.set(r.id, r);
    return { reply: r, inserted: true };
  };
  m.jday = (d) => ({ local_date: d, suffix: (m.jdays.get(d) || {}).suffix || '',
    messages: m.jorder([...m.jrows.values()].filter((r) => r.local_date === d)) });
  m.jdayList = (limit) => {
    const dates = new Set([...m.jrows.values()].map((r) => r.local_date).concat([...m.jdays.keys()]));
    return [...dates].sort().reverse().slice(0, limit || 400).map((d) => {
      const rows = [...m.jrows.values()].filter((r) => r.local_date === d);
      const ts = rows.map((r) => r.server_ts).concat(m.jdays.has(d) ? [m.jdays.get(d).server_ts] : []).sort();
      return { local_date: d, messages: rows.length, last_server_ts: ts[ts.length - 1] || null,
        suffix: (m.jdays.get(d) || {}).suffix || '' };
    });
  };
  m.jsuffix = (d, s) => {
    const suffix = String(s || '').trim();
    if (suffix.length > 200) throw new Error('suffix longer than 200 characters');
    const ts = m.serverTs();
    m.jdays.set(d, { suffix, server_ts: ts });
    return { local_date: d, suffix, server_ts: ts };
  };
  // Simulated tb-journal: same request, responses and error shapes as index.ts.
  m.fn = async (body) => {
    m.fnCalls.push(body);
    if (m.fnDelayMs) await new Promise((r) => setTimeout(r, m.fnDelayMs));
    if (m.fnMode === 'hang') return new Promise(() => {});
    const turn = m.turn(body);
    if (turn.reply) return [200, { user: turn.user, reply: turn.reply, cached: true }];
    if (m.fnMode === 'anthropic_auth') return [502, { error: 'anthropic_auth', message: 'Anthropic rejected TB_ANTHROPIC_API_KEY (401). Check the key in the travelboard workspace and the Edge Function secret.' }];
    if (m.fnMode === 'busy') return [503, { error: 'anthropic_busy', message: 'Claude is busy or the workspace limit is reached (529). Try again later.' }];
    if (m.fnMode === 'refusal') return [502, { error: 'refusal', message: 'Claude declined to answer this one. Rephrase and send again.' }];
    const c = await loadContext();
    const system = c.buildSystem('PROMPT', turn.user.local_date, turn.captures);
    const messages = c.buildMessages(turn.thread);
    m.claude.push({ system, messages });
    const caps = turn.captures.map((x) => x.body.split('\n')[0]).join(' / ');
    const text = `Reply ${m.claude.length} to "${messages[messages.length - 1].content}"` + (caps ? `. Captures: ${caps}` : '');
    const stored = m.reply({ reply_to: body.message_id, content: text, model: 'claude-sonnet-5-5', input_tokens: 1000 + m.claude.length, output_tokens: 50 });
    return [200, { user: turn.user, reply: stored.reply, cached: !stored.inserted }];
  };
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
    if (u.pathname === '/functions/v1/tb-journal') {
      if (!/^Bearer eyJ/.test(req.headers()['authorization'] || '')) return json(401, { code: 401, message: 'Invalid JWT' });
      try {
        const [status, out] = await m.fn(body);
        // Lost response: the function finished (reply stored) but the phone never heard back.
        if (m.fnDropResponse) { m.fnDropResponse = false; return route.abort('failed'); }
        return json(status, out);
      } catch (e) { return json(400, { error: 'bad_request', message: e.message }); }
    }
    try {
      if (u.pathname === '/rest/v1/rpc/tb_journal_days') return json(200, m.jdayList(body.p_limit));
      if (u.pathname === '/rest/v1/rpc/tb_journal_day') return json(200, m.jday(body.p_local_date));
      if (u.pathname === '/rest/v1/rpc/tb_journal_day_suffix') return json(200, m.jsuffix(body.p_local_date, body.p_suffix));
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

module.exports = { chromium, startServer, makeMock, attachMock, newContext, loadContext, SUPA, UID, ROOT };
