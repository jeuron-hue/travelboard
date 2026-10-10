// travelboard M2 headless tests (TESTS.md, M2). Run from the repo root:
//   node checks/headless/m2.test.cjs
// Drives trip.html in Chromium against the RPC and tb-journal mocks in harness.cjs: Journal
// tab, composer and drafts, send and reply, airplane-mode queue, lost responses, errors and
// Retry, thread order, journal captures inline, day list and titles, pull on a second
// device, 0400 rule, IndexedDB upgrade from v1, sending with no session.
// Exit code 0 only when every check passes.
'use strict';
const { chromium, startServer, makeMock, attachMock, newContext, SUPA } = require('./harness.cjs');

const PORT = 8732;
const BASE = `http://127.0.0.1:${PORT}/`;
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail && !ok ? '  [' + detail + ']' : '')); };
const bkk = (hhmm, date = '2026-11-09') => new Date(`${date}T${hhmm.slice(0, 2)}:${hhmm.slice(2)}:00+07:00`);

const shown = (page, sel) => page.$eval(sel, (e) => !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length));
const text = (page, sel) => page.$eval(sel, (e) => e.textContent);
const pill = (page) => text(page, '#status-text');
const jrows = (page) => page.evaluate(() => idb.all('journal'));
const thread = (page) => page.$$eval('#j-thread > li', (els) => els.map((e) => ({
  cls: e.className, id: e.dataset.id || e.dataset.capture || null,
  text: e.classList.contains('quote') ? e.textContent : (e.querySelector('.text') || e).textContent,
  meta: e.querySelector('.meta') ? e.querySelector('.meta').textContent : ''
})));
const waitCap = (page, open) => page.waitForFunction((o) => document.getElementById('cap').hidden === !o && (!o || !popWait), open, { timeout: 5000 });
async function syncIdle(page) {
  await page.evaluate(async () => {
    for (let i = 0; i < 3; i++) {
      await sync();
      while (syncing) await new Promise((r) => setTimeout(r, 20));
    }
  });
}
async function write(page, msg, at) {
  if (at) await page.clock.setFixedTime(at);
  await page.click('#capture');
  await waitCap(page, true);
  await page.fill('#cap-body', msg);
  await page.click('#cap-save');
  await waitCap(page, false);
  await page.waitForFunction(() => !popWait);
}
async function capture(page, msg, kind, at) {
  if (at) await page.clock.setFixedTime(at);
  await page.click('#tab-captures');
  await page.click('#capture');
  await waitCap(page, true);
  await page.fill('#cap-body', msg);
  await page.click(kind === 'journal' ? '#kind-journal' : '#kind-note');
  await page.click('#cap-save');
  await waitCap(page, false);
  await page.waitForFunction(() => !popWait);
}
const settle = (page) => page.waitForFunction(() => !syncing, null, { timeout: 10000 });

(async () => {
  const srv = await startServer(PORT);
  const browser = await chromium.launch();

  // ================= A: phone in Asia/Bangkok, signed in, online =================
  const mock = makeMock();
  const ctx = await newContext(browser, { tz: 'Asia/Bangkok', session: true });
  await attachMock(ctx, mock);
  const page = await ctx.newPage();
  let dialogs = 0;
  page.on('dialog', (d) => { dialogs++; d.dismiss(); });
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await page.clock.setFixedTime(bkk('1900'));
  await page.goto(BASE + 'trip.html');
  await page.waitForFunction(() => document.getElementById('day-label').textContent !== '-');
  await settle(page);

  check('K0 version v4, IndexedDB v2 with journal and jdays stores', (await text(page, '#s-version')) === 'v4'
    && await page.evaluate(async () => { const db = await idb.open(); return db.version === 2 && db.objectStoreNames.contains('journal') && db.objectStoreNames.contains('jdays'); }));
  check('K0 opens on the Captures tab', await page.evaluate(() => tab === 'captures') && (await shown(page, '#daybar')) && !(await shown(page, '#jbar')));

  // Two captures today, one tagged journal; one note on another day (pulled from "the server").
  await capture(page, 'Jay Fai crab omelette, queue 40 min', 'note', bkk('1830'));
  await capture(page, 'Feet done in. Best day so far.', 'journal', bkk('1845'));
  mock.upsertBatch([{ id: '00000000-0000-4000-8000-00000000d001', body: 'Arrived BKK', kind: 'note',
    captured_at: bkk('1500', '2026-11-08').toISOString(), tz: 'Asia/Bangkok', local_date: '2026-11-08', updated_at: bkk('1500', '2026-11-08').toISOString() }]);
  await page.clock.setFixedTime(bkk('2100'));
  await syncIdle(page);

  // --- Journal tab
  await page.click('#tab-journal');
  await page.waitForTimeout(100);
  check('K1 Journal tab: day bar hidden, journal bar shown, title today "Mon 09/11/26"',
    !(await shown(page, '#daybar')) && (await shown(page, '#jbar')) && (await text(page, '#j-title')) === 'Mon 09/11/26'
    && await page.$eval('#j-title', (e) => e.classList.contains('today')));
  check('K1 bottom button reads Write', (await text(page, '#primary-label')) === 'Write');
  let th = await thread(page);
  check('K1 empty thread shows the journal capture inline as a quote', th.length === 1 && th[0].cls === 'quote'
    && th[0].text.includes('journal capture, 1845 hrs') && th[0].text.includes('Feet done in.'), JSON.stringify(th));
  check('K1 empty-thread hint hidden once a quote shows', !(await shown(page, '#j-empty')));

  // --- composer and drafts
  await page.click('#capture');
  await waitCap(page, true);
  check('K2 composer: focused, Send, no kind toggle, no Delete', await page.evaluate(() => document.activeElement.id === 'cap-body')
    && (await text(page, '#cap-save')) === 'Send' && !(await shown(page, '#kind-group')) && !(await shown(page, '#cap-foot')));
  check('K2 composer label names the day', (await page.$eval('#cap', (e) => e.getAttribute('aria-label'))) === 'Journal, Mon 09/11/26');
  check('K2 Send disabled when empty', await page.$eval('#cap-save', (b) => b.disabled));
  await page.fill('#cap-body', 'Long day in the old town.');
  await page.waitForTimeout(100);
  let d = await page.evaluate(() => idb.get('drafts', 'journal:2026-11-09'));
  check('K2 draft journal:2026-11-09 written on input, open true', d && d.body === 'Long day in the old town.' && d.open === true, JSON.stringify(d));
  await page.reload();
  await waitCap(page, true);
  check('K2 killed mid-typing: reopens the composer on the Journal tab with the text',
    (await page.inputValue('#cap-body')) === 'Long day in the old town.' && await page.evaluate(() => tab === 'journal' && cap.mode === 'journal'));
  await page.click('#cap-close');
  await waitCap(page, false);
  d = await page.evaluate(() => idb.get('drafts', 'journal:2026-11-09'));
  check('K2 Close keeps the draft closed, Write reads "draft kept"', d && d.open === false && await shown(page, '#draft-note'));
  await page.click('#tab-captures');
  await page.waitForFunction(() => document.getElementById('primary-label').textContent === 'Capture', null, { timeout: 2000 }).catch(() => {});
  check('K2 Captures tab: Capture button, no draft kept note', (await text(page, '#primary-label')) === 'Capture' && !(await shown(page, '#draft-note')));
  await page.click('#tab-journal');
  await page.click('#capture');
  await waitCap(page, true);
  check('K2 Write restores the draft', (await page.inputValue('#cap-body')) === 'Long day in the old town.');
  await page.evaluate(() => history.back());
  await waitCap(page, false);
  check('K2 Android back closes the composer, stays in the app', await page.evaluate(() => location.pathname.endsWith('/trip.html') && tab === 'journal'));

  // --- send and reply (acceptance 1 shape)
  const fn0 = mock.fnCalls.length;
  await page.clock.setFixedTime(bkk('2105'));
  await page.click('#capture');
  await waitCap(page, true);
  await page.fill('#cap-body', 'Long day in the old town. The omelette was worth it.');
  await page.click('#cap-save');
  await waitCap(page, false);
  await settle(page);
  await page.waitForTimeout(100);
  let rows = await jrows(page);
  const u1 = rows.find((r) => r.role === 'user');
  const a1 = rows.find((r) => r.role === 'assistant');
  check('K3 one call to tb-journal with local_date, message_id, content, created_at', mock.fnCalls.length === fn0 + 1
    && mock.fnCalls[fn0].local_date === '2026-11-09' && mock.fnCalls[fn0].message_id === u1.id
    && mock.fnCalls[fn0].created_at === bkk('2105').toISOString(), JSON.stringify(mock.fnCalls[fn0]));
  check('K3 turn sent, reply stored locally once, linked by reply_to', u1 && u1.state === 'sent' && a1 && a1.reply_to === u1.id
    && rows.length === 2 && a1.model === 'claude-sonnet-5-5');
  check('K3 the draft is cleared on Send', !(await page.evaluate(() => idb.get('drafts', 'journal:2026-11-09'))) && !(await shown(page, '#draft-note')));
  const sys1 = mock.claude[mock.claude.length - 1].system;
  check('K3 Claude saw both of the day\'s captures (pushed before the turn was sent)', sys1.includes('Jay Fai crab omelette')
    && sys1.includes('Feet done in.') && sys1.includes('1830 hrs Bangkok time') && !sys1.includes('Arrived BKK'));
  th = await thread(page);
  check('K3 thread: journal capture (1845) before the turn (2105), then the reply', th.length === 3
    && th[0].cls === 'quote' && th[1].cls === 'msg user' && th[2].cls === 'msg assistant' && th[2].text.startsWith('Reply'), JSON.stringify(th));
  check('K3 pill synced', (await pill(page)) === 'synced', await pill(page));

  // --- second turn: order
  await write(page, 'Wat Pho in the morning.', bkk('2110'));
  await settle(page);
  const last = mock.claude[mock.claude.length - 1].messages;
  check('K4 second turn: Claude gets user, assistant, user', last.map((x) => x.role).join() === 'user,assistant,user'
    && last[2].content === 'Wat Pho in the morning.');
  th = await thread(page);
  check('K4 thread order on screen: quote, turn 1, reply 1, turn 2, reply 2',
    th.map((x) => x.cls).join() === 'quote,msg user,msg assistant,msg user,msg assistant', th.map((x) => x.cls).join());

  // --- airplane mode (acceptance 2)
  mock.offline = true;
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  const fn1 = mock.fnCalls.length, c1 = mock.claude.length;
  await write(page, 'Written in airplane mode.', bkk('2120'));
  await settle(page);
  rows = await jrows(page);
  let ap = rows.find((r) => r.content === 'Written in airplane mode.');
  check('K5 airplane mode: turn saved as pending, nothing reached the server', ap && ap.state === 'pending' && mock.fnCalls.length === fn1);
  check('K5 pill "offline, 1 queued", chip queued', (await pill(page)) === 'offline, 1 queued'
    && (await thread(page)).find((x) => x.id === ap.id).meta.includes('queued'), await pill(page));
  mock.offline = false;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await settle(page);
  await syncIdle(page);
  rows = await jrows(page);
  ap = rows.find((r) => r.id === ap.id);
  const apReplies = rows.filter((r) => r.reply_to === ap.id);
  check('K5 on reconnect: sent once, exactly one reply', ap.state === 'sent' && apReplies.length === 1
    && mock.fnCalls.filter((b) => b.message_id === ap.id).length === 1 && mock.claude.length === c1 + 1);
  check('K5 server holds one reply for it', [...mock.jrows.values()].filter((r) => r.reply_to === ap.id).length === 1);
  check('K5 pill synced', (await pill(page)) === 'synced');

  // --- lost response: reply stored on the server, phone never heard (acceptance 3)
  const c2 = mock.claude.length;
  mock.fnDropResponse = true;
  await write(page, 'This response gets lost.', bkk('2125'));
  await settle(page);
  rows = await jrows(page);
  let lost = rows.find((r) => r.content === 'This response gets lost.');
  check('K6 lost response: turn still pending locally, reply exists on the server', lost.state === 'pending'
    && [...mock.jrows.values()].some((r) => r.reply_to === lost.id) && mock.claude.length === c2 + 1);
  await page.evaluate(() => { syncState.phase = 'checking'; });
  await syncIdle(page);
  rows = await jrows(page);
  lost = rows.find((r) => r.id === lost.id);
  check('K6 retry returns the stored reply: no second Claude call, one reply', lost.state === 'sent'
    && rows.filter((r) => r.reply_to === lost.id).length === 1 && mock.claude.length === c2 + 1
    && mock.fnCalls.filter((b) => b.message_id === lost.id).length === 2);

  // --- error from the function: Retry, never automatic
  mock.fnMode = 'anthropic_auth';
  await write(page, 'Key is broken now.', bkk('2130'));
  await settle(page);
  rows = await jrows(page);
  let bad = rows.find((r) => r.content === 'Key is broken now.');
  th = await thread(page);
  const badEl = th.find((x) => x.id === bad.id);
  check('K7 function error: turn kept, "not sent" with the server message and a Retry button', bad.state === 'error'
    && badEl.meta.includes('not sent') && badEl.meta.includes('TB_ANTHROPIC_API_KEY (401)') && await page.$(`[data-retry="${bad.id}"]`), JSON.stringify(badEl));
  check('K7 a failed turn is not counted as queued', (await pill(page)) === 'synced', await pill(page));
  const fnBad = mock.fnCalls.length;
  await syncIdle(page);
  check('K7 no automatic resend of a failed turn', mock.fnCalls.length === fnBad);
  mock.fnMode = 'ok';
  await page.click(`[data-retry="${bad.id}"]`);
  await settle(page);
  await syncIdle(page);
  rows = await jrows(page);
  bad = rows.find((r) => r.id === bad.id);
  check('K7 Retry sends it and the reply arrives', bad.state === 'sent' && rows.some((r) => r.reply_to === bad.id));

  // --- the queue stops at the first failure, keeps order
  mock.offline = true;
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await write(page, 'Queued one.', bkk('2140'));
  await write(page, 'Queued two.', bkk('2141'));
  mock.offline = false;
  mock.fnMode = 'busy';
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await settle(page);
  rows = await jrows(page);
  const q1 = rows.find((r) => r.content === 'Queued one.'), q2 = rows.find((r) => r.content === 'Queued two.');
  check('K8 first queued turn fails (busy), the second waits unsent', q1.state === 'error' && q2.state === 'pending'
    && !mock.fnCalls.some((b) => b.message_id === q2.id), JSON.stringify([q1.state, q2.state]));
  check('K8 pill counts the waiting turn', /1 queued|queued 1/.test(await pill(page)), await pill(page));
  mock.fnMode = 'ok';
  await page.click(`[data-retry="${q1.id}"]`);
  await settle(page);
  await syncIdle(page);
  rows = await jrows(page);
  const calls = mock.fnCalls.map((b) => b.message_id);
  check('K8 after Retry both go, in order', rows.find((r) => r.id === q1.id).state === 'sent' && rows.find((r) => r.id === q2.id).state === 'sent'
    && calls.lastIndexOf(q1.id) < calls.lastIndexOf(q2.id));
  const lm = mock.claude[mock.claude.length - 1].messages;
  check('K8 Claude sees turn one and its reply before turn two', lm[lm.length - 1].content === 'Queued two.'
    && lm[lm.length - 3].content === 'Queued one.' && lm[lm.length - 2].role === 'assistant');

  // --- day list, titles
  await page.click('#j-days');
  await page.waitForTimeout(100);
  const daylist = await page.$$eval('#j-daylist .dayrow', (els) => els.map((e) => ({ day: e.dataset.day, t: e.innerText.replace(/\s+/g, ' ').trim() })));
  check('K9 day list newest first: today, then 08/11 (captures only)', daylist.length === 2 && daylist[0].day === '2026-11-09'
    && daylist[1].day === '2026-11-08' && /14 messages, 2 captures/.test(daylist[0].t) && /No messages yet, 1 capture/.test(daylist[1].t), JSON.stringify(daylist));
  check('K9 day list bar: Today button, "Journal days"', (await text(page, '#j-days')) === 'Today' && (await text(page, '#j-title')) === 'Journal days');
  await page.click('#j-daylist .dayrow[data-day="2026-11-08"]');
  await page.waitForTimeout(100);
  check('K9 tap a day: its thread, title "Sun 08/11/26", empty hint names its capture', (await text(page, '#j-title')) === 'Sun 08/11/26'
    && (await text(page, '#j-empty')).includes('your 1 capture from this day') && (await thread(page)).length === 0);
  await page.click('#j-title');
  await page.fill('#suffix-input', 'Bangkok arrival');
  await page.click('#suffix-save');
  await page.waitForTimeout(100);
  await settle(page);
  await syncIdle(page);
  check('K9 title suffix shows and reaches the server', (await text(page, '#j-title')) === 'Sun 08/11/26 Bangkok arrival'
    && mock.jdays.get('2026-11-08') && mock.jdays.get('2026-11-08').suffix === 'Bangkok arrival');
  check('K9 suffix no longer dirty after sync', await page.evaluate(async () => (await idb.get('jdays', '2026-11-08')).suffix_dirty === 0));
  await page.click('#j-title');
  await page.fill('#suffix-input', 'ignored');
  await page.click('#suffix-cancel');
  await page.waitForTimeout(100);
  check('K9 Cancel leaves the title alone', (await text(page, '#j-title')) === 'Sun 08/11/26 Bangkok arrival');
  await page.click('#capture');
  await waitCap(page, true);
  check('K9 Write on an older day writes into that day', await page.evaluate(() => cap.jdate === '2026-11-08'));
  await page.click('#cap-close');
  await waitCap(page, false);
  await page.click('#j-days');
  await page.click('#j-days');   // Today
  await page.waitForTimeout(100);
  check('K9 Today returns to today\'s thread', (await text(page, '#j-title')) === 'Mon 09/11/26');

  // --- 0400 rule: at 0130 on 10/11 "today" is still 09/11
  await page.clock.setFixedTime(bkk('0130', '2026-11-10'));
  await page.evaluate(() => render());
  check('K10 0130 next morning: journal today is still Mon 09/11/26', (await text(page, '#j-title')) === 'Mon 09/11/26');
  await write(page, 'Nightcap note.');
  rows = await jrows(page);
  check('K10 a turn at 0130 belongs to 2026-11-09', rows.find((r) => r.content === 'Nightcap note.').local_date === '2026-11-09');
  await settle(page);
  await page.clock.setFixedTime(bkk('0430', '2026-11-10'));
  await page.evaluate(() => render());
  check('K10 0430: today rolls to Tue 10/11/26', (await text(page, '#j-title')) === 'Tue 10/11/26');
  check('K10 no dialogs (alerts) on page A', dialogs === 0, dialogs);

  // ================= B: second device in Asia/Singapore pulls everything =================
  // One server turn with no reply, unknown to any phone.
  mock.turn({ message_id: '00000000-0000-4000-8000-00000000e001', local_date: '2026-11-09', content: 'Orphan turn', created_at: bkk('2300').toISOString() });
  const ctxB = await newContext(browser, { tz: 'Asia/Singapore', session: true });
  await attachMock(ctxB, mock);
  const pb = await ctxB.newPage();
  pb.on('pageerror', (e) => console.log('PAGEERROR B', e.message));
  await pb.clock.setFixedTime(bkk('2330'));
  await pb.goto(BASE + 'trip.html');
  await pb.waitForFunction(() => document.getElementById('day-label').textContent !== '-');
  await settle(pb);
  await syncIdle(pb);
  const rb = await jrows(pb);
  const serverCount = [...mock.jrows.values()].length;
  check('K11 second device pulls every journal row', rb.length === serverCount, `${rb.length} vs ${serverCount}`);
  check('K11 replied turns arrive as sent', rb.filter((r) => r.role === 'user' && r.id !== '00000000-0000-4000-8000-00000000e001').every((r) => r.state === 'sent'));
  const orphan = rb.find((r) => r.id === '00000000-0000-4000-8000-00000000e001');
  check('K11 a server turn with no reply arrives as "not sent" with Retry', orphan && orphan.state === 'error' && /Retry/.test(orphan.error));
  check('K11 title suffix pulled', await pb.evaluate(async () => (await idb.get('jdays', '2026-11-08')).suffix === 'Bangkok arrival'));
  await pb.click('#tab-journal');
  await pb.waitForTimeout(100);
  const thB = await thread(pb);
  check('K11 thread order on the second device matches the server order',
    thB.filter((x) => x.cls !== 'quote').map((x) => x.id).join() === mock.jday('2026-11-09').messages.map((x) => x.id).join());
  const daysCalls = mock.calls.filter((p) => p === '/rest/v1/rpc/tb_journal_day').length;
  await syncIdle(pb);
  check('K11 unchanged days are not fetched again', mock.calls.filter((p) => p === '/rest/v1/rpc/tb_journal_day').length === daysCalls);
  const c3 = mock.claude.length;
  await pb.click(`[data-retry="00000000-0000-4000-8000-00000000e001"]`);
  await settle(pb);
  await syncIdle(pb);
  check('K11 Retry on the orphan gets a reply', mock.claude.length === c3 + 1
    && (await jrows(pb)).some((r) => r.reply_to === '00000000-0000-4000-8000-00000000e001'));
  await syncIdle(page);
  check('K11 the first phone pulls that reply too', (await jrows(page)).some((r) => r.reply_to === '00000000-0000-4000-8000-00000000e001'));

  // ================= C: IndexedDB upgrade from v1 (an M1 phone) keeps captures =================
  const ctxC = await newContext(browser, { tz: 'Asia/Bangkok', session: true });
  const mockC = makeMock();
  await attachMock(ctxC, mockC);
  const pc = await ctxC.newPage();
  await pc.goto(BASE + 'index.html');
  await pc.evaluate(() => new Promise((resolve, reject) => {
    const r = indexedDB.open('travelboard', 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      const s = db.createObjectStore('captures', { keyPath: 'id' });
      s.createIndex('local_date', 'local_date');
      s.createIndex('dirty', 'dirty');
      db.createObjectStore('drafts', { keyPath: 'id' });
      db.createObjectStore('meta', { keyPath: 'key' });
    };
    r.onsuccess = () => {
      const db = r.result;
      const t = db.transaction(['captures', 'meta', 'drafts'], 'readwrite');
      t.objectStore('captures').put({ id: '00000000-0000-4000-8000-00000000f001', body: 'M1 capture', kind: 'note', captured_at: '2026-10-10T05:00:00.000Z',
        tz: 'Asia/Singapore', local_date: '2026-10-10', lat: null, lng: null, accuracy_m: null, trip_id: null, place_id: null,
        updated_at: '2026-10-10T05:00:00.000Z', deleted_at: null, server_ts: null, dirty: 1 });
      t.objectStore('meta').put({ key: 'schema_version', value: 1 });
      t.objectStore('drafts').put({ id: 'new', body: 'M1 draft', kind: 'note', open: false, updated_at: '2026-10-10T05:00:00.000Z' });
      t.oncomplete = () => { db.close(); resolve(); };
      t.onerror = () => reject(t.error);
    };
    r.onerror = () => reject(r.error);
  }));
  await pc.goto(BASE + 'trip.html');
  await pc.waitForFunction(() => document.getElementById('day-label').textContent !== '-');
  await settle(pc);
  const up = await pc.evaluate(async () => ({ v: (await idb.open()).version, caps: await idb.all('captures'),
    sv: await meta.get('schema_version'), draft: await idb.get('drafts', 'new') }));
  check('K12 upgrade v1 to v2: capture, draft and meta kept, schema_version 2', up.v === 2 && up.caps.length === 1
    && up.caps[0].body === 'M1 capture' && up.sv === 2 && up.draft && up.draft.body === 'M1 draft');
  check('K12 the queued M1 capture still syncs after the upgrade', mockC.rows.has('00000000-0000-4000-8000-00000000f001'));

  // ================= D: no session: a turn still saves and queues =================
  const ctxD = await newContext(browser, { tz: 'Asia/Bangkok', session: false });
  const mockD = makeMock();
  await attachMock(ctxD, mockD);
  const pd = await ctxD.newPage();
  await pd.clock.setFixedTime(bkk('2200'));
  await pd.goto(BASE + 'trip.html');
  await pd.waitForFunction(() => document.getElementById('day-label').textContent !== '-');
  await settle(pd);
  await pd.click('#tab-journal');
  await write(pd, 'No session yet.');
  await settle(pd);
  const rd = await jrows(pd);
  check('K13 no session: turn saved as pending, nothing sent, pill "sign in, 1 queued"', rd.length === 1 && rd[0].state === 'pending'
    && mockD.fnCalls.length === 0 && (await pill(pd)) === 'sign in, 1 queued', await pill(pd));

  // ================= E: expired session at the function: turn stays pending, pill sign in =================
  const ctxE = await newContext(browser, { tz: 'Asia/Bangkok', session: true });
  const mockE = makeMock();
  await attachMock(ctxE, mockE);
  await ctxE.route(SUPA + '/functions/v1/tb-journal', (route) => route.fulfill({ status: 401,
    headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: JSON.stringify({ code: 401, message: 'Invalid JWT' }) }));
  const pe = await ctxE.newPage();
  await pe.clock.setFixedTime(bkk('2200'));
  await pe.goto(BASE + 'trip.html');
  await pe.waitForFunction(() => document.getElementById('day-label').textContent !== '-');
  await settle(pe);
  await pe.click('#tab-journal');
  await write(pe, 'Token expired.');
  await settle(pe);
  const re = await jrows(pe);
  check('K14 401 from tb-journal: turn stays pending (not failed), pill asks to sign in', re[0].state === 'pending'
    && /^sign in/.test(await pill(pe)), `${re[0].state} / ${await pill(pe)}`);

  await browser.close();
  srv.close();
  const failed = results.filter((x) => !x.ok).length;
  console.log(`\n${results.length - failed} of ${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
