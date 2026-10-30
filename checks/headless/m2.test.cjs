// travelboard M2 headless tests (TESTS.md, M2). Run from the repo root:
//   node checks/headless/m2.test.cjs
// Drives trip.html in Chromium against the RPC and tb-journal mocks in harness.cjs: Journal
// tab, composer and drafts, send and reply, airplane-mode queue, lost responses, errors and
// Retry, thread order, day list and titles, pull on a second device, 0400 rule, IndexedDB
// upgrade from v1, sending with no session, and the v6 move to the travelboard project
// (SPEC.md 6.8 step 6). M1.3 (SPEC.md 7C.2a, 7C.3): journal-kind captures are no longer quoted
// in the thread, and a new capture cannot be made journal-kind; the K1, K3, K4 and K11 checks
// that saw the quote were rewritten on 24/10/26 to check its absence, with the journal-kind
// capture now an old row from the server. Claude still sees it, unlabelled.
// M1.3 session B (SPEC.md 7C.2, 7C.3, 7C.7 item 6a), 24/10/26: the Write button and its
// full-screen composer are gone; a turn is typed in the inline field at the foot of the
// Journal tab (#j-input) and sent with Send (#j-send). The composer checks of K1, K2 and K9
// were rewritten to the field as deliberate changes: the field instead of Write, a draft per
// day written on input and kept through a force-close, the draft closed when the field is left,
// the field following the day on screen, the field growing with the text. The thread's
// structure changed (margin rule, label, text); the class names msg user and msg assistant,
// the .text and .meta parts and data-retry are kept. The day title's suffix moved under the
// title (#j-sub), so K9 reads it there.
// Exit code 0 only when every check passes.
'use strict';
const { until, chromium, launch, startServer, makeMock, attachMock, newContext, sessionJson, SUPA } = require('./harness.cjs');

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
  text: (e.querySelector('.text') || e).textContent,
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
// A turn through the inline field: type, Send, wait until it is stored and the field is empty.
async function write(page, msg, at) {
  if (at) await page.clock.setFixedTime(at);
  await page.fill('#j-input', msg);
  await page.click('#j-send');
  await until(page, async (m) => document.getElementById('j-input').value === ''
    && (await idb.all('journal')).some((r) => r.content === m), msg, { timeout: 5000 });
}
async function capture(page, msg, at) {
  if (at) await page.clock.setFixedTime(at);
  await page.click('#tab-captures');
  await page.click('#capture');
  await waitCap(page, true);
  await page.fill('#cap-body', msg);
  await page.click('#cap-save');
  await waitCap(page, false);
  await page.waitForFunction(() => !popWait);
}
const settle = (page) => page.waitForFunction(() => !syncing, null, { timeout: 10000 });

(async () => {
  const srv = await startServer(PORT);
  const browser = await launch();

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

  const APP_VERSION = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'trip.html'), 'utf8').match(/const APP_VERSION = '([0-9.]+)';/)[1];
  check(`K0 version v${APP_VERSION}, IndexedDB v5 with journal, jdays, photos, partner, pphotos and geocache stores`, (await text(page, '#s-version')) === APP_VERSION
    && await page.evaluate(async () => { const db = await idb.open(); return db.version === 5 && db.objectStoreNames.contains('geocache') && db.objectStoreNames.contains('photos') && db.objectStoreNames.contains('journal') && db.objectStoreNames.contains('jdays') && db.objectStoreNames.contains('partner') && db.objectStoreNames.contains('pphotos'); }));
  check('K0 opens on the Captures tab', await page.evaluate(() => tab === 'captures') && (await shown(page, '#daybar')) && !(await shown(page, '#jbar')));

  // Two captures today: one made here, one old journal-kind row from the server (from before
  // M1.3, when the kind toggle existed); one note on another day (pulled from "the server").
  await capture(page, 'Jay Fai crab omelette, queue 40 min', bkk('1830'));
  mock.upsertBatch([{ id: '00000000-0000-4000-8000-00000000d002', body: 'Feet done in. Best day so far.', kind: 'journal',
    captured_at: bkk('1845').toISOString(), tz: 'Asia/Bangkok', local_date: '2026-11-09', updated_at: bkk('1845').toISOString() }]);
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
  check('K1 the foot holds the inline field and Send, no Write or Capture button (7C.2)', (await shown(page, '#j-input')) && (await shown(page, '#j-send'))
    && !(await shown(page, '#capture')) && (await page.getAttribute('#j-input', 'placeholder')) === 'Tell Claude about today');
  let th = await thread(page);
  check('K1 the thread quotes no capture, the journal-kind one included (7C.2a)', th.length === 0
    && !(await page.$eval('#j-thread', (e) => e.textContent)).includes('Feet done in.') && !(await page.$('#j-thread .quote')), JSON.stringify(th));
  check('K1 empty-thread hint shown, counting both of the day\'s captures', (await shown(page, '#j-empty'))
    && (await text(page, '#j-empty')).includes('your 2 captures'), await text(page, '#j-empty'));

  // --- the inline field and its draft (7C.2, 6a)
  await page.focus('#j-input');
  check('K2 the field opens no screen and pushes no history entry; Send disabled when empty', (await page.$eval('#cap', (e) => e.hidden))
    && await page.evaluate(() => !(history.state && history.state.tbCap)) && await page.$eval('#j-send', (b) => b.disabled)
    && (await page.$('#kind-group, #kind-note, #kind-journal')) === null && !(await shown(page, '#cap-place-box')) && !(await shown(page, '#cap-photo-btn')));
  const h0 = await page.$eval('#j-input', (e) => e.offsetHeight);
  await page.fill('#j-input', 'Long day in the old town.');
  await page.waitForTimeout(100);
  let d = await page.evaluate(() => idb.get('drafts', 'journal:2026-11-09'));
  check('K2 draft journal:2026-11-09 written on input, open true; Send enabled', d && d.body === 'Long day in the old town.' && d.open === true
    && !(await page.$eval('#j-send', (b) => b.disabled)), JSON.stringify(d));
  await page.reload();
  await page.waitForFunction(() => document.getElementById('j-input').value !== '', null, { timeout: 5000 }).catch(() => {});
  check('K2 killed mid-typing: reopens on the Journal tab, that day, the text in the field, focused',
    (await page.inputValue('#j-input')) === 'Long day in the old town.' && await page.evaluate(() => tab === 'journal' && jDay === '2026-11-09'
      && document.activeElement.id === 'j-input') && (await page.$eval('#cap', (e) => e.hidden)));
  await page.click('#tab-captures');
  await page.waitForTimeout(100);
  d = await page.evaluate(() => idb.get('drafts', 'journal:2026-11-09'));
  check('K2 leaving the field keeps the draft, closed', d && d.open === false && d.body === 'Long day in the old town.', JSON.stringify(d));
  check('K2 Captures tab: Capture button, no draft kept note, no journal field', (await text(page, '#primary-label')) === 'Capture'
    && !(await shown(page, '#draft-note')) && !(await shown(page, '#j-input')));
  await page.click('#tab-journal');
  await page.waitForTimeout(100);
  check('K2 back on the Journal tab the field holds the draft', (await page.inputValue('#j-input')) === 'Long day in the old town.');
  await page.fill('#j-input', 'One\ntwo\nthree\nfour\nfive');
  const h1 = await page.$eval('#j-input', (e) => e.offsetHeight);
  await page.fill('#j-input', Array.from({ length: 40 }, (_, i) => 'line ' + i).join('\n'));
  const h2 = await page.$eval('#j-input', (e) => e.offsetHeight);
  const vh = await page.evaluate(() => window.innerHeight);
  check('K2 the field grows with the text, up to 40% of the screen, then scrolls', h0 === 54 && h1 > h0 + 60 && h2 <= Math.round(vh * 0.4) + 1
    && h2 > h1 && await page.$eval('#j-input', (e) => e.scrollHeight > e.clientHeight), `${h0} ${h1} ${h2} ${vh}`);
  await page.fill('#j-input', 'Long day in the old town.');
  await page.fill('#j-input', '');
  await page.waitForTimeout(100);
  check('K2 emptying the field drops the draft; the field shrinks back', !(await page.evaluate(() => idb.get('drafts', 'journal:2026-11-09')))
    && (await page.$eval('#j-input', (e) => e.offsetHeight)) === 54);

  // --- send and reply (acceptance 1 shape)
  const fn0 = mock.fnCalls.length;
  await write(page, 'Long day in the old town. The omelette was worth it.', bkk('2105'));
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
  check('K3 Send empties the field and clears the draft, one tap', !(await page.evaluate(() => idb.get('drafts', 'journal:2026-11-09')))
    && (await page.inputValue('#j-input')) === '' && await page.$eval('#j-send', (b) => b.disabled));
  const sys1 = mock.claude[mock.claude.length - 1].context;   // the day's context block (7A.4)
  check('K3 Claude saw both of the day\'s captures (pushed before the turn was sent), the journal-kind one unlabelled', sys1.includes('Jay Fai crab omelette')
    && sys1.includes('Feet done in.') && sys1.includes('1830 hrs Bangkok time') && !sys1.includes('Arrived BKK') && !/kind=/.test(sys1));
  th = await thread(page);
  check('K3 thread: the turn (2105), then the reply; no quoted capture', th.length === 2
    && th[0].cls === 'msg user' && th[1].cls === 'msg assistant' && th[1].text.startsWith('Reply'), JSON.stringify(th));
  const look = await page.evaluate(() => {
    const [u, a] = document.querySelectorAll('#j-thread > li');
    const cs = (e, pseudo) => getComputedStyle(e, pseudo || null);
    return { uWho: u.querySelector('.who').textContent, aWho: a.querySelector('.who').textContent,
      uFont: cs(u.querySelector('.text')).fontFamily, aFont: cs(a.querySelector('.text')).fontFamily, aSize: cs(a.querySelector('.text')).fontSize,
      uRule: cs(u, '::before').backgroundColor, aRule: cs(a, '::before').backgroundColor, accent: cs(document.getElementById('j-send')).backgroundColor,
      bubbles: [u, a].some((e) => cs(e).backgroundColor !== 'rgba(0, 0, 0, 0)' || cs(e).borderRadius !== '0px') };
  });
  check('K3 the page (7C.2): own turn in Plex with the accent rule, labelled "Gary, 2105 hrs"; reply in Newsreader 17.5 px with the blue rule; no bubbles',
    look.uWho === 'Gary, 2105 hrs' && /^Claude, \d{4} hrs$/.test(look.aWho) && /Plex/.test(look.uFont) && /Newsreader/.test(look.aFont) && look.aSize === '17.5px'
    && look.uRule === look.accent && look.aRule !== look.uRule && !look.bubbles, JSON.stringify(look));
  check('K3 pill synced', (await pill(page)) === 'synced', await pill(page));

  // --- second turn: order
  await write(page, 'Wat Pho in the morning.', bkk('2110'));
  await settle(page);
  const last = mock.claude[mock.claude.length - 1].messages;
  check('K4 second turn: Claude gets user, assistant, user', last.map((x) => x.role).join() === 'user,assistant,user'
    && last[2].content === 'Wat Pho in the morning.');
  th = await thread(page);
  check('K4 thread order on screen: turn 1, reply 1, turn 2, reply 2',
    th.map((x) => x.cls).join() === 'msg user,msg assistant,msg user,msg assistant', th.map((x) => x.cls).join());

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
  await settle(page);
  mock.offline = false;
  mock.fnMode = 'busy';
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  // settle can return between a sync and its queued re-run, so wait for the outcome itself.
  await until(page, async () => (await idb.all('journal')).some((r) => r.content === 'Queued one.' && r.state === 'error'), null, { timeout: 10000 }).catch(() => {});
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
  check('K9 day list bar: Today button, "Journal days"; no field on the list', (await text(page, '#j-days')) === 'Today' && (await text(page, '#j-title')) === 'Journal days'
    && !(await shown(page, '#j-input')));
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
  check('K9 title suffix shows under the day title and reaches the server', (await text(page, '#j-title')) === 'Sun 08/11/26' && (await text(page, '#j-sub')) === 'Bangkok arrival'
    && mock.jdays.get('2026-11-08') && mock.jdays.get('2026-11-08').suffix === 'Bangkok arrival');
  check('K9 suffix no longer dirty after sync', await page.evaluate(async () => (await idb.get('jdays', '2026-11-08')).suffix_dirty === 0));
  await page.click('#j-title');
  await page.fill('#suffix-input', 'ignored');
  await page.click('#suffix-cancel');
  await page.waitForTimeout(100);
  check('K9 Cancel leaves the title alone', (await text(page, '#j-sub')) === 'Bangkok arrival');
  await page.fill('#j-input', 'About the arrival day');
  await page.waitForTimeout(100);
  check('K9 the field on an older day writes into that day', await page.evaluate(async () => jInputDay === '2026-11-08'
    && (await idb.get('drafts', 'journal:2026-11-08')).body === 'About the arrival day' && !(await idb.get('drafts', 'journal:2026-11-09'))));
  await page.click('#j-days');
  await page.click('#j-days');   // Today
  await page.waitForTimeout(100);
  check('K9 Today returns to today\'s thread, with today\'s (empty) field', (await text(page, '#j-title')) === 'Mon 09/11/26' && (await page.inputValue('#j-input')) === '');
  await page.evaluate(() => idb.del('drafts', 'journal:2026-11-08'));

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

  // --- Share the day as text (v5): share sheet when available, clipboard otherwise
  await page.evaluate(() => openJournalDay('2026-11-09'));
  check('K15 Share shows on a thread', await shown(page, '#j-share'));
  await page.evaluate(() => Object.defineProperty(navigator, 'share', { configurable: true, value: async (d) => { window.__shared = d; } }));
  await page.click('#j-share');
  await page.waitForFunction(() => !!window.__shared, null, { timeout: 3000 }).catch(() => {});
  const shared = await page.evaluate(() => window.__shared || null);
  const st = shared ? shared.text : '';
  check('K15 share sheet gets the day as text: title, both captures, the conversation', shared
    && shared.title === 'travelboard Mon 09/11/26' && st.startsWith('travelboard journal, Mon 09/11/26\n')
    && st.includes('Times are Bangkok time') && st.includes('Captures (2)')
    && st.includes('- 1830 hrs, note: Jay Fai crab omelette, queue 40 min') && st.includes('- 1845 hrs, journal: Feet done in.')
    && st.includes('Gary, 2105 hrs:\nLong day in the old town. The omelette was worth it.') && /\nClaude, \d{4} hrs:\nReply /.test(st), st.slice(0, 400));
  check('K15 conversation in thread order', st.indexOf('Queued one.') < st.indexOf('Queued two.')
    && st.indexOf('Long day in the old town') < st.indexOf('Wat Pho in the morning.') && !st.includes('(not sent yet)'));
  await page.evaluate(() => Object.defineProperty(navigator, 'share', { configurable: true, value: undefined }));
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE.replace(/\/$/, '') });
  await page.click('#j-share');
  await page.waitForFunction(() => !document.getElementById('toast').hidden, null, { timeout: 3000 }).catch(() => {});
  const clip = await page.evaluate(() => navigator.clipboard.readText().then((t) => t.replace(/\r\n/g, '\n'), () => ''));
  check('K15 no share sheet: copied to the clipboard, toast "Mon 09/11/26 copied"', clip === st
    && (await text(page, '#toast-text')) === 'Mon 09/11/26 copied');
  await page.click('#j-days');
  await page.waitForFunction(() => document.getElementById('j-title').textContent === 'Journal days', null, { timeout: 2000 }).catch(() => {});
  check('K15 Share hidden on the day list', !(await shown(page, '#j-share')));
  await page.click('#j-days');

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
    thB.map((x) => x.id).join() === mock.jday('2026-11-09').messages.map((x) => x.id).join());
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
  check('K12 upgrade v1 to v5: capture, draft and meta kept, schema_version 5', up.v === 5 && up.caps.length === 1
    && up.caps[0].body === 'M1 capture' && up.sv === 5 && up.draft && up.draft.body === 'M1 draft');
  // v6: data from before the move is from the old project, so the session is cleared and the pill asks to sign in.
  check('K12 v6: the pre-move session is cleared, nothing sent, pill "sign in, 1 queued"', !mockC.rows.size
    && (await pill(pc)) === 'sign in, 1 queued' && !(await pc.evaluate(() => localStorage.getItem('tb-auth'))), await pill(pc));
  await pc.reload();                 // the context's init script puts a session back: signed in
  await pc.waitForFunction(() => document.getElementById('day-label').textContent !== '-');
  await settle(pc);
  await syncIdle(pc);
  check('K12 the queued M1 capture syncs once signed in', mockC.rows.has('00000000-0000-4000-8000-00000000f001'));

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

  // ================= L: v6 project move (SPEC.md 6.8 step 6) =================
  // A v5 phone: everything synced with weatherboard, a stored session, a pull cursor. The new
  // server already holds the copied turn and reply (step 3) but only one of the two captures.
  const L = { c1: '00000000-0000-4000-8000-0000000c0001', c2: '00000000-0000-4000-8000-0000000c0002',
    u1: '00000000-0000-4000-8000-0000000a0001', a1: '00000000-0000-4000-8000-0000000b0001', u2: '00000000-0000-4000-8000-0000000a0002' };
  const ctxL = await newContext(browser, { tz: 'Asia/Singapore', session: false });
  const mockL = makeMock();
  await attachMock(ctxL, mockL);
  const capL = (id, body, extra) => Object.assign({ id, body, kind: 'note', captured_at: '2026-10-23T13:53:08.150Z', tz: 'Asia/Singapore',
    local_date: '2026-10-23', lat: 1.355, lng: 103.946, accuracy_m: 13.4, trip_id: null, place_id: null,
    updated_at: '2026-10-23T13:53:09.926Z', deleted_at: null }, extra || {});
  mockL.upsertBatch([capL(L.c1, 'copied capture')]);
  mockL.jrows.set(L.u1, { id: L.u1, local_date: '2026-10-23', role: 'user', content: 'copied turn', reply_to: null, model: null,
    input_tokens: null, output_tokens: null, created_at: '2026-10-23T14:00:08.671Z', server_ts: mockL.serverTs() });
  mockL.jrows.set(L.a1, { id: L.a1, local_date: '2026-10-23', role: 'assistant', content: 'copied reply', reply_to: L.u1, model: 'claude-sonnet-5-5',
    input_tokens: 892, output_tokens: 186, created_at: '2026-10-23T14:00:12.691Z', server_ts: mockL.serverTs() });
  const pl = await ctxL.newPage();
  await pl.clock.setFixedTime(new Date('2026-10-23T23:00:00+08:00'));
  await pl.goto(BASE + 'index.html');
  await pl.evaluate(({ L, c1, c2, old }) => new Promise((resolve, reject) => {
    localStorage.setItem('tb-auth', old);
    const r = indexedDB.open('travelboard', 2);
    r.onupgradeneeded = () => {
      const db = r.result;
      const s = db.createObjectStore('captures', { keyPath: 'id' });
      s.createIndex('local_date', 'local_date'); s.createIndex('dirty', 'dirty');
      db.createObjectStore('drafts', { keyPath: 'id' });
      db.createObjectStore('meta', { keyPath: 'key' });
      const j = db.createObjectStore('journal', { keyPath: 'id' });
      j.createIndex('local_date', 'local_date'); j.createIndex('state', 'state');
      db.createObjectStore('jdays', { keyPath: 'local_date' });
    };
    r.onsuccess = () => {
      const db = r.result;
      const t = db.transaction(['captures', 'meta', 'journal', 'jdays'], 'readwrite');
      t.objectStore('captures').put(Object.assign(c1, { server_ts: '2026-10-23T13:53:10.000001+00:00', dirty: 0 }));
      t.objectStore('captures').put(Object.assign(c2, { server_ts: '2026-10-23T13:59:10.000001+00:00', dirty: 0 }));
      const j = t.objectStore('journal');
      j.put({ id: L.u1, local_date: '2026-10-23', role: 'user', content: 'copied turn', reply_to: null, model: null, input_tokens: null,
        output_tokens: null, created_at: '2026-10-23T14:00:08.671Z', server_ts: 'old', state: 'sent', error: null });
      j.put({ id: L.a1, local_date: '2026-10-23', role: 'assistant', content: 'copied reply', reply_to: L.u1, model: 'claude-sonnet-5-5',
        input_tokens: 892, output_tokens: 186, created_at: '2026-10-23T14:00:12.691Z', server_ts: 'old', state: 'sent', error: null });
      j.put({ id: L.u2, local_date: '2026-10-23', role: 'user', content: 'failed after the key went', reply_to: null, model: null, input_tokens: null,
        output_tokens: null, created_at: '2026-10-23T14:30:00.000Z', server_ts: null, state: 'error', error: 'anthropic_auth' });
      t.objectStore('jdays').put({ local_date: '2026-10-23', suffix: 'Singapore test', suffix_dirty: 0, server_last_ts: 'old', server_messages: 2 });
      t.objectStore('meta').put({ key: 'schema_version', value: 2 });
      t.objectStore('meta').put({ key: 'pull_cursor', value: { server_ts: '2026-10-23T14:00:12.900001+00:00', id: L.a1 } });
      t.oncomplete = () => { db.close(); resolve(); };
      t.onerror = () => reject(t.error);
    };
    r.onerror = () => reject(r.error);
  }), { L, c1: capL(L.c1, 'copied capture'), c2: capL(L.c2, 'made on v5 after the copy',
    { captured_at: '2026-10-23T13:58:03.643Z', updated_at: '2026-10-23T14:58:05.437Z', deleted_at: '2026-10-23T14:58:05.437Z' }), old: sessionJson() });
  await pl.goto(BASE + 'trip.html');
  await pl.waitForFunction(() => document.getElementById('day-label').textContent !== '-');
  await settle(pl);
  const sL = await pl.evaluate(async () => ({ ref: await meta.get('project_ref'), cursor: await meta.get('pull_cursor'),
    caps: await idb.all('captures'), journal: await idb.all('journal'), jday: await idb.get('jdays', '2026-10-23'),
    auth: Object.keys(localStorage).filter((k) => k.startsWith('tb-auth')) }));
  check('L1 v6 on a v5 phone: session cleared, pull cursor cleared, project_ref recorded',
    sL.auth.length === 0 && sL.cursor === null && sL.ref === 'nnnnonspfljdkrxstslw', JSON.stringify(sL.auth));
  check('L1 nothing deleted: 2 captures (the soft-deleted one kept), 3 journal rows', sL.caps.length === 2 && sL.journal.length === 3
    && sL.caps.some((c) => c.id === L.c2 && c.deleted_at));
  check('L1 every capture dirty again', sL.caps.every((c) => c.dirty === 1 && c.server_ts === null));
  const jl = (id) => sL.journal.find((r) => r.id === id);
  check('L1 sent turn back to pending; failed turn left failed; reply untouched', jl(L.u1).state === 'pending'
    && jl(L.u2).state === 'error' && jl(L.a1).state === 'sent' && jl(L.a1).content === 'copied reply');
  check('L1 day title re-queued and the day re-fetched', sL.jday.suffix_dirty === 1 && sL.jday.server_last_ts === null && sL.jday.server_messages === null);
  check('L1 nothing sent before sign in; pill "sign in, 3 queued"', mockL.calls.length === 0 && (await pill(pl)) === 'sign in, 3 queued', (await pill(pl)) + ' ' + mockL.calls.join(','));
  await pl.evaluate((s) => localStorage.setItem('tb-auth', s), sessionJson());
  await pl.reload();
  await pl.waitForFunction(() => document.getElementById('day-label').textContent !== '-');
  await settle(pl);
  await syncIdle(pl);
  const aL = await pl.evaluate(async () => ({ caps: await idb.all('captures'), journal: await idb.all('journal'), jday: await idb.get('jdays', '2026-10-23') }));
  check('L2 after sign in: both captures on the server, the deleted one still deleted, none dirty', mockL.rows.size === 2
    && !!mockL.rows.get(L.c2).deleted_at && aL.caps.every((c) => c.dirty === 0), `${mockL.rows.size}`);
  check('L2 the copied turn went through tb-journal once and got the stored reply, no Claude call', mockL.fnCalls.length === 1
    && mockL.fnCalls[0].message_id === L.u1 && mockL.claude.length === 0);
  check('L2 still one reply to that turn, same id', aL.journal.filter((r) => r.reply_to === L.u1).length === 1
    && aL.journal.find((r) => r.reply_to === L.u1).id === L.a1 && aL.journal.find((r) => r.id === L.u1).state === 'sent');
  check('L2 the failed turn is not resent automatically', aL.journal.find((r) => r.id === L.u2).state === 'error');
  check('L2 day title on the server, pill synced', (mockL.jdays.get('2026-10-23') || {}).suffix === 'Singapore test'
    && aL.jday.suffix_dirty === 0 && (await pill(pl)) === 'synced', await pill(pl));
  const callsL = mockL.calls.length, fnL = mockL.fnCalls.length;
  await pl.reload();
  await pl.waitForFunction(() => document.getElementById('day-label').textContent !== '-');
  await settle(pl);
  check('L3 next launch: no reset again (session kept, nothing re-queued, nothing resent)', mockL.fnCalls.length === fnL
    && (await pl.evaluate(() => idb.countByIndex('captures', 'dirty', 1))) === 0 && (await pill(pl)) === 'synced'
    && !!(await pl.evaluate(() => localStorage.getItem('tb-auth'))), `${mockL.calls.length - callsL} calls`);

  await browser.close();
  srv.close();
  const failed = results.filter((x) => !x.ok).length;
  console.log(`\n${results.length - failed} of ${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
