// travelboard tb-journal function test (TESTS.md, M2). Dev only. Run from the repo root:
//   node checks/headless/fn.test.cjs
// Runs the real supabase/functions/tb-journal/index.ts under Deno against local fakes:
// PostgREST (the journal mock in harness.cjs, which mirrors migration 0004) and the
// Anthropic Messages API (records every request). Needs deno on PATH or DENO=/path/to/deno.
// Checks the request it sends to Claude, idempotent retries, error mapping and the 40-turn cap.
'use strict';
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { makeMock, ROOT } = require('./harness.cjs');

const FAKE = 8742, FN = 8000;   // Deno.serve listens on 8000 by default
const DENO = process.env.DENO || 'deno';
const JWT = 'Bearer eyJ.fake.jwt';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail && !ok ? '  [' + detail + ']' : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const m = makeMock();
const anth = { mode: 'ok', calls: [] };
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
        usage: { input_tokens: 1200 + anth.calls.length, output_tokens: 40 } });
    }
    if (req.url.startsWith('/rest/v1/rpc/')) {
      if (req.headers.authorization !== JWT) return send(401, { code: 'PGRST301', message: 'JWT expired' });
      if (req.headers.apikey !== 'pk_test') return send(401, { message: 'bad apikey' });
      try {
        if (req.url.endsWith('/tb_journal_turn')) return send(200, m.turn(body.p));
        if (req.url.endsWith('/tb_journal_reply')) return send(200, m.reply(body.p));
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
    check('F4 system starts with prompts/journal.md', sys.startsWith(require('fs').readFileSync(path.join(ROOT, 'prompts/journal.md'), 'utf8').trim().slice(0, 60)));
    check('F4 system lists the day and both live captures with Bangkok local times', sys.includes('Mon 09/11/26')
      && sys.includes('Jay Fai crab omelette') && sys.includes('1830 hrs Bangkok time') && sys.includes('Wat Pho') && sys.includes('0900 hrs Bangkok time')
      && sys.indexOf('Wat Pho') < sys.indexOf('Jay Fai') && sys.includes('13.75240, 100.50450 (within 9 m)'));
    check('F4 system leaves out deleted captures and other days', !sys.includes('DELETED NOTE') && !sys.includes('OTHER DAY'));
    check('F4 messages: one user turn with the content', c1.body.messages.length === 1 && c1.body.messages[0].role === 'user'
      && c1.body.messages[0].content === 'Long day. The omelette was worth the wait.');
    const row = [...m.jrows.values()].find((x) => x.reply_to === uid(1));
    check('F4 reply row: model and token counts stored', row && row.model === 'claude-sonnet-5-5' && row.input_tokens === 1201 && row.output_tokens === 40);

    // F5 retry returns the stored reply, no API call (acceptance 3)
    r = await call(turn(uid(1), 'Long day. The omelette was worth the wait.', '2026-11-09T14:00:00Z'));
    check('F5 retry: 200, same reply, cached true, no second Claude call', r.status === 200 && r.body.cached === true
      && r.body.reply.id === row.id && anth.calls.length === 1);

    // F6 second turn: thread carries turn 1 and reply 1
    r = await call(turn(uid(2), 'And Wat Pho this morning.', '2026-11-09T14:05:00Z'));
    const c2 = anth.calls[1];
    check('F6 second turn: thread user, assistant, user', r.status === 200 && c2.body.messages.length === 3
      && c2.body.messages.map((x) => x.role).join() === 'user,assistant,user' && c2.body.messages[1].content === 'Reply 1 about the omelette.');

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
