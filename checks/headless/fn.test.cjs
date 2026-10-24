// travelboard tb-journal function test (TESTS.md, M2). Dev only. Run from the repo root:
//   node checks/headless/fn.test.cjs
// Runs the real supabase/functions/tb-journal/index.ts under Deno against local fakes:
// PostgREST (the journal mock in harness.cjs, which mirrors migration 0004) and the
// Anthropic Messages API (records every request). Needs deno on PATH or DENO=/path/to/deno.
// Checks the request it sends to Claude, idempotent retries, error mapping and the 40-turn cap;
// from M1.1 (SPEC.md 7A.4) also a fake of Storage: the day's photos as labelled images (most
// recent 20, the rest listed), a failed download listed, the cache breakpoint, cache counts.
// From M1.2 (SPEC.md 7B.4, 7B.5 item 10), G1 to G7: Eric's calls (his own JWT): his prompt
// (prompts/journal-eric.md), Gary's captures only when linked and shared, labelled by name,
// an unshared one absent from the whole request, the photos combined to 30, unknown prompt.
// From M1.3 (SPEC.md 7C.2a, 7C.4, 7C.5, 7C.7 items 6 and 7), H1 to H6: no kind label anywhere;
// each capture labelled with its place name when set, coordinates otherwise; the caller's own
// custom prompt when set, the bundled file otherwise, and the captures always in the context.
'use strict';
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { makeMock, ROOT, UID, ERIC_UID } = require('./harness.cjs');

const FAKE = 8742, FN = 8000;   // Deno.serve listens on 8000 by default
const DENO = process.env.DENO || 'deno';
const JWT = 'Bearer eyJ.fake.jwt';            // Gary
const ERIC_JWT = 'Bearer eyJ.eric.jwt';       // Eric (M1.2)
const uidOf = (auth) => (auth === JWT ? UID : auth === ERIC_JWT ? ERIC_UID : null);
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail && !ok ? '  [' + detail + ']' : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const m = makeMock();
const anth = { mode: 'ok', calls: [], prefixes: new Set() };
// Prompt cache, roughly: a request whose context block (everything up to the breakpoint) was
// seen before reads it from cache; a new one writes it.
const cacheUsage = (body) => {
  const first = body.messages[0];
  if (!Array.isArray(first.content)) return { cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
  const key = JSON.stringify([body.system, first.content.slice(0, -1)]);
  const hit = anth.prefixes.has(key);
  anth.prefixes.add(key);
  return hit ? { cache_creation_input_tokens: 0, cache_read_input_tokens: 3000 } : { cache_creation_input_tokens: 3000, cache_read_input_tokens: 0 };
};
const storageGets = [];
function fake(req, res) {
  let data = '';
  req.on('data', (c) => { data += c; });
  req.on('end', () => {
    const body = data ? JSON.parse(data) : null;
    const send = (status, obj) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (req.url === '/v1/messages') {
      anth.calls.push({ headers: req.headers, body });
      if (anth.mode === '401') return send(401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } });
      const refusal = anth.mode === 'refusal';
      return send(200, { id: 'msg_' + anth.calls.length, type: 'message', role: 'assistant', model: 'claude-sonnet-5-5',
        content: refusal ? [] : [{ type: 'text', text: 'Reply ' + anth.calls.length + ' about the omelette.' }],
        stop_reason: refusal ? 'refusal' : 'end_turn', stop_sequence: null,
        usage: Object.assign({ input_tokens: 1200 + anth.calls.length, output_tokens: 40 }, cacheUsage(body)) });
    }
    const st = /^\/storage\/v1\/object\/tb-photos\/(.+)$/.exec(req.url);
    if (st && req.method === 'GET') {
      storageGets.push({ path: decodeURIComponent(st[1]), auth: req.headers.authorization, apikey: req.headers.apikey });
      const o = m.objects.get(decodeURIComponent(st[1]));
      const who = uidOf(req.headers.authorization);
      if (!who || !o || !m.canRead(decodeURIComponent(st[1]), who)) return send(400, { statusCode: '404', error: 'not_found', message: 'Object not found' });
      res.writeHead(200, { 'content-type': 'image/jpeg' });
      return res.end(o.bytes);
    }
    if (req.url.startsWith('/rest/v1/rpc/')) {
      const who = uidOf(req.headers.authorization);
      if (!who) return send(401, { code: 'PGRST301', message: 'JWT expired' });
      if (req.headers.apikey !== 'pk_test') return send(401, { message: 'bad apikey' });
      try {
        if (req.url.endsWith('/tb_journal_turn')) return send(200, m.turn(body.p, who));
        if (req.url.endsWith('/tb_journal_reply')) return send(200, m.reply(body.p, who));
      } catch (e) { return send(400, { code: '22023', message: e.message }); }
    }
    send(404, { message: 'not faked: ' + req.url });
  });
}

async function call(body, headers = {}) {
  const r = await fetch(`http://127.0.0.1:${FN}/`, { method: 'POST',
    headers: Object.assign({ Authorization: JWT, apikey: 'pk_test', 'Content-Type': 'application/json' }, headers),
    body: typeof body === 'string' ? body : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null), headers: r.headers };
}
const turn = (id, content, created_at, local_date = '2026-11-09') => ({ message_id: id, local_date, content, created_at });
const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

(async () => {
  const srv = http.createServer(fake);
  await new Promise((r) => srv.listen(FAKE, '127.0.0.1', r));
  // Captures on the test day: two live, one deleted, one on another day.
  m.upsertBatch([
    { id: uid(901), body: 'Jay Fai crab omelette, queue 40 min', kind: 'note', captured_at: '2026-11-09T11:30:00Z', tz: 'Asia/Bangkok', local_date: '2026-11-09', lat: 13.7524, lng: 100.5045, accuracy_m: 9, updated_at: '2026-11-09T11:30:00Z' },
    { id: uid(902), body: 'Wat Pho at 0900, reclining Buddha', kind: 'journal', captured_at: '2026-11-09T02:00:00Z', tz: 'Asia/Bangkok', local_date: '2026-11-09', updated_at: '2026-11-09T02:00:00Z' },
    { id: uid(903), body: 'DELETED NOTE', kind: 'note', captured_at: '2026-11-09T03:00:00Z', tz: 'Asia/Bangkok', local_date: '2026-11-09', updated_at: '2026-11-09T03:00:00Z', deleted_at: '2026-11-09T03:00:00Z' },
    { id: uid(904), body: 'OTHER DAY', kind: 'note', captured_at: '2026-11-08T03:00:00Z', tz: 'Asia/Bangkok', local_date: '2026-11-08', updated_at: '2026-11-08T03:00:00Z' }
  ]);

  const fn = spawn(DENO, ['run', '--allow-net', '--allow-env', '--allow-read', '--no-lock', '--quiet',
    path.join(ROOT, 'supabase/functions/tb-journal/index.ts')], {
    env: Object.assign({}, process.env, { PORT: String(FN), SUPABASE_URL: `http://127.0.0.1:${FAKE}`,
      SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: 'pk_test' }), TB_ANTHROPIC_API_KEY: 'sk-test-key',
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${FAKE}` }),
    stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  fn.stdout.on('data', (d) => { log += d; });
  fn.stderr.on('data', (d) => { log += d; });
  for (let i = 0; i < 300; i++) {
    try { await fetch(`http://127.0.0.1:${FN}/`, { method: 'OPTIONS' }); break; } catch (e) { await sleep(200); }
  }

  try {
    let r = await fetch(`http://127.0.0.1:${FN}/`, { method: 'OPTIONS' });
    check('F1 OPTIONS: 204 with CORS for authorization and apikey', r.status === 204
      && r.headers.get('access-control-allow-origin') === '*' && /authorization/.test(r.headers.get('access-control-allow-headers')) && /apikey/.test(r.headers.get('access-control-allow-headers')));
    r = await call(turn(uid(1), 'hi', '2026-11-09T14:00:00Z'), { Authorization: '' });
    check('F2 no Authorization: 401 auth', r.status === 401 && r.body.error === 'auth', JSON.stringify(r.body));
    r = await call('not json');
    check('F3 body not JSON: 400', r.status === 400 && r.body.error === 'bad_request');
    r = await call({ message_id: 'x', local_date: '2026-11-09', content: 'hi', created_at: '2026-11-09T14:00:00Z' });
    check('F3 bad message_id: 400', r.status === 400);
    r = await call(turn(uid(1), '   ', '2026-11-09T14:00:00Z'));
    check('F3 empty content: 400', r.status === 400);
    check('F3 no Claude call for bad requests', anth.calls.length === 0);

    // F4 first turn
    r = await call(turn(uid(1), 'Long day. The omelette was worth the wait.', '2026-11-09T14:00:00Z'));
    check('F4 first turn: 200, reply stored, cached false', r.status === 200 && r.body.reply && r.body.reply.reply_to === uid(1)
      && r.body.reply.content === 'Reply 1 about the omelette.' && r.body.cached === false, JSON.stringify(r.body));
    const c1 = anth.calls[0];
    check('F4 Claude called once, with the key from TB_ANTHROPIC_API_KEY', anth.calls.length === 1 && c1.headers['x-api-key'] === 'sk-test-key');
    check('F4 model claude-sonnet-5-5, max_tokens 1500', c1.body.model === 'claude-sonnet-5-5' && c1.body.max_tokens === 1500, JSON.stringify([c1.body.model, c1.body.max_tokens]));
    check('F4 thinking between_tools, effort low', c1.body.thinking && c1.body.thinking.type === 'between_tools' && c1.body.output_config && c1.body.output_config.effort === 'low');
    const sys = String(c1.body.system);
    check('F4 system is prompts/journal.md, nothing day-specific', sys === require('fs').readFileSync(path.join(ROOT, 'prompts/journal.md'), 'utf8').trim());
    const first = c1.body.messages[0];
    const ctx = Array.isArray(first.content) ? first.content.filter((b) => b.type === 'text').slice(0, -1).map((b) => b.text).join('\n') : '';
    check('F4 context block lists the day and both live captures with Bangkok local times', ctx.includes('Mon 09/11/26')
      && ctx.includes('Jay Fai crab omelette') && ctx.includes('1830 hrs Bangkok time') && ctx.includes('Wat Pho') && ctx.includes('0900 hrs Bangkok time')
      && ctx.indexOf('Wat Pho') < ctx.indexOf('Jay Fai') && ctx.includes('13.75240, 100.50450 (within 9 m)'), ctx.slice(0, 300));
    check('F4 context leaves out deleted captures and other days', !ctx.includes('DELETED NOTE') && !ctx.includes('OTHER DAY'));
    check('F4 messages: one user turn, the context first, then the content', c1.body.messages.length === 1 && first.role === 'user'
      && first.content[first.content.length - 1].type === 'text' && first.content[first.content.length - 1].text === 'Long day. The omelette was worth the wait.'
      && !!first.content[first.content.length - 2].cache_control);
    check('F4 no photos on this day: no image blocks, no Storage call', !first.content.some((b) => b.type === 'image') && storageGets.length === 0);
    const row = [...m.jrows.values()].find((x) => x.reply_to === uid(1));
    check('F4 reply row: model, token and cache counts stored', row && row.model === 'claude-sonnet-5-5' && row.input_tokens === 1201 && row.output_tokens === 40
      && row.cache_write_tokens === 3000 && row.cache_read_tokens === 0, JSON.stringify(row));

    // F5 retry returns the stored reply, no API call (acceptance 3)
    r = await call(turn(uid(1), 'Long day. The omelette was worth the wait.', '2026-11-09T14:00:00Z'));
    check('F5 retry: 200, same reply, cached true, no second Claude call', r.status === 200 && r.body.cached === true
      && r.body.reply.id === row.id && anth.calls.length === 1);

    // F6 second turn: thread carries turn 1 and reply 1
    r = await call(turn(uid(2), 'And Wat Pho this morning.', '2026-11-09T14:05:00Z'));
    const c2 = anth.calls[1];
    check('F6 second turn: thread user, assistant, user', r.status === 200 && c2.body.messages.length === 3
      && c2.body.messages.map((x) => x.role).join() === 'user,assistant,user' && c2.body.messages[1].content === 'Reply 1 about the omelette.');
    const row2 = [...m.jrows.values()].find((x) => x.reply_to === uid(2));
    check('F6 second turn reads the context from cache (cache_read_tokens stored)', row2 && row2.cache_read_tokens === 3000 && row2.cache_write_tokens === 0, JSON.stringify(row2));

    // F7 Anthropic 401: clear error, turn kept, no reply
    anth.mode = '401';
    r = await call(turn(uid(3), 'Testing a bad key.', '2026-11-09T14:10:00Z'));
    check('F7 Anthropic 401: 502 anthropic_auth with a clear message', r.status === 502 && r.body.error === 'anthropic_auth'
      && /TB_ANTHROPIC_API_KEY \(401\)/.test(r.body.message), JSON.stringify(r.body));
    check('F7 user turn stored, no reply stored', m.jrows.has(uid(3)) && ![...m.jrows.values()].some((x) => x.reply_to === uid(3)));
    check('F7 SDK retried a 401 at most once', anth.calls.length <= 4, anth.calls.length);

    // F8 refusal
    anth.mode = 'refusal';
    r = await call(turn(uid(4), 'Another.', '2026-11-09T14:15:00Z'));
    check('F8 refusal: 502 refusal, nothing stored', r.status === 502 && r.body.error === 'refusal' && ![...m.jrows.values()].some((x) => x.reply_to === uid(4)));

    // F9 the failed turns joined into one user message when the next turn goes through
    anth.mode = 'ok';
    const before = anth.calls.length;
    r = await call(turn(uid(5), 'Now it works.', '2026-11-09T14:20:00Z'));
    const c5 = anth.calls[before];
    check('F9 after two failed turns: roles alternate, failed turns joined', r.status === 200
      && c5.body.messages.map((x) => x.role).join() === 'user,assistant,user,assistant,user'
      && c5.body.messages[4].content === 'Testing a bad key.\n\nAnother.\n\nNow it works.', JSON.stringify(c5 && c5.body.messages.map((x) => x.content)));

    // F10 40-turn cap
    for (let i = 0; i < 25; i++) {
      const id = uid(100 + i);
      m.turn(turn(id, 'u' + i, `2026-11-10T0${Math.floor(i / 10)}:${String(i % 10).padStart(2, '0')}:00Z`, '2026-11-10'));
      m.reply({ reply_to: id, content: 'a' + i, model: 'x', input_tokens: 1, output_tokens: 1 });
    }
    const n0 = anth.calls.length;
    r = await call(turn(uid(200), 'last', '2026-11-10T09:00:00Z', '2026-11-10'));
    const cap = anth.calls[n0].body.messages;
    check('F10 51-message thread capped to 40, starts with a user turn, ends with "last"', cap.length <= 40 && cap.length >= 39
      && cap[0].role === 'user' && cap[cap.length - 1].content === 'last', cap.length);

    // F13 photos (SPEC.md 7A.4, 7A.6 item 11): on 11/11, 31 switched-on photos, 2 switched-off
    // photos and 1 capture without a photo. The most recent 30 switched-on photos go in as
    // images, the oldest switched-on one is listed as not shown, the switched-off ones are not
    // fetched, sent, listed or mentioned.
    const P = '11111111-2222-4333-8444-555555555555';
    const day = [];
    const OFF = new Set([10, 20]), NOPHOTO = 5;
    for (let i = 0; i < 34; i++) {
      const id = uid(500 + i);
      const withPhoto = i !== NOPHOTO;
      day.push({ id, body: i === 7 ? '' : `Stop ${i}` + (OFF.has(i) ? ' private' : ''), kind: i % 4 === 0 ? 'journal' : 'note', tz: 'Asia/Bangkok', local_date: '2026-11-11',
        captured_at: `2026-11-11T${String(1 + Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}:00Z`,
        updated_at: '2026-11-11T12:00:00Z', photo_path: withPhoto ? `${P}/${id}.jpg` : null, photo_to_claude: !OFF.has(i) });
      if (withPhoto) m.objects.set(`${P}/${id}.jpg`, { bytes: Buffer.from('JPEG-' + i), contentType: 'image/jpeg' });
    }
    m.upsertBatch(day);
    const g0 = storageGets.length, n13 = anth.calls.length;
    r = await call(turn(uid(300), 'What did you see in the photos?', '2026-11-11T14:00:00Z', '2026-11-11'));
    const c13 = anth.calls[n13] && anth.calls[n13].body;
    const blocks = c13 ? c13.messages[0].content : [];
    const imgs = blocks.filter((b) => b.type === 'image');
    const ctx13 = blocks[0] && blocks[0].text || '';
    const all13 = JSON.stringify(c13 || {});
    const gets13 = storageGets.slice(g0).map((g) => g.path);
    check('F13 200 and a reply', r.status === 200 && !!r.body.reply, JSON.stringify(r.body));
    check('F13 31 switched-on photos: the 30 most recent fetched as the user, the oldest not fetched', gets13.length === 30
      && storageGets.slice(g0).every((g) => g.auth === JWT && g.apikey === 'pk_test') && !gets13.some((x) => x.endsWith(uid(500) + '.jpg')), gets13.length);
    check('F13 30 images, JPEG base64 of the stored bytes, oldest first', imgs.length === 30
      && imgs.every((b) => b.source.type === 'base64' && b.source.media_type === 'image/jpeg')
      && imgs[0].source.data === Buffer.from('JPEG-1').toString('base64') && imgs[29].source.data === Buffer.from('JPEG-33').toString('base64'), imgs.length);
    // M1.3 (7C.2a): the label no longer carries the kind, though a quarter of these rows are journal-kind.
    const labelOk = blocks.every((b, i) => b.type !== 'image' || (blocks[i - 1].type === 'text' && /^Photo from capture \d+, \d{4} hrs Bangkok time: /.test(blocks[i - 1].text)));
    check('F13 each image follows a label with its capture\'s time and text, no kind', labelOk
      && blocks.some((b) => b.type === 'text' && b.text.includes('Stop 33')) && blocks.some((b) => b.type === 'text' && / time: \(no text\)$/.test(b.text))
      && !blocks.some((b) => b.type === 'text' && /(note|journal): /.test(b.text)));
    check('F13 the oldest switched-on photo listed as not shown, nothing listed as could not be loaded',
      (ctx13.match(/, not shown"/g) || []).length === 1 && ctx13.includes('photo="photo at 0800 hrs Bangkok, not shown"') && !/could not be loaded/.test(ctx13), ctx13.slice(0, 300));
    const offTag = (i) => (ctx13.match(new RegExp(`<capture n="${i + 1}"[^>]*>`)) || [''])[0];
    check('F13 switched-off photos (item 11): not fetched, not sent, not listed, no photo attribute; their capture text still there',
      !gets13.some((x) => x.endsWith(uid(510) + '.jpg') || x.endsWith(uid(520) + '.jpg'))
      && !all13.includes(Buffer.from('JPEG-10').toString('base64')) && !all13.includes(Buffer.from('JPEG-20').toString('base64'))
      && !/photo=/.test(offTag(10)) && !/photo=/.test(offTag(20)) && offTag(10) !== '' && ctx13.includes('Stop 10 private')
      && !blocks.some((b) => b.type === 'text' && /^Photo from capture (11|21),/.test(b.text)), offTag(10));
    const last = blocks[blocks.length - 2];
    check('F13 cache breakpoint (1 h) on the last context block, the last image; nothing after it but the turn', !!last && last.type === 'image'
      && JSON.stringify(last.cache_control) === JSON.stringify({ type: 'ephemeral', ttl: '1h' })
      && blocks.filter((b) => b.cache_control).length === 1 && blocks[blocks.length - 1].text === 'What did you see in the photos?');
    const row13 = [...m.jrows.values()].find((x) => x.reply_to === uid(300));
    check('F13 reply stored with cache_write_tokens', row13 && row13.cache_write_tokens === 3000);
    r = await call(turn(uid(301), 'And the last one?', '2026-11-11T14:05:00Z', '2026-11-11'));
    const c14 = anth.calls[anth.calls.length - 1].body;
    const row14 = [...m.jrows.values()].find((x) => x.reply_to === uid(301));
    check('F14 second turn that evening: same context block byte for byte, cache_read_tokens above zero (acceptance 7)',
      JSON.stringify(c14.messages[0].content.slice(0, -1)) === JSON.stringify(blocks.slice(0, -1)) && row14 && row14.cache_read_tokens > 0);

    // F15 a photo whose file cannot be downloaded: listed as could not be loaded, the call goes ahead.
    m.upsertBatch([0, 1].map((i) => ({ id: uid(600 + i), body: `Missing ${i}`, kind: 'note', tz: 'Asia/Bangkok', local_date: '2026-11-12',
      captured_at: `2026-11-12T0${2 + i}:00:00Z`, updated_at: '2026-11-12T12:00:00Z', photo_path: `${P}/${uid(600 + i)}.jpg` })));
    m.objects.set(`${P}/${uid(600)}.jpg`, { bytes: Buffer.from('JPEG-OK'), contentType: 'image/jpeg' });
    const n15 = anth.calls.length;
    r = await call(turn(uid(302), 'Photos today?', '2026-11-12T14:00:00Z', '2026-11-12'));
    const b15 = anth.calls[n15] ? anth.calls[n15].body.messages[0].content : [];
    check('F15 a photo that fails to download is listed as could not be loaded; the other is sent; reply stored', r.status === 200
      && b15.filter((b) => b.type === 'image').length === 1 && (b15[0].text.match(/could not be loaded/g) || []).length === 1);

    // ---------- M1.2 (SPEC.md 7B.4, 7B.5 item 10) ----------
    const E = { Authorization: ERIC_JWT };
    const G = UID, EU = ERIC_UID;
    const fs = require('fs');
    // Gary's day 2026-11-13: shared with a photo, unshared with a photo, shared with the photo off for Claude.
    m.upsertBatch([
      { id: uid(701), body: 'Gary shared: Chatuchak stall 12, mango sticky rice', kind: 'note', tz: 'Asia/Bangkok', local_date: '2026-11-13',
        captured_at: '2026-11-13T03:00:00Z', updated_at: '2026-11-13T03:00:00Z', shared: true, photo_path: `${G}/${uid(701)}.jpg` },
      { id: uid(702), body: 'GARY PRIVATE NOTE', kind: 'note', tz: 'Asia/Bangkok', local_date: '2026-11-13',
        captured_at: '2026-11-13T04:00:00Z', updated_at: '2026-11-13T04:00:00Z', shared: false, photo_path: `${G}/${uid(702)}.jpg` },
      { id: uid(703), body: 'Gary shared, photo not for Claude', kind: 'journal', tz: 'Asia/Bangkok', local_date: '2026-11-13',
        captured_at: '2026-11-13T05:00:00Z', updated_at: '2026-11-13T05:00:00Z', shared: true, photo_path: `${G}/${uid(703)}.jpg`, photo_to_claude: false }
    ], G);
    for (const n of [701, 702, 703]) m.objects.set(`${G}/${uid(n)}.jpg`, { bytes: Buffer.from('GARY-' + n), contentType: 'image/jpeg' });
    m.upsertBatch([{ id: uid(711), body: 'Eric: boat to Wat Arun', kind: 'note', tz: 'Asia/Bangkok', local_date: '2026-11-13',
      captured_at: '2026-11-13T06:00:00Z', updated_at: '2026-11-13T06:00:00Z' }], EU);

    // G1 not linked: Eric's call has his prompt and only his own capture
    let nG = anth.calls.length, gG = storageGets.length;
    r = await call(turn(uid(801), 'Long day on the river.', '2026-11-13T14:00:00Z', '2026-11-13'), E);
    let cG = anth.calls[nG] && anth.calls[nG].body;
    let allG = JSON.stringify(cG || {});
    check('G1 Eric: 200, system is prompts/journal-eric.md', r.status === 200 && !!cG
      && String(cG.system) === fs.readFileSync(path.join(ROOT, 'prompts/journal-eric.md'), 'utf8').trim() && !String(cG.system).includes('Gary'), JSON.stringify(r.body));
    check('G1 not linked: only Eric\'s capture, introduced as Eric\'s; nothing of Gary\'s fetched or sent',
      allG.includes('Eric: boat to Wat Arun') && allG.includes("Eric's captures for this day") && !allG.includes('Gary shared')
      && !allG.includes('GARY PRIVATE NOTE') && storageGets.length === gG, cG && cG.messages[0].content[0].text.slice(0, 400));
    const rowG1 = [...m.jrows.values()].find((x) => x.reply_to === uid(801));
    check('G1 Eric\'s reply is stored as Eric\'s', !!rowG1 && rowG1.owner === EU);

    // G2 linked: Gary's shared captures appear labelled, the unshared one is absent from the request
    m.partnerAdd(EU, G); m.partnerAdd(G, EU);
    nG = anth.calls.length; gG = storageGets.length;
    r = await call(turn(uid(802), 'Did Gary find the mango place?', '2026-11-13T14:10:00Z', '2026-11-13'), E);
    cG = anth.calls[nG] && anth.calls[nG].body;
    allG = JSON.stringify(cG || {});
    const bG = cG ? cG.messages[0].content : [];
    const ctxG = bG[0] && bG[0].text || '';
    check('G2 linked: Gary\'s 2 shared captures and Eric\'s own, each with by=; intro names both', r.status === 200
      && /<capture n="1" time="1000 hrs Bangkok time" by="Gary"/.test(ctxG) && ctxG.includes('Chatuchak stall 12')
      && /by="Gary">\nGary shared, photo not for Claude/.test(ctxG) && /by="Eric">/.test(ctxG)
      && ctxG.includes("Eric's own, and those Gary shared with Eric"), ctxG.slice(0, 600));
    check('G2 a capture Gary did not share is absent from the whole request to Claude (item 10)', !allG.includes('GARY PRIVATE NOTE')
      && !allG.includes(Buffer.from('GARY-702').toString('base64')) && !storageGets.slice(gG).some((g) => g.path.endsWith(uid(702) + '.jpg')));
    const imgsG = bG.filter((b) => b.type === 'image');
    check('G2 Gary\'s shared switched-on photo fetched as Eric and sent, labelled by Gary; the switched-off one not fetched, sent or mentioned',
      imgsG.length === 1 && imgsG[0].source.data === Buffer.from('GARY-701').toString('base64')
      && storageGets.slice(gG).length === 1 && storageGets.slice(gG)[0].auth === ERIC_JWT
      && bG.some((b) => b.type === 'text' && /^Photo from capture 1 \(by Gary\), 1000 hrs Bangkok time: Gary shared/.test(b.text))
      && !allG.includes(Buffer.from('GARY-703').toString('base64')) && !/photo=/.test((ctxG.match(/<capture n="2"[^>]*>/) || [''])[0]), JSON.stringify(storageGets.slice(gG)));
    check('G2 the thread is Eric\'s: his first turn, its reply, his second turn', cG.messages.length === 3
      && cG.messages[0].content[cG.messages[0].content.length - 1].text === 'Long day on the river.'
      && cG.messages[1].role === 'assistant' && cG.messages[2].content === 'Did Gary find the mango place?');

    // G3 Gary's own call that day: his prompt, his 3 captures (the private one too) and Eric's? (not shared: absent)
    nG = anth.calls.length;
    r = await call(turn(uid(803), 'Mango place was great.', '2026-11-13T14:20:00Z', '2026-11-13'));
    cG = anth.calls[nG] && anth.calls[nG].body;
    allG = JSON.stringify(cG || {});
    check('G3 Gary: his prompt, his 3 captures including the private one; Eric\'s unshared capture absent; Eric\'s thread absent',
      r.status === 200 && String(cG.system) === fs.readFileSync(path.join(ROOT, 'prompts/journal.md'), 'utf8').trim()
      && allG.includes('GARY PRIVATE NOTE') && !allG.includes('boat to Wat Arun') && !allG.includes('Long day on the river.')
      && allG.includes("Gary's captures for this day"), allG.slice(0, 300));

    // G4 Eric shares his: Gary's call lists it by="Eric"
    m.upsertBatch([{ id: uid(711), body: 'Eric: boat to Wat Arun', kind: 'note', tz: 'Asia/Bangkok', local_date: '2026-11-13',
      captured_at: '2026-11-13T06:00:00Z', updated_at: '2026-11-13T07:00:00Z', shared: true }], EU);
    nG = anth.calls.length;
    r = await call(turn(uid(804), 'And Eric?', '2026-11-13T14:30:00Z', '2026-11-13'));
    cG = anth.calls[nG] && anth.calls[nG].body;
    check('G4 Gary\'s call: Eric\'s shared capture listed by="Eric"', r.status === 200
      && /by="Eric">\nEric: boat to Wat Arun/.test(cG.messages[0].content[0].text));

    // G5 unlinked: Gary's shared captures leave Eric's context again
    m.partnerRemove(G, EU);
    nG = anth.calls.length;
    r = await call(turn(uid(805), 'Later that night.', '2026-11-13T15:00:00Z', '2026-11-13'), E);
    allG = JSON.stringify(anth.calls[nG] && anth.calls[nG].body || {});
    check('G5 link removed: none of Gary\'s captures reach Eric\'s request', r.status === 200 && !allG.includes('Gary shared') && !allG.includes('GARY-'));

    // G6 the 30 photos are combined: Eric 20 switched-on, Gary 15 shared switched-on -> 30 images, 5 not shown
    m.partnerAdd(G, EU);
    const day6 = [], dayG6 = [];
    for (let i = 0; i < 35; i++) {
      const who = dayG6.length < 15 && i % 2 === 1 ? G : EU;   // Gary's 15 spread among Eric's 20
      const id = uid(950 + i);
      const row = { id, body: `${who === G ? 'G' : 'E'}${i}`, kind: 'note', tz: 'Asia/Bangkok', local_date: '2026-11-14',
        captured_at: `2026-11-14T${String(1 + Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}:00Z`,
        updated_at: '2026-11-14T12:00:00Z', shared: true, photo_path: `${who}/${id}.jpg` };
      (who === G ? dayG6 : day6).push(row);
      m.objects.set(`${who}/${id}.jpg`, { bytes: Buffer.from('P' + i), contentType: 'image/jpeg' });
    }
    m.upsertBatch(dayG6, G); m.upsertBatch(day6, EU);
    nG = anth.calls.length; gG = storageGets.length;
    r = await call(turn(uid(806), 'All those photos.', '2026-11-14T14:00:00Z', '2026-11-14'), E);
    const b6 = anth.calls[nG] ? anth.calls[nG].body.messages[0].content : [];
    const img6 = b6.filter((b) => b.type === 'image');
    check('G6 ' + dayG6.length + ' of Gary\'s and ' + day6.length + ' of Eric\'s photos: 30 images, the most recent across both, 5 listed not shown, all fetched as Eric',
      r.status === 200 && dayG6.length === 15 && img6.length === 30 && img6[0].source.data === Buffer.from('P5').toString('base64')
      && img6[29].source.data === Buffer.from('P34').toString('base64') && (b6[0].text.match(/, not shown"/g) || []).length === 5
      && storageGets.slice(gG).length === 30 && storageGets.slice(gG).every((g) => g.auth === ERIC_JWT)
      && storageGets.slice(gG).some((g) => g.path.startsWith(G + '/')), `${img6.length} ${dayG6.length}`);

    // G7 a person whose prompt key is not in this deploy: 502 no_prompt, no Claude call
    m.people.get(EU).prompt = 'journal-nobody';
    nG = anth.calls.length;
    r = await call(turn(uid(807), 'Unknown prompt.', '2026-11-14T15:00:00Z', '2026-11-14'), E);
    check('G7 unknown journal_prompt: 502 no_prompt, no Claude call, nothing stored as a reply', r.status === 502 && r.body.error === 'no_prompt'
      && anth.calls.length === nG && ![...m.jrows.values()].some((x) => x.reply_to === uid(807)), JSON.stringify(r.body));
    m.people.get(EU).prompt = 'journal-eric';

    // ---------- M1.3 (SPEC.md 7C.2a, 7C.4, 7C.5) ----------
    // Gary's day 2026-11-15: named with GPS and a photo, GPS but unnamed, named with a quote and
    // no GPS, nothing at all (journal-kind, from before M1.3).
    m.partnerRemove(G, EU);
    m.upsertBatch([
      { id: uid(1001), body: 'Tampines lunch', kind: 'note', tz: 'Asia/Singapore', local_date: '2026-11-15', captured_at: '2026-11-15T04:00:00Z',
        updated_at: '2026-11-15T04:00:00Z', lat: 1.35247, lng: 103.94452, accuracy_m: 8, place_name: 'Tampines Mall', photo_path: `${G}/${uid(1001)}.jpg` },
      { id: uid(1002), body: 'Bench by the reservoir', kind: 'note', tz: 'Asia/Singapore', local_date: '2026-11-15', captured_at: '2026-11-15T05:00:00Z',
        updated_at: '2026-11-15T05:00:00Z', lat: 1.34012, lng: 103.92271, accuracy_m: 15 },
      { id: uid(1003), body: 'Kopi at the stall', kind: 'note', tz: 'Asia/Singapore', local_date: '2026-11-15', captured_at: '2026-11-15T06:00:00Z',
        updated_at: '2026-11-15T06:00:00Z', place_name: 'Ah Seng "Original" <Kopi> & Toast' },
      { id: uid(1004), body: 'Old journal-kind note', kind: 'journal', tz: 'Asia/Singapore', local_date: '2026-11-15', captured_at: '2026-11-15T07:00:00Z',
        updated_at: '2026-11-15T07:00:00Z' }
    ], G);
    m.objects.set(`${G}/${uid(1001)}.jpg`, { bytes: Buffer.from('TAMPINES'), contentType: 'image/jpeg' });
    nG = anth.calls.length;
    r = await call(turn(uid(1101), 'Where did I have lunch?', '2026-11-15T12:00:00Z', '2026-11-15'));
    let cH = anth.calls[nG] && anth.calls[nG].body;
    const bH = cH ? cH.messages[0].content : [];
    const ctxH = bH[0] && bH[0].text || '';
    const tag = (n) => (ctxH.match(new RegExp(`<capture n="${n}"[^>]*>`)) || [''])[0];
    check('H1 a named capture is labelled with its place name only (item 6)', r.status === 200
      && tag(1) === '<capture n="1" time="1200 hrs Singapore time" place="Tampines Mall" photo="shown below">', tag(1));
    check('H1 an unnamed capture with GPS keeps its coordinates', tag(2) === '<capture n="2" time="1300 hrs Singapore time" location="1.34012, 103.92271 (within 15 m)">', tag(2));
    check('H1 a name with quotes and angle brackets is escaped inside the attribute',
      tag(3) === '<capture n="3" time="1400 hrs Singapore time" place="Ah Seng &quot;Original&quot; &lt;Kopi&gt; &amp; Toast">', tag(3));
    check('H1 no name and no GPS: neither attribute', tag(4) === '<capture n="4" time="1500 hrs Singapore time">', tag(4));
    check('H2 the photo label names the place', bH.some((b) => b.type === 'text' && b.text === 'Photo from capture 1, 1200 hrs Singapore time, at Tampines Mall: Tampines lunch'));
    const everyCall = JSON.stringify(anth.calls.slice(nG).map((c) => c.body));
    check('H3 no kind label anywhere in the request (7C.2a), journal-kind row listed like any other',
      !/kind=/.test(everyCall) && !/(, note|, journal)(:|")/.test(everyCall) && ctxH.includes('Old journal-kind note'));
    check('H3 every call since M1.3 carries no kind attribute', !anth.calls.some((c) => /kind=\\"/.test(JSON.stringify(c.body.messages))));

    // H4 (item 7): Gary's custom prompt replaces the bundled file; the captures stay in the context
    m.people.get(G).custom = 'Gary custom prompt: reply in one short paragraph.';
    nG = anth.calls.length;
    r = await call(turn(uid(1102), 'And after lunch?', '2026-11-15T12:10:00Z', '2026-11-15'));
    cH = anth.calls[nG] && anth.calls[nG].body;
    check('H4 custom prompt set: the system prompt is exactly the custom text', r.status === 200 && cH
      && cH.system === 'Gary custom prompt: reply in one short paragraph.', cH && String(cH.system).slice(0, 80));
    check('H4 the custom prompt cannot drop the captures: same context block before the thread',
      cH && cH.messages[0].content[0].text === ctxH && cH.messages[0].content.some((b) => b.type === 'image'));
    // Eric's call is untouched by Gary's custom prompt
    nG = anth.calls.length;
    r = await call(turn(uid(1103), 'Eric, same day.', '2026-11-15T12:20:00Z', '2026-11-15'), E);
    cH = anth.calls[nG] && anth.calls[nG].body;
    check('H4 Gary\'s custom text never reaches Eric\'s call', r.status === 200 && cH
      && String(cH.system) === fs.readFileSync(path.join(ROOT, 'prompts/journal-eric.md'), 'utf8').trim() && !JSON.stringify(cH).includes('Gary custom prompt'));

    // H5: reset (null), and blank, go back to the bundled file
    for (const v of [null, '   ']) {
      m.people.get(G).custom = v;
      nG = anth.calls.length;
      r = await call(turn(uid(1104 + (v === null ? 0 : 1)), 'After reset ' + JSON.stringify(v), '2026-11-15T12:3' + (v === null ? 0 : 5) + ':00Z', '2026-11-15'));
      cH = anth.calls[nG] && anth.calls[nG].body;
      check('H5 custom ' + JSON.stringify(v) + ': back to prompts/journal.md', r.status === 200 && cH
        && String(cH.system) === fs.readFileSync(path.join(ROOT, 'prompts/journal.md'), 'utf8').trim());
    }

    // H6: with custom text set, a key missing from this deploy no longer fails the call
    m.people.get(EU).prompt = 'journal-nobody';
    m.people.get(EU).custom = 'Eric custom prompt.';
    nG = anth.calls.length;
    r = await call(turn(uid(1106), 'Unknown key, custom text.', '2026-11-15T13:00:00Z', '2026-11-15'), E);
    cH = anth.calls[nG] && anth.calls[nG].body;
    check('H6 unknown key but custom text: 200 with the custom text', r.status === 200 && cH && cH.system === 'Eric custom prompt.', JSON.stringify(r.body));
    m.people.get(EU).prompt = 'journal-eric';
    m.people.get(EU).custom = null;

    // F11 database rejects the JWT
    r = await call(turn(uid(6), 'x', '2026-11-09T15:00:00Z'), { Authorization: 'Bearer eyJ.other' });
    check('F11 PostgREST 401: function answers 401 auth', r.status === 401 && r.body.error === 'auth');

    // F12 no key configured: tested by restarting without the secret
  } finally {
    fn.kill();
  }
  const fn2 = spawn(DENO, ['run', '--allow-net', '--allow-env', '--allow-read', '--no-lock', '--quiet',
    path.join(ROOT, 'supabase/functions/tb-journal/index.ts')], {
    env: Object.assign({}, process.env, { PORT: String(FN), SUPABASE_URL: `http://127.0.0.1:${FAKE}`,
      SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: 'pk_test' }), TB_ANTHROPIC_API_KEY: '',
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${FAKE}` }), stdio: 'ignore' });
  try {
    for (let i = 0; i < 300; i++) {
      try { await fetch(`http://127.0.0.1:${FN}/`, { method: 'OPTIONS' }); break; } catch (e) { await sleep(200); }
    }
    const r = await call(turn(uid(7), 'no key', '2026-11-09T16:00:00Z'));
    check('F12 secret missing: 502 no_key', r.status === 502 && r.body.error === 'no_key');
  } finally { fn2.kill(); }
  srv.close();
  if (results.some((x) => !x.ok)) console.log('\nfunction log:\n' + log.slice(-3000));
  const failed = results.filter((x) => !x.ok).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
