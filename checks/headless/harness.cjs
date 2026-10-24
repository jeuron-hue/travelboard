// travelboard headless harness (SPEC.md 11). Dev only: never shipped, never precached.
// - static file server over the repo root
// - mock of the tb_* RPCs that mirrors migration 0002 (strict last-write-wins, one
//   microsecond server_ts per batch, keyset pull) plus /auth/v1/health
// - mock of the journal RPCs (migrations 0003, 0004) and of the tb-journal Edge Function,
//   built on the function's own context.mjs, with switchable failure modes
// - mock of Storage bucket tb-photos (migration 0006): upload with upsert, own folder only,
//   2 MB and JPEG only, download, a switch to make uploads fail
// - M1.2 (migration 0008): two users, Gary (UID) and Eric (ERIC_UID). Every row has an
//   owner, the caller comes from the JWT's sub; people, one-way adds (live when both),
//   shared captures, tb_partner_captures, tb_whoami with link states, journal rows per owner,
//   a partner's shared photo readable through the Storage mock; GoTrue password sign-in
//   and password change (PUT /auth/v1/user), with a switch that demands reauthentication
// - M1.3 (migration 0009): place_name on captures (trimmed, blank as null, over 120 refused,
//   absent keeps the stored value), journal_prompt_custom per person with tb_prompt_get and
//   tb_prompt_set (own row only), carried to the simulated tb-journal through me
// - OpenStreetMap Nominatim reverse geocoding mock (7C.4): counts requests, switchable to fail
//   or return nothing
// - browser context setup: timezone, fake session (Gary's or Eric's), controllable geolocation stub
// Needs the dev dependency in package.json (npm install here) or NODE_PATH pointing at
// an existing playwright install. Chromium: npx playwright install chromium.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..', '..');
const SUPA = 'https://nnnnonspfljdkrxstslw.supabase.co';
const UID = '11111111-2222-4333-8444-555555555555';         // Gary
const ERIC_UID = '66666666-7777-4888-9999-aaaaaaaaaaaa';    // Eric (M1.2)
const EMAIL = { [UID]: 'gary@travelboard.local', [ERIC_UID]: 'eric@travelboard.local' };
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
  m.pushLog = [];               // every row as pushed: { id, photo_path, at }
  // M1.2: people, adds, links. Gary and Eric exist from the start, not linked.
  m.people = new Map([[UID, { name: 'Gary', prompt: 'journal', custom: null }], [ERIC_UID, { name: 'Eric', prompt: 'journal-eric', custom: null }]]);
  // Migration 0009: the caller's own prompt row only.
  m.promptGet = (uid = UID) => { const p = m.people.get(uid); return { journal_prompt: p ? p.prompt : null, journal_prompt_custom: p ? p.custom : null }; };
  m.promptSet = (text, uid = UID) => {
    const p = m.people.get(uid);
    if (!p) { const e = new Error('caller is not a person in travelboard'); e.code = '42501'; throw e; }
    const t = text == null ? null : String(text).trim() || null;
    if (t && [...t].length > 4000) throw new Error('journal prompt longer than 4000 characters');
    p.custom = t;
    return m.promptGet(uid);
  };
  m.adds = new Map();           // 'adder|added' -> { removed_at }
  const added = (a, b) => { const x = m.adds.get(a + '|' + b); return !!x && !x.removed_at; };
  m.linked = (a, b) => added(a, b) && added(b, a);
  m.linkState = (me, other) => (added(me, other) && added(other, me) ? 'live' : added(me, other) ? 'added_by_me' : added(other, me) ? 'added_me' : 'none');
  m.whoami = (uid = UID) => ({ uid, email: EMAIL[uid] || null, display_name: (m.people.get(uid) || {}).name || null,
    people: [...m.people.entries()].filter(([u]) => u !== uid).map(([u, p]) => ({ uid: u, name: p.name, link: m.linkState(uid, u) })) });
  m.partnerAdd = (p, uid = UID) => {
    if (!p || p === uid || !m.people.has(p)) throw new Error('p_uid must be another person in travelboard');
    m.adds.set(uid + '|' + p, { removed_at: null });
    return { uid: p, link: m.linkState(uid, p) };
  };
  m.partnerRemove = (p, uid = UID) => {
    if (!p || p === uid || !m.people.has(p)) throw new Error('p_uid must be another person in travelboard');
    const x = m.adds.get(uid + '|' + p);
    if (x && !x.removed_at) x.removed_at = new Date().toISOString();
    return { uid: p, link: m.linkState(uid, p) };
  };
  // Visible to uid from others: shared, not deleted, owner linked live.
  m.visible = (c, uid) => c.owner !== uid && c.shared === true && !c.deleted_at && m.linked(uid, c.owner);
  m.partnerCaptures = (uid = UID) => [...m.rows.values()].filter((c) => m.visible(c, uid))
    .sort((a, b) => (a.captured_at < b.captured_at ? -1 : a.captured_at > b.captured_at ? 1 : a.id < b.id ? -1 : 1))
    .map((c) => Object.assign({}, c, { owner_name: m.people.get(c.owner).name }));
  m.canRead = (path, uid) => {
    if (path.split('/')[0] === uid) return true;
    const id = (/^[^/]+\/([0-9a-f-]{36})\.jpg$/.exec(path) || [])[1];
    const c = id && m.rows.get(id);
    return !!c && c.photo_path === path && m.visible(c, uid);
  };
  m.upsertBatch = (arr, uid = UID) => {
    const ts = m.serverTs();
    for (const p of arr) {
      const ex = m.rows.get(p.id);
      if (ex && ex.owner !== uid) { const e = new Error('capture ' + p.id + ' belongs to another user'); e.code = '42501'; throw e; }
    }
    for (const p of arr) m.pushLog.push({ id: p.id, photo_path: p.photo_path === undefined ? null : p.photo_path, at: m.storageCalls ? m.storageCalls.length : 0 });
    return arr.map((p) => {
      if (typeof p.body === 'string' && [...p.body].length > 20000) throw new Error('body too long');
      if (!p.tz) throw new Error('tz required');
      if (!['note', 'journal'].includes(p.kind || 'note')) throw new Error('bad kind');
      const place = typeof p.place_name === 'string' ? p.place_name.trim() || null : null;
      if (place && [...place].length > 120) throw new Error('place_name longer than 120 characters');
      const ex = m.rows.get(p.id);
      if (!ex || Date.parse(ex.updated_at) < Date.parse(p.updated_at)) {
        const claude = p.photo_to_claude == null ? (ex ? ex.photo_to_claude !== false : true) : !!p.photo_to_claude;
        const shared = p.shared == null ? (ex ? ex.shared === true : false) : !!p.shared;
        // 0009: a row without place_name (an app from before M1.3) keeps the stored value.
        const place_name = 'place_name' in p ? place : (ex ? ex.place_name || null : null);
        const row = Object.assign({}, p, { owner: uid, photo_to_claude: claude, shared, place_name, server_ts: ts });
        m.rows.set(p.id, row);
        return { id: p.id, applied: true, server_ts: ts };
      }
      return { id: p.id, applied: false, server_ts: ex.server_ts };
    });
  };
  m.since = (ts, id, uid = UID) => {
    const key = (r) => r.server_ts + '|' + r.id;
    const cur = (ts || '') + '|' + (id || '');
    const rows = [...m.rows.values()].filter((r) => r.owner === uid && (!ts || key(r) > cur)).sort((a, b) => (key(a) < key(b) ? -1 : 1)).slice(0, 500);
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
  addStorage(m);
  m.authCalls = [];             // every /auth/v1 request
  m.passwords = { [UID]: 'gary-password-1', [ERIC_UID]: 'eric-password-1' };
  m.reauthRequired = false;     // true: PUT /auth/v1/user answers reauthentication_needed
  m.authOffline = false;        // true: PUT /auth/v1/user fails at the network
  m.partnerFail = false;        // true: tb_partner_captures answers 500
  // OpenStreetMap Nominatim (M1.3): every reverse request, the name it answers with (a function
  // of lat, lng, or a string; '' means nothing there), and a failure switch.
  // address (v13): a Nominatim address object, or a function of lat, lng returning one.
  m.osm = { calls: [], name: '', address: null, fail: null };   // fail: null | 'network' | 'http'
  return m;
}

// ---------- mock of Storage bucket tb-photos (migration 0006) ----------
function addStorage(m) {
  m.objects = new Map();        // path -> { bytes: Buffer, contentType }
  m.storageCalls = [];          // { method, path, status }
  m.uploadFail = null;          // null | 'network' | 'http'
  // supabase-js sends a Blob as multipart/form-data: the file is the part named "".
  m.filePart = (buf, ctype) => {
    const b = (/boundary=(.+)$/.exec(ctype || '') || [])[1];
    if (!b) return { bytes: buf, type: ctype };
    const sep = Buffer.from('--' + b);
    let i = buf.indexOf(sep);
    while (i >= 0) {
      const next = buf.indexOf(sep, i + sep.length);
      if (next < 0) break;
      const part = buf.subarray(i + sep.length + 2, next - 2);
      const h = part.indexOf('\r\n\r\n');
      const head = part.subarray(0, h).toString();
      if (/name=""/.test(head)) return { bytes: part.subarray(h + 4), type: (/Content-Type: (\S+)/i.exec(head) || [])[1] };
      i = next;
    }
    return { bytes: Buffer.alloc(0), type: null };
  };
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
  // Rows carry their owner internally; responses leave it out, as the SQL does ("- 'owner'").
  const pub = (r) => { const o = Object.assign({}, r); delete o.owner; return o; };
  const ownerOf = (r) => r.owner || UID;   // rows a test seeds directly carry no owner: Gary's
  m.turn = (p, uid = UID) => {
    if (!p.message_id || !p.local_date || !p.created_at) throw new Error('message_id, local_date and created_at are required');
    if (!String(p.content || '').trim()) throw new Error('content is empty');
    let u = m.jrows.get(p.message_id);
    if (u && (u.role !== 'user' || ownerOf(u) !== uid)) { const e = new Error('message belongs to another user or is not a user turn'); e.code = '42501'; throw e; }
    if (!u) {
      u = { id: p.message_id, owner: uid, local_date: p.local_date, role: 'user', content: p.content, reply_to: null, model: null,
        input_tokens: null, output_tokens: null, created_at: p.created_at, server_ts: m.serverTs() };
      m.jrows.set(u.id, u);
    }
    const reply = replyOf(u.id);
    if (reply) return { user: pub(u), reply: pub(reply) };
    const thread = m.jorder([...m.jrows.values()].filter((r) => ownerOf(r) === uid && r.local_date === u.local_date))
      .filter((r) => cmp(r, u) <= 0).map((r) => ({ id: r.id, role: r.role, content: r.content, created_at: r.created_at }));
    // Migration 0007: photo_path only where photo_to_claude is true (absent means true).
    // Migration 0008: own captures plus those visible from a live partner, with owner_name and own.
    const captures = [...m.rows.values()].filter((c) => c.local_date === u.local_date && !c.deleted_at && (c.owner === uid || m.visible(c, uid)))
      .sort((a, b) => (a.captured_at < b.captured_at ? -1 : 1))
      .map((c) => Object.assign(pub(c), { photo_path: c.photo_to_claude === false ? null : (c.photo_path || null),
        owner_name: (m.people.get(c.owner) || {}).name || null, own: c.owner === uid }));
    const me = m.people.get(uid);
    return { user: pub(u), reply: null, me: me ? { display_name: me.name, journal_prompt: me.prompt, journal_prompt_custom: me.custom || null } : null, thread, captures };
  };
  m.reply = (p, uid = UID) => {
    const parent = m.jrows.get(p.reply_to);
    if (!parent || parent.role !== 'user' || ownerOf(parent) !== uid) throw new Error('reply_to is not one of your user turns');
    const ex = replyOf(parent.id);
    if (ex) return { reply: pub(ex), inserted: false };
    const ts = m.serverTs();
    const r = { id: crypto.randomUUID(), owner: uid, local_date: parent.local_date, role: 'assistant', content: p.content,
      reply_to: parent.id, model: p.model, input_tokens: p.input_tokens, output_tokens: p.output_tokens,
      cache_write_tokens: p.cache_write_tokens == null ? null : p.cache_write_tokens,
      cache_read_tokens: p.cache_read_tokens == null ? null : p.cache_read_tokens,
      created_at: new Date().toISOString(), server_ts: ts };
    m.jrows.set(r.id, r);
    return { reply: pub(r), inserted: true };
  };
  // jdays is keyed by date for Gary (as before M1.2) and by '<uid>|<date>' for anyone else.
  const dkey = (uid, d) => (uid === UID ? d : uid + '|' + d);
  m.jday = (d, uid = UID) => ({ local_date: d, suffix: (m.jdays.get(dkey(uid, d)) || {}).suffix || '',
    messages: m.jorder([...m.jrows.values()].filter((r) => ownerOf(r) === uid && r.local_date === d)).map(pub) });
  m.jdayList = (limit, uid = UID) => {
    const mine = [...m.jrows.values()].filter((r) => ownerOf(r) === uid);
    const titled = [...m.jdays.keys()].filter((k) => (uid === UID ? !k.includes('|') : k.startsWith(uid + '|'))).map((k) => k.split('|').pop());
    const dates = new Set(mine.map((r) => r.local_date).concat(titled));
    return [...dates].sort().reverse().slice(0, limit || 400).map((d) => {
      const rows = mine.filter((r) => r.local_date === d);
      const t = m.jdays.get(dkey(uid, d));
      const ts = rows.map((r) => r.server_ts).concat(t ? [t.server_ts] : []).sort();
      return { local_date: d, messages: rows.length, last_server_ts: ts[ts.length - 1] || null, suffix: (t || {}).suffix || '' };
    });
  };
  m.jsuffix = (d, s, uid = UID) => {
    const suffix = String(s || '').trim();
    if (suffix.length > 200) throw new Error('suffix longer than 200 characters');
    const ts = m.serverTs();
    m.jdays.set(dkey(uid, d), { suffix, server_ts: ts });
    return { local_date: d, suffix, server_ts: ts };
  };
  // Simulated tb-journal: same request, responses and error shapes as index.ts.
  m.fn = async (body, uid = UID) => {
    m.fnCalls.push(body);
    if (m.fnDelayMs) await new Promise((r) => setTimeout(r, m.fnDelayMs));
    if (m.fnMode === 'hang') return new Promise(() => {});
    const turn = m.turn(body, uid);
    if (turn.reply) return [200, { user: turn.user, reply: turn.reply, cached: true }];
    if (m.fnMode === 'anthropic_auth') return [502, { error: 'anthropic_auth', message: 'Anthropic rejected TB_ANTHROPIC_API_KEY (401). Check the key in the travelboard workspace and the Edge Function secret.' }];
    if (m.fnMode === 'busy') return [503, { error: 'anthropic_busy', message: 'Claude is busy or the workspace limit is reached (529). Try again later.' }];
    if (m.fnMode === 'refusal') return [502, { error: 'refusal', message: 'Claude declined to answer this one. Rephrase and send again.' }];
    const c = await loadContext();
    const images = new Map();
    for (const id of c.photosToSend(turn.captures)) {
      const cp = turn.captures.find((x) => x.id === id);
      const o = m.objects.get(cp.photo_path);
      images.set(id, o ? o.bytes.toString('base64') : null);
    }
    const system = c.buildSystem(c.pickPrompt(turn.me.journal_prompt_custom, 'PROMPT ' + turn.me.journal_prompt));
    const contextBlocks = c.buildContext(turn.user.local_date, turn.captures, images, turn.me.display_name);
    const messages = c.buildMessages(turn.thread, contextBlocks);
    const context = contextBlocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    m.claude.push({ uid, system, messages, context, images: contextBlocks.filter((b) => b.type === 'image').length });
    const caps = turn.captures.map((x) => x.body.split('\n')[0]).join(' / ');
    const text = `Reply ${m.claude.length} to "${messages[messages.length - 1].content}"` + (caps ? `. Captures: ${caps}` : '');
    const stored = m.reply({ reply_to: body.message_id, content: text, model: 'claude-sonnet-5-5', input_tokens: 1000 + m.claude.length, output_tokens: 50 }, uid);
    return [200, { user: turn.user, reply: stored.reply, cached: !stored.inserted }];
  };
}

// phone (optional, M1.2): { offline } for this browser context alone, so one phone can be in
// airplane mode while the other syncs. m.offline still takes every phone off the network.
async function attachMock(ctx, m, phone) {
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
  // No suite ever reaches the real Nominatim (SPEC.md 7C.4).
  await ctx.route('https://nominatim.openstreetmap.org/**', async (route) => {
    const u = new URL(route.request().url());
    m.osm.calls.push({ path: u.pathname, q: Object.fromEntries(u.searchParams), at: Date.now(), phone: phone ? phone.name || null : null });
    if (m.offline || (phone && phone.offline) || m.osm.fail === 'network') return route.abort('internetdisconnected');
    if (m.osm.fail === 'http') return route.fulfill({ status: 503, headers: cors, body: 'busy' });
    const lat = Number(u.searchParams.get('lat')), lng = Number(u.searchParams.get('lon'));
    const name = typeof m.osm.name === 'function' ? m.osm.name(lat, lng) : m.osm.name;
    const address = (typeof m.osm.address === 'function' ? m.osm.address(lat, lng) : m.osm.address) || { city: 'Singapore', country: 'Singapore', country_code: 'sg' };
    return route.fulfill({ status: 200, headers: Object.assign({ 'content-type': 'application/json' }, cors),
      body: JSON.stringify({ place_id: 1, lat: String(lat), lon: String(lng), category: 'shop', type: 'mall', name: name || '', display_name: (name ? name + ', ' : '') + 'Singapore', address }) });
  });
  await ctx.route(SUPA + '/**', async (route) => {
    const req = route.request();
    if (m.offline || (phone && phone.offline)) return route.abort('internetdisconnected');
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const u = new URL(req.url());
    if (u.pathname === '/auth/v1/health') return route.fulfill({ status: 200, headers: cors, body: '{}' });
    const json = (status, obj) => route.fulfill({ status, headers: Object.assign({ 'content-type': 'application/json' }, cors), body: JSON.stringify(obj) });
    // GoTrue (M1.2 Change password): password sign-in, logout, password change.
    if (u.pathname.startsWith('/auth/v1/')) {
      const body = req.postDataJSON ? (() => { try { return req.postDataJSON(); } catch (e) { return null; } })() : null;
      m.authCalls.push({ method: req.method(), path: u.pathname, body });
      if (u.pathname === '/auth/v1/token' && u.searchParams.get('grant_type') === 'password') {
        const uid = Object.keys(EMAIL).find((k) => EMAIL[k] === (body && body.email));
        if (!uid || m.passwords[uid] !== body.password) return json(400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
        return json(200, JSON.parse(sessionJson(uid)));
      }
      if (u.pathname === '/auth/v1/logout') return route.fulfill({ status: 204, headers: cors });
      if (u.pathname === '/auth/v1/user') {
        const uid = callerOf(req);
        if (!uid) return json(401, { code: 401, error_code: 'no_authorization', msg: 'This endpoint requires a valid Bearer token' });
        if (req.method() === 'PUT') {
          if (m.authOffline) return route.abort('internetdisconnected');
          if (m.reauthRequired) return json(400, { code: 400, error_code: 'reauthentication_needed', msg: 'Password update requires reauthentication' });
          if (body && body.password != null) {
            if (body.password === m.passwords[uid]) return json(422, { code: 422, error_code: 'same_password', msg: 'New password should be different from the old password.' });
            m.passwords[uid] = body.password;
          }
        }
        return json(200, JSON.parse(sessionJson(uid)).user);
      }
      return json(404, { msg: 'auth path not mocked: ' + u.pathname });
    }
    if (m.unauth) return json(401, { code: 'PGRST301', message: 'JWT expired' });
    const caller = callerOf(req) || UID;
    const st = /^\/storage\/v1\/object\/tb-photos\/(.+)$/.exec(u.pathname);
    if (st) {
      const p = decodeURIComponent(st[1]);
      const auth = req.headers()['authorization'] || '';
      const own = /^Bearer eyJ/.test(auth) && p.split('/')[0] === caller;
      const readable = /^Bearer eyJ/.test(auth) && m.canRead(p, caller);
      const done = (status, obj) => { m.storageCalls.push({ method: req.method(), path: p, status }); return json(status, obj); };
      if (req.method() === 'POST' || req.method() === 'PUT') {
        if (m.uploadFail === 'network') { m.storageCalls.push({ method: req.method(), path: p, status: 0 }); return route.abort('internetdisconnected'); }
        if (m.uploadFail === 'http') return done(500, { statusCode: '500', error: 'Internal', message: 'storage down' });
        if (!own) return done(403, { statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' });
        const f = m.filePart(req.postDataBuffer() || Buffer.alloc(0), req.headers()['content-type']);
        if (f.bytes.length > 2 * 1024 * 1024) return done(413, { statusCode: '413', error: 'Payload too large', message: 'The object exceeded the maximum allowed size' });
        if (f.type !== 'image/jpeg') return done(415, { statusCode: '415', error: 'invalid_mime_type', message: 'mime type ' + f.type + ' is not supported' });
        if (m.objects.has(p) && req.headers()['x-upsert'] !== 'true') return done(409, { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' });
        m.objects.set(p, { bytes: Buffer.from(f.bytes), contentType: f.type });
        return done(200, { Key: 'tb-photos/' + p, Id: p });
      }
      if (req.method() === 'GET') {
        const o = m.objects.get(p);
        if (!readable || !o) return done(400, { statusCode: '404', error: 'not_found', message: 'Object not found' });
        m.storageCalls.push({ method: 'GET', path: p, status: 200 });
        return route.fulfill({ status: 200, headers: Object.assign({ 'content-type': 'image/jpeg' }, cors), body: o.bytes });
      }
      return done(405, { message: 'method' });
    }
    const body = req.postDataJSON ? req.postDataJSON() : null;
    m.calls.push(u.pathname);
    if (u.pathname === '/functions/v1/tb-journal') {
      if (!/^Bearer eyJ/.test(req.headers()['authorization'] || '')) return json(401, { code: 401, message: 'Invalid JWT' });
      try {
        const [status, out] = await m.fn(body, caller);
        // Lost response: the function finished (reply stored) but the phone never heard back.
        if (m.fnDropResponse) { m.fnDropResponse = false; return route.abort('failed'); }
        return json(status, out);
      } catch (e) { return json(400, { error: 'bad_request', message: e.message }); }
    }
    try {
      if (u.pathname === '/rest/v1/rpc/tb_journal_days') return json(200, m.jdayList(body.p_limit, caller));
      if (u.pathname === '/rest/v1/rpc/tb_journal_day') return json(200, m.jday(body.p_local_date, caller));
      if (u.pathname === '/rest/v1/rpc/tb_journal_day_suffix') return json(200, m.jsuffix(body.p_local_date, body.p_suffix, caller));
      if (u.pathname === '/rest/v1/rpc/tb_captures_upsert') return json(200, m.upsertBatch(body.p, caller));
      if (u.pathname === '/rest/v1/rpc/tb_captures_since') return json(200, m.since(body.p_since_ts, body.p_since_id, caller));
      if (u.pathname === '/rest/v1/rpc/tb_whoami') return json(200, m.whoami(caller));
      if (u.pathname === '/rest/v1/rpc/tb_partner_captures') {
        if (m.partnerFail) return json(500, { code: 'XX000', message: 'partner pull failed' });
        return json(200, m.partnerCaptures(caller));
      }
      if (u.pathname === '/rest/v1/rpc/tb_partner_add') return json(200, m.partnerAdd(body.p_uid, caller));
      if (u.pathname === '/rest/v1/rpc/tb_partner_remove') return json(200, m.partnerRemove(body.p_uid, caller));
      if (u.pathname === '/rest/v1/rpc/tb_prompt_get') return json(200, m.promptGet(caller));
      if (u.pathname === '/rest/v1/rpc/tb_prompt_set') return json(200, m.promptSet(body.p_text, caller));
    } catch (e) { return json(e.code === '42501' ? 403 : 400, { code: e.code || '22023', message: e.message }); }
    return json(404, { message: 'not mocked: ' + u.pathname });
  });
}

function b64u(o) { return Buffer.from(JSON.stringify(o)).toString('base64url'); }
function sessionJson(uid = UID) {
  const exp = 4102444800;
  const email = EMAIL[uid];
  const jwt = b64u({ alg: 'HS256', typ: 'JWT' }) + '.' + b64u({ sub: uid, role: 'authenticated', exp, aud: 'authenticated', email }) + '.sig';
  return JSON.stringify({ access_token: jwt, token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: 'refresh-fake',
    user: { id: uid, aud: 'authenticated', role: 'authenticated', email, app_metadata: {}, user_metadata: {}, created_at: '2026-10-04T00:00:00Z' } });
}
// The caller's uid from the request's Bearer JWT (sub), or null.
function callerOf(req) {
  const t = /^Bearer (eyJ[^.]*)\.([^.]+)\./.exec(req.headers()['authorization'] || '');
  if (!t) return null;
  try { return JSON.parse(Buffer.from(t[2], 'base64url').toString('utf8')).sub || null; } catch (e) { return null; }
}

// Geolocation stub so the test controls timing: mode deny | grant | hold; fix { lat, lng } moves it.
const GEO_INIT = `
  window.__geo = { mode: 'deny', pending: [], calls: 0, lastOpts: null };
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
    getCurrentPosition(ok, err, opts) {
      const g = window.__geo; g.calls++; g.lastOpts = opts;
      // g.fix (M1.3) moves the phone; read when the fix is delivered, so a held one gets the latest.
      const fix = () => { const at = g.fix || { lat: 13.7466, lng: 100.5393 }; return { coords: { latitude: at.lat, longitude: at.lng, accuracy: 12.5 }, timestamp: Date.now() }; };
      if (g.mode === 'deny') setTimeout(() => err && err({ code: 1, message: 'User denied Geolocation' }), 10);
      else if (g.mode === 'hold') g.pending.push(() => ok(fix()));
      else setTimeout(() => ok(fix()), 10);
    },
    watchPosition() { return 0; }, clearWatch() {}
  }});
`;

async function newContext(browser, { tz, session, swBlock = true, uid = UID }) {
  const ctx = await browser.newContext({ timezoneId: tz, locale: 'en-GB', serviceWorkers: swBlock ? 'block' : 'allow', viewport: { width: 412, height: 860 }, acceptDownloads: true });
  await ctx.addInitScript(GEO_INIT);
  if (session) await ctx.addInitScript(`try { if (!localStorage.getItem('tb-auth')) localStorage.setItem('tb-auth', ${JSON.stringify(sessionJson(uid))}); } catch (e) {}`);
  return ctx;
}

// Waits until fn(arg), evaluated in the page, gives a truthy value; throws after timeout ms, like
// page.waitForFunction. Use it for any condition that needs a Promise (IndexedDB): Playwright 1.56's
// waitForFunction does not await a returned Promise, which is truthy, so such a wait returned at
// once (found 24/10/26, M1.3 session B).
async function until(page, fn, arg, { timeout = 5000, every = 50 } = {}) {
  const end = Date.now() + timeout;
  for (;;) {
    if (await page.evaluate(fn, arg)) return true;
    if (Date.now() > end) throw new Error('until: timed out after ' + timeout + ' ms');
    await new Promise((r) => setTimeout(r, every));
  }
}

// TB_CHROMIUM=/path/to/chrome runs against an installed Chromium instead of Playwright's own.
const launch = () => chromium.launch(process.env.TB_CHROMIUM ? { executablePath: process.env.TB_CHROMIUM } : {});

module.exports = { until, chromium, launch, startServer, makeMock, attachMock, newContext, sessionJson, loadContext, SUPA, UID, ERIC_UID, ROOT };
