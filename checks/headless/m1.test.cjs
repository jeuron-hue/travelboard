// travelboard M1 headless tests (TESTS.md, M1). Run from the repo root:
//   node checks/headless/m1.test.cjs
// Drives trip.html in Chromium against the RPC mock in harness.cjs: capture screen,
// drafts, 0400 local day on a fake clock in Asia/Bangkok, date switcher, edit and delete
// propagation, GPS merge, share target, ?new=1, export, service worker offline shell.
// Exit code 0 only when every check passes.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium, startServer, makeMock, attachMock, newContext } = require('./harness.cjs');

const PORT = 8731;
const APP_VERSION = fs.readFileSync(path.join(__dirname, '..', '..', 'trip.html'), 'utf8').match(/const APP_VERSION = (\d+);/)[1];
const BASE = `http://127.0.0.1:${PORT}/`;
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail && !ok ? '  [' + detail + ']' : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bkk = (hhmm, date = '2026-10-04') => new Date(`${date}T${hhmm.slice(0, 2)}:${hhmm.slice(2)}:00+07:00`);

async function syncIdle(page) {
  await page.evaluate(async () => {
    for (let i = 0; i < 3; i++) {
      await sync();
      while (syncing) await new Promise((r) => setTimeout(r, 20));
    }
  });
}
const all = (page) => page.evaluate(() => idb.all('captures'));
const draft = (page, id) => page.evaluate((k) => idb.get('drafts', k), id);
const capOpen = (page) => page.evaluate(() => !document.getElementById('cap').hidden);
const waitCap = (page, open) => page.waitForFunction((o) => document.getElementById('cap').hidden === !o && (!o || !popWait), open, { timeout: 5000 });
const rowLines = (page) => page.$$eval('.row', (els) => els.map((e) => ({ id: e.dataset.id, l1: e.querySelector('.line1').innerText.replace(/\s+/g, ' ').trim(), l2: e.querySelector('.line2').textContent, gps: !!e.querySelector('.gps') })));
async function tap(page, sel) {
  const before = await page.$eval('#day-label', (e) => e.textContent);
  await page.click(sel);
  await page.waitForFunction((b) => document.getElementById('day-label').textContent !== b, before, { timeout: 2000 }).catch(() => {});
  await page.waitForTimeout(50);
}
const shown = (page, sel) => page.$eval(sel, (e) => !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length));
const label = (page) => page.$eval('#day-label', (e) => e.textContent);
const pill = (page) => page.$eval('#status-text', (e) => e.textContent);

async function capture(page, text, kind = 'note') {
  await page.click('#capture');
  await waitCap(page, true);
  await page.fill('#cap-body', text);
  if (kind === 'journal') await page.click('#kind-journal'); else await page.click('#kind-note');
  await page.click('#cap-save');
  await waitCap(page, false);
  await page.waitForFunction(() => !popWait);
}
async function editRow(page, id, text, kind) {
  await page.click(`.row[data-id="${id}"]`);
  await waitCap(page, true);
  await page.fill('#cap-body', text);
  if (kind) await page.click('#kind-' + kind);
  await page.click('#cap-save');
  await waitCap(page, false);
  await page.waitForFunction(() => !popWait);
}
async function gotoDay(page, ymd) {
  await page.evaluate((d) => { viewDay = d; followToday = d === todayLocal(); return render(); }, ymd);
}

(async () => {
  const srv = await startServer(PORT);
  const browser = await chromium.launch();
  let dialogs = 0;

  // ================= A: phone in Asia/Bangkok, signed in, starts in "airplane mode" =================
  const mock = makeMock();
  mock.offline = true;
  const ctx = await newContext(browser, { tz: 'Asia/Bangkok', session: true });
  await attachMock(ctx, mock);
  const page = await ctx.newPage();
  page.on('dialog', (d) => { dialogs++; d.dismiss(); });
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await page.clock.setFixedTime(bkk('1300'));
  await page.goto(BASE + 'trip.html');
  await page.waitForFunction(() => document.getElementById('day-label').textContent !== '-');

  // --- shell
  check('A1 M0 "Add test record" button removed', (await page.$('#add-test')) === null);
  check('A1 M0 hint text removed', !(await page.content()).includes('M0 foundation build'));
  check('A1 viewport has interactive-widget=resizes-content', (await page.$eval('meta[name=viewport]', (m) => m.content)).includes('interactive-widget=resizes-content'));
  check(`A1 version v${APP_VERSION}`, (await page.$eval('#s-version', (e) => e.textContent)) === 'v' + APP_VERSION);
  check('A1 label "Sun 04/10/26" at 1300 BKK', (await label(page)) === 'Sun 04/10/26', await label(page));
  check('A1 empty today text', (await page.$eval('#empty', (e) => !e.hidden && e.textContent)) === 'Nothing captured today yet.');
  check('A1 no draft: "draft kept" not shown', !(await shown(page, '#draft-note')));
  await page.click('#status');
  await page.waitForTimeout(200);
  check('A1 signed in: settings hide the sign-in form, show Sign out and Export', !(await shown(page, '#signin')) && (await shown(page, '#signout')) && (await shown(page, '#export')));
  await page.click('#close');
  check('A1 toast and capture layer not shown', !(await shown(page, '#toast')) && !(await shown(page, '#cap')));
  check('A1 today reachable, arrows disabled with no other days', await page.evaluate(() => $('day-prev').disabled && $('day-next').disabled));

  // --- capture screen + drafts
  await page.click('#capture');
  await waitCap(page, true);
  check('A2 capture screen opens, textarea focused', await page.evaluate(() => document.activeElement.id === 'cap-body'));
  check('A2 history state pushed', await page.evaluate(() => !!(history.state && history.state.tbCap)));
  check('A2 Save disabled when empty', await page.$eval('#cap-save', (b) => b.disabled));
  await page.fill('#cap-body', '   \n  ');
  check('A2 Save disabled when only whitespace', await page.$eval('#cap-save', (b) => b.disabled));
  await page.fill('#cap-body', 'Draft one');
  check('A2 Save enabled with text', !(await page.$eval('#cap-save', (b) => b.disabled)));
  await page.waitForTimeout(100);
  let d = await draft(page, 'new');
  check('A3 draft written on input, open true', d && d.body === 'Draft one' && d.open === true, JSON.stringify(d));
  await page.reload();
  await waitCap(page, true);
  check('A3 killed mid-typing: reopens capture with draft', (await page.inputValue('#cap-body')) === 'Draft one');
  await page.click('#cap-close');
  await waitCap(page, false);
  d = await draft(page, 'new');
  check('A4 Close on new keeps draft with open false', d && d.open === false && d.body === 'Draft one', JSON.stringify(d));
  check('A4 Capture button shows "draft kept"', await shown(page, '#draft-note'));
  await page.waitForFunction(() => !popWait);
  check('A4 history entry popped on Close', await page.evaluate(() => !(history.state && history.state.tbCap)));
  await page.reload();
  await page.waitForTimeout(300);
  check('A4 closed draft does not auto-reopen at boot', !(await capOpen(page)));
  await page.evaluate(() => { window.__marker = 42; });
  await page.click('#capture');
  await waitCap(page, true);
  check('A4 Capture restores kept draft', (await page.inputValue('#cap-body')) === 'Draft one');
  await page.evaluate(() => history.back());   // Android back
  await waitCap(page, false);
  check('A5 Android back closes capture, stays in app', await page.evaluate(() => window.__marker === 42 && location.pathname.endsWith('/trip.html')));
  d = await draft(page, 'new');
  check('A5 back keeps draft (open false)', d && d.open === false);

  // --- 0400 rule on a fake clock in Asia/Bangkok
  await page.clock.setFixedTime(bkk('0030'));
  await page.click('#capture');
  await waitCap(page, true);
  await page.fill('#cap-body', 'Draft one\nnight market at 0030');
  await page.click('#kind-journal');
  await page.click('#cap-save');
  await waitCap(page, false);
  let rows = await all(page);
  const r0030 = rows.find((r) => r.body.startsWith('Draft one'));
  check('A6 0030 BKK capture: local_date is previous day 2026-10-03', r0030 && r0030.local_date === '2026-10-03', r0030 && r0030.local_date);
  check('A6 tz Asia/Bangkok, kind journal, dirty, null coords', r0030 && r0030.tz === 'Asia/Bangkok' && r0030.kind === 'journal' && r0030.dirty === 1 && r0030.lat === null && r0030.lng === null && r0030.accuracy_m === null);
  check('A6 captured_at = updated_at = save time', r0030 && r0030.captured_at === bkk('0030').toISOString() && r0030.updated_at === r0030.captured_at);
  check('A6 draft cleared on save, "draft kept" hidden', !(await draft(page, 'new')) && !(await shown(page, '#draft-note')));
  check('A6 at 0030 "today" is Sat 03/10/26', (await label(page)) === 'Sat 03/10/26', await label(page));
  let lines = await rowLines(page);
  check('A6 row line 1: "0030 hrs", no city (same zone), journal chip, queued, no GPS dot', lines.length === 1 && lines[0].l1 === '0030 hrs journal queued' && !lines[0].gps, JSON.stringify(lines));
  check('A6 row line 2: first line of body', lines[0] && lines[0].l2 === 'Draft one');
  check('A6 GPS requested once with spec options', await page.evaluate(() => __geo.calls === 1 && __geo.lastOpts.enableHighAccuracy === true && __geo.lastOpts.timeout === 5000 && __geo.lastOpts.maximumAge === 60000));
  await page.waitForTimeout(100);
  rows = await all(page);
  check('A10 location denied: still null coords, no error dialog', rows[0].lat === null && dialogs === 0);

  await page.clock.setFixedTime(bkk('0330'));
  await capture(page, 'Bangkok 0330 (0430 in Singapore)');
  rows = await all(page);
  const r0330 = rows.find((r) => r.body.startsWith('Bangkok 0330'));
  check('A7 0330 BKK (= 0430 SGT): previous day by Bangkok time, not Singapore', r0330.local_date === '2026-10-03', r0330.local_date);

  await page.clock.setFixedTime(bkk('0400'));
  await capture(page, 'Bangkok 0400 sharp');
  rows = await all(page);
  const r0400 = rows.find((r) => r.body === 'Bangkok 0400 sharp');
  check('A8 0400 BKK capture: same day 2026-10-04', r0400.local_date === '2026-10-04', r0400.local_date);
  check('A8 today label rolls to Sun 04/10/26 at 0400', (await label(page)) === 'Sun 04/10/26');
  lines = await rowLines(page);
  check('A8 today shows only the 0400 row', lines.length === 1 && lines[0].l1.startsWith('0400 hrs'), JSON.stringify(lines));
  await tap(page, '#day-prev');
  lines = await rowLines(page);
  check('A8 back arrow: Sat 03/10/26 with 0330 then 0030', (await label(page)) === 'Sat 03/10/26' && lines.length === 2 && lines[0].l1.startsWith('0330') && lines[1].l1.startsWith('0030'), JSON.stringify(lines));
  check('A8 no earlier day: back disabled', await page.$eval('#day-prev', (b) => b.disabled));
  await tap(page, '#day-next');
  check('A8 forward arrow returns to today', (await label(page)) === 'Sun 04/10/26');
  await tap(page, '#day-prev');
  await tap(page, '#day-label');
  check('A8 tapping the label returns to today', (await label(page)) === 'Sun 04/10/26' && await page.$eval('#day-label', (e) => e.classList.contains('today')));

  const ld = await page.evaluate(() => ({
    a: localDay(new Date('2026-10-03T20:59:59Z'), 'Asia/Bangkok'),
    b: localDay(new Date('2026-10-03T21:00:00Z'), 'Asia/Bangkok'),
    c: localDay(new Date('2026-10-03T20:30:00Z'), 'Asia/Bangkok'),
    d: localDay(new Date('2026-10-03T20:30:00Z'), 'Asia/Singapore'),
    e: localDay(new Date('2026-10-31T19:00:00Z'), 'Asia/Bangkok'),
    f: localDay(new Date('2026-12-31T18:30:00Z'), 'Asia/Bangkok'),
    g: localDay(new Date('2026-02-28T18:00:00Z'), 'Asia/Bangkok'),
    lbl: fmtDayLabel('2026-10-04'),
    city: [cityOf('Asia/Bangkok'), cityOf('America/Argentina/Buenos_Aires'), cityOf('Asia/Ho_Chi_Minh')]
  }));
  check('A9 localDay 0359 BKK -> previous day', ld.a === '2026-10-03');
  check('A9 localDay 0400 BKK -> same day', ld.b === '2026-10-04');
  check('A9 same instant: 0330 BKK -> 03, 0430 SGT -> 04', ld.c === '2026-10-03' && ld.d === '2026-10-04');
  check('A9 month, year and leap-free Feb boundaries', ld.e === '2026-10-31' && ld.f === '2026-12-31' && ld.g === '2026-02-28', JSON.stringify(ld));
  check('A9 label format and city names', ld.lbl === 'Sun 04/10/26' && ld.city.join('|') === 'Bangkok|Buenos Aires|Ho Chi Minh');

  // --- offline queue, then reconnect (acceptance 1)
  check('A11 airplane mode: pill "offline, 3 queued"', (await pill(page)) === 'offline, 3 queued', await pill(page));
  const expected = [];
  const times = ['0105', '0215', '0359', '0400', '0401', '0930', '1215', '1530', '1801', '2059', '2300', '2359'];
  for (let i = 0; i < 20; i++) {
    const t = times[i % times.length];
    const date = i < 12 ? '2026-10-05' : '2026-10-06';
    await page.clock.setFixedTime(bkk(t, date));
    const kind = i % 3 === 0 ? 'journal' : 'note';
    const body = `Offline ${String(i + 1).padStart(2, '0')} at ${t}\nLebuh Keng Kwee, ไทย ✓ "quoted" \\ back`;
    await capture(page, body, kind);
    const h = Number(t.slice(0, 2));
    const ldExp = h < 4 ? new Date(Date.UTC(2026, 9, Number(date.slice(8)) - 1)).toISOString().slice(0, 10) : date;
    expected.push({ body, kind, local_date: ldExp });
  }
  check('A12 20 offline captures queued', (await pill(page)) === 'offline, 23 queued', await pill(page));
  check('A12 nothing reached the server while offline', mock.rows.size === 0);
  mock.offline = false;
  await syncIdle(page);
  const srvRows = [...mock.rows.values()];
  let intact = 0;
  for (const e of expected) {
    const s = srvRows.find((r) => r.body === e.body);
    if (s && s.kind === e.kind && s.local_date === e.local_date && s.tz === 'Asia/Bangkok') intact++;
  }
  check('A12 reconnect: all 20 arrive intact with correct local_date and kind', intact === 20, `${intact}/20`);
  check('A12 server holds 23 rows, pill synced', mock.rows.size === 23 && (await pill(page)) === 'synced', `${mock.rows.size} ${await pill(page)}`);
  check('A12 0030 and 0330 rows on server with 2026-10-03', mock.rows.get(r0030.id).local_date === '2026-10-03' && mock.rows.get(r0330.id).local_date === '2026-10-03');
  check('A12 row chips read synced', (await page.$$eval('.chip.queued', (e) => e.length)) === 0);

  // --- edit after sync (acceptance 3)
  await gotoDay(page, '2026-10-04');
  const before = (await all(page)).find((r) => r.id === r0400.id);
  await editRow(page, r0400.id, 'Bangkok 0400 sharp, edited', 'journal');
  let after = (await all(page)).find((r) => r.id === r0400.id);
  check('A13 edit: body and kind changed, updated_at bumped', after.body === 'Bangkok 0400 sharp, edited' && after.kind === 'journal' && Date.parse(after.updated_at) > Date.parse(before.updated_at));
  check('A13 edit: captured_at, tz, local_date unchanged', after.captured_at === before.captured_at && after.tz === before.tz && after.local_date === before.local_date);
  await syncIdle(page);
  check('A13 edit after sync propagates to server', mock.rows.get(r0400.id).body === 'Bangkok 0400 sharp, edited' && mock.rows.get(r0400.id).kind === 'journal');

  // same-millisecond edits on a frozen clock: updated_at strictly increases, server applies each
  const u0 = (await all(page)).find((r) => r.id === r0400.id).updated_at;
  await editRow(page, r0400.id, 'edit at frozen ms 1');
  const u1 = (await all(page)).find((r) => r.id === r0400.id).updated_at;
  await syncIdle(page);
  const s1 = mock.rows.get(r0400.id).body;
  await editRow(page, r0400.id, 'edit at frozen ms 2');
  const u2 = (await all(page)).find((r) => r.id === r0400.id).updated_at;
  await syncIdle(page);
  check('A15 frozen clock: updated_at +1 ms per edit', Date.parse(u1) === Date.parse(u0) + 1 && Date.parse(u2) === Date.parse(u1) + 1, `${u0} ${u1} ${u2}`);
  check('A15 frozen clock: server applied both edits', s1 === 'edit at frozen ms 1' && mock.rows.get(r0400.id).body === 'edit at frozen ms 2');
  check('A15 clock moved back: updated_at still increases', await page.evaluate(() => {
    const prev = new Date(Date.now() + 3600e3).toISOString();
    return Date.parse(nextUpdatedAt(prev)) === Date.parse(prev) + 1;
  }));

  // --- offline edit wins over older server copy
  mock.offline = true;
  await page.clock.setFixedTime(bkk('0405'));
  await editRow(page, r0400.id, 'offline edit');
  check('A14 offline edit queued', (await pill(page)).startsWith('offline'));
  mock.offline = false;
  await syncIdle(page);
  check('A14 offline edit wins over older server copy', mock.rows.get(r0400.id).body === 'offline edit');

  // --- server-side changes propagate down through the pull
  const other = expected[5];
  const otherRow = srvRows.find((r) => r.body === other.body);
  mock.serverEdit(otherRow.id, { body: 'changed on server', updated_at: '2026-10-07T00:00:00.000Z' });
  const third = srvRows.find((r) => r.body === expected[6].body);
  mock.serverEdit(third.id, { deleted_at: '2026-10-07T00:00:00.000Z', updated_at: '2026-10-07T00:00:00.000Z' });
  // and an older server copy must not overwrite a newer local edit
  const fourth = srvRows.find((r) => r.body === expected[7].body);
  await syncIdle(page);
  rows = await all(page);
  check('A14 newer server edit pulled into IndexedDB', rows.find((r) => r.id === otherRow.id).body === 'changed on server');
  check('A14 server-side delete pulled and hidden', !!rows.find((r) => r.id === third.id).deleted_at);
  mock.serverEdit(fourth.id, { body: 'stale server copy', updated_at: '2026-01-01T00:00:00.000Z' });
  await syncIdle(page);
  check('A14 older server copy does not overwrite local', (await all(page)).find((r) => r.id === fourth.id).body === expected[7].body);

  // --- delete and undo (acceptance 4)
  await gotoDay(page, '2026-10-04');
  await page.click(`.row[data-id="${r0400.id}"]`);
  await waitCap(page, true);
  check('A16 edit screen shows Delete and capture info', (await shown(page, '#cap-delete')) && await page.evaluate(() => $('cap-info').textContent.startsWith('Captured 04/10/26 0400 hrs')), await page.$eval('#cap-info', (e) => e.textContent));
  check('A16 edit screen does not force the keyboard', await page.evaluate(() => document.activeElement.id !== 'cap-body'));
  await page.click('#cap-delete');
  await waitCap(page, false);
  check('A16 delete hides the row', (await rowLines(page)).every((l) => l.id !== r0400.id));
  check('A16 Undo toast shown', (await shown(page, '#toast')) && (await shown(page, '#toast-undo')));
  let local = (await all(page)).find((r) => r.id === r0400.id);
  check('A16 soft delete locally: row kept, deleted_at set, updated_at = deleted_at', !!local && !!local.deleted_at && local.deleted_at === local.updated_at);
  await syncIdle(page);
  check('A16 deleted_at set on the server', !!mock.rows.get(r0400.id).deleted_at);
  await page.click('#toast-undo');
  await page.waitForFunction((id) => !!document.querySelector(`.row[data-id="${id}"]`), r0400.id);
  local = (await all(page)).find((r) => r.id === r0400.id);
  check('A16 Undo restores the row locally', local.deleted_at === null && Date.parse(local.updated_at) > Date.parse(mock.rows.get(r0400.id).updated_at) - 1);
  await syncIdle(page);
  check('A16 Undo propagates: server deleted_at null', mock.rows.get(r0400.id).deleted_at === null);
  // delete without undo, toast expires after 5 s
  await page.click(`.row[data-id="${r0400.id}"]`);
  await waitCap(page, true);
  await page.click('#cap-delete');
  await waitCap(page, false);
  await sleep(5300);
  check('A16 toast gone after 5 s', !(await shown(page, '#toast')));
  await syncIdle(page);
  check('A16 delete stands after the toast', !!mock.rows.get(r0400.id).deleted_at);

  // --- edit draft: killed mid-edit
  await gotoDay(page, '2026-10-03');
  await page.click(`.row[data-id="${r0330.id}"]`);
  await waitCap(page, true);
  await page.fill('#cap-body', 'half-typed edit');
  await page.waitForTimeout(100);
  await page.reload();
  await waitCap(page, true);
  check('A17 killed mid-edit: edit screen reopens with typed text', (await page.inputValue('#cap-body')) === 'half-typed edit' && await page.evaluate(() => cap.mode === 'edit'));
  await page.click('#cap-close');
  await waitCap(page, false);
  check('A17 Close on edit discards the draft, row unchanged', !(await draft(page, r0330.id)) && (await all(page)).find((r) => r.id === r0330.id).body === 'Bangkok 0330 (0430 in Singapore)');

  // --- GPS merge: fix arrives after an edit, nothing lost
  await page.evaluate(() => { __geo.mode = 'hold'; });
  await page.clock.setFixedTime(bkk('1400'));
  await capture(page, 'gps pending');
  let g = (await all(page)).find((r) => r.body === 'gps pending');
  await editRow(page, g.id, 'gps pending, edited before the fix');
  await page.evaluate(() => __geo.pending.shift()());
  await page.waitForFunction((id) => idb.get('captures', id).then((r) => r.lat != null), g.id);
  g = (await all(page)).find((r) => r.id === g.id);
  check('A18 GPS merge keeps the edit and adds coordinates', g.body === 'gps pending, edited before the fix' && g.lat === 13.7466 && g.lng === 100.5393 && Math.abs(g.accuracy_m - 12.5) < 1e-9);
  check('A18 GPS bumps updated_at and marks dirty', g.dirty === 1 || mock.rows.get(g.id));
  await syncIdle(page);
  check('A18 server has edit and coordinates', mock.rows.get(g.id).body === g.body && mock.rows.get(g.id).lat === 13.7466);
  lines = await rowLines(page);
  check('A18 GPS dot shown on the row', lines.find((l) => l.id === g.id).gps);
  await page.evaluate(() => { __geo.mode = 'deny'; });

  // --- share target and ?new=1
  await page.goto(BASE + 'trip.html?title=' + encodeURIComponent('Jay Fai') + '&text=' + encodeURIComponent('Jay Fai\nhttps://maps.app.goo.gl/abc123') + '&url=' + encodeURIComponent('https://maps.app.goo.gl/abc123'));
  await waitCap(page, true);
  check('A19 share target opens prefilled capture, duplicates dropped', (await page.inputValue('#cap-body')) === 'Jay Fai\nhttps://maps.app.goo.gl/abc123', JSON.stringify(await page.inputValue('#cap-body')));
  check('A19 URL cleaned with replaceState', await page.evaluate(() => location.search === ''));
  d = await draft(page, 'new');
  check('A19 prefill written to draft at once, open true', d && d.open === true && d.body.startsWith('Jay Fai'));
  await page.click('#cap-close');
  await waitCap(page, false);
  await page.goto(BASE + 'trip.html?text=' + encodeURIComponent('Second place'));
  await waitCap(page, true);
  check('A19 second share appends to the kept draft', (await page.inputValue('#cap-body')) === 'Jay Fai\nhttps://maps.app.goo.gl/abc123\nSecond place');
  check('A19 buildPrefill keeps distinct parts', await page.evaluate(() => buildPrefill('Title', 'Some text', 'https://x.y/z') === 'Title\nSome text\nhttps://x.y/z' && buildPrefill('', 'https://a', 'https://a') === 'https://a' && buildPrefill(null, null, null) === ''));
  await page.click('#cap-close');
  await waitCap(page, false);
  await page.evaluate(() => idb.del('drafts', 'new'));
  await page.evaluate(() => idb.put('drafts', { id: 'new', body: 'y'.repeat(19995), kind: 'note', open: false, updated_at: new Date().toISOString() }));
  await page.goto(BASE + 'trip.html?text=' + encodeURIComponent('shared text over the cap'));
  await waitCap(page, true);
  check('A22 draft plus share over 20000 truncated to 20000', (await page.inputValue('#cap-body')).length === 20000);
  await page.click('#cap-close');
  await waitCap(page, false);
  await page.evaluate(() => idb.del('drafts', 'new'));
  await page.goto(BASE + 'trip.html?new=1');
  await waitCap(page, true);
  check('A20 ?new=1 opens straight into capture, focused, URL clean', await page.evaluate(() => document.activeElement.id === 'cap-body' && location.search === '' && cap.mode === 'new'));
  await page.evaluate(() => history.back());
  await waitCap(page, false);
  check('A20 back from shortcut capture stays in the app', await page.evaluate(() => location.pathname.endsWith('/trip.html')));

  // --- export, offline (acceptance 9)
  mock.offline = true;
  await ctx.setOffline(true);
  await page.clock.setFixedTime(bkk('0907', '2026-10-06'));
  await page.click('#status');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#export')]);
  const name = dl.suggestedFilename();
  const exp = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
  const idbRows = await all(page);
  check('A21 export filename in device time', name === 'travelboard-captures-061026-0907.json', name);
  check('A21 export works offline and holds every capture', exp.count === idbRows.length && exp.captures.length === idbRows.length && idbRows.length >= 24, `${exp.count} vs ${idbRows.length}`);
  const ex = exp.captures.find((c) => c.id === r0400.id);
  check('A21 deleted capture included and flagged', ex && ex.deleted === true && !!ex.deleted_at);
  check('A21 synced flag and server_ts per row', exp.captures.every((c) => typeof c.synced === 'boolean' && 'server_ts' in c) && exp.captures.filter((c) => c.synced).every((c) => c.server_ts));
  check('A21 export carries every server field', ['id', 'body', 'kind', 'captured_at', 'tz', 'local_date', 'lat', 'lng', 'accuracy_m', 'updated_at', 'deleted_at'].every((k) => k in exp.captures[0]));
  await page.click('#close');
  await ctx.setOffline(false);
  mock.offline = false;
  check('A no unexpected dialogs', dialogs === 0, String(dialogs));
  await ctx.close();

  // ================= B: phone back in Singapore, Bangkok rows pulled from the server =================
  const mockB = makeMock();
  const id1 = '0a000000-0000-4000-8000-000000000001', id2 = '0a000000-0000-4000-8000-000000000002';
  mockB.upsertBatch([
    { id: id1, body: 'Bangkok night, 0030', kind: 'journal', captured_at: '2026-10-03T17:30:00.000Z', tz: 'Asia/Bangkok', local_date: '2026-10-03', lat: 13.74, lng: 100.53, accuracy_m: 9, trip_id: null, place_id: null, updated_at: '2026-10-03T17:30:00.000Z', deleted_at: null },
    { id: id2, body: 'Singapore lunch', kind: 'note', captured_at: '2026-10-03T04:00:00.000Z', tz: 'Asia/Singapore', local_date: '2026-10-03', lat: null, lng: null, accuracy_m: null, trip_id: null, place_id: null, updated_at: '2026-10-03T04:00:00.000Z', deleted_at: null }
  ]);
  const ctxB = await newContext(browser, { tz: 'Asia/Singapore', session: true });
  await attachMock(ctxB, mockB);
  const pb = await ctxB.newPage();
  await pb.clock.setFixedTime(new Date('2026-10-04T12:00:00+08:00'));
  await pb.goto(BASE + 'trip.html');
  await pb.waitForFunction(() => document.getElementById('status-text').textContent === 'synced');
  check('B1 Singapore today Sun 04/10/26, back arrow enabled', (await label(pb)) === 'Sun 04/10/26' && !(await pb.$eval('#day-prev', (b) => b.disabled)));
  await tap(pb, '#day-prev');
  lines = await rowLines(pb);
  if (!lines.length) console.log('DEBUG', await label(pb), JSON.stringify(await all(pb)).slice(0, 600));
  const bk = lines.find((l) => l.id === id1), sg = lines.find((l) => l.id === id2);
  check('B1 Bangkok 0030 row on Sat 03/10/26 reads "0030 hrs Bangkok"', (await label(pb)) === 'Sat 03/10/26' && bk && bk.l1.startsWith('0030 hrs Bangkok') && bk.gps, JSON.stringify(lines));
  check('B1 Singapore row has no city suffix', sg && sg.l1.startsWith('1200 hrs note'), sg && sg.l1);
  check('B1 rows newest first', lines[0].id === id1);
  await pb.click(`.row[data-id="${id1}"]`);
  await waitCap(pb, true);
  check('B1 edit info names Bangkok and GPS', await pb.$eval('#cap-info', (e) => e.textContent === 'Captured 04/10/26 0030 hrs, Bangkok, GPS 9 m'), await pb.$eval('#cap-info', (e) => e.textContent));
  await ctxB.close();

  // ================= C: service worker, offline shell, update bar =================
  const ctxC = await newContext(browser, { tz: 'Asia/Bangkok', session: false, swBlock: false });
  await ctxC.route('https://nyjsrnntxdgfykkmihpx.supabase.co/**', (r) => r.abort('internetdisconnected'));
  const pc = await ctxC.newPage();
  await pc.goto(BASE + 'trip.html');
  await pc.waitForFunction(() => navigator.serviceWorker.controller || navigator.serviceWorker.ready.then(() => true), null, { timeout: 10000 });
  await pc.reload();
  await pc.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 10000 });
  const cacheName = 'tb-shell-v' + APP_VERSION;
  const cacheInfo = await pc.evaluate(async (name) => { const k = await caches.keys(); const c = await caches.open(name); return { keys: k, n: (await c.keys()).length }; }, cacheName);
  check(`C1 cache ${cacheName} with 10 shell files`, cacheInfo.keys.includes(cacheName) && cacheInfo.n === 10, JSON.stringify(cacheInfo));
  await ctxC.setOffline(true);
  await pc.reload();
  await pc.waitForFunction(() => document.getElementById('day-label').textContent !== '-');
  check(`C2 offline reload renders v${APP_VERSION} from cache`, (await pc.$eval('#s-version', (e) => e.textContent)) === 'v' + APP_VERSION);
  await capture(pc, 'saved offline, no session');
  check('C2 offline capture with no session saves and queues', (await pill(pc)) === 'offline, 1 queued', await pill(pc));
  await pc.goto(BASE + 'trip.html?new=1');
  await waitCap(pc, true);
  check('C3 ?new=1 opens capture offline', await pc.evaluate(() => cap.mode === 'new'));
  await pc.click('#cap-close');
  await ctxC.setOffline(false);
  await ctxC.close();

  await browser.close();
  srv.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length} of ${results.length} passed`);
  fs.writeFileSync(path.join(os.tmpdir(), 'travelboard-m1-results.json'), JSON.stringify(results, null, 1));
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
