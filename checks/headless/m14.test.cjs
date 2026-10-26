// travelboard M1.4 headless tests (TESTS.md, M1.4). Run from the repo root:
//   node checks/headless/m14.test.cjs
// Drives trip.html in Chromium against harness.cjs, with Gary's and Eric's phones on one mock.
// SPEC.md 7D (26/10/26): the Days link on the Captures day bar and the day list. Counts of
// captures and photos (singular forms, photos left out when none), partner captures counted,
// soft-deleted captures not, unshared ones of the partner absent; the first one or two distinct
// place names a person set, in time order (never coordinates, case duplicates as one, none
// when no named place); newest first with today always there; the journal day list's look in
// light and dark; a tap opens the day and stops following today, the arrows step on from it;
// Today returns to today's day view; the date tap and the arrows unchanged; IndexedDB only (no
// request when the list opens); offline, the list shows and opens days and a capture saved
// from it returns to today's view; the list redrawn after a sync, the idle sync included;
// the list kept across a switch to Journal and back.
// Exit code 0 only when every check passes.
'use strict';
const fs = require('fs');
const { until, launch, startServer, makeMock, attachMock, newContext, UID, ERIC_UID } = require('./harness.cjs');

const PORT = 8736;
const BASE = `http://127.0.0.1:${PORT}/`;
const APP = fs.readFileSync(require('path').join(__dirname, '..', '..', 'trip.html'), 'utf8').match(/const APP_VERSION = '([0-9.]+)';/)[1];
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail && !ok ? '  [' + detail + ']' : '')); };

const waitCap = (page, open) => page.waitForFunction((o) => document.getElementById('cap').hidden === !o && (!o || !popWait), open, { timeout: 5000 });
const shown = (page, sel) => page.$eval(sel, (e) => !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length));
const text = (page, sel) => page.$eval(sel, (e) => e.textContent);
// The list as drawn: one entry per row, in order.
const listRows = (page) => page.$$eval('#day-list .dayrow', (els) => els.map((b) => ({
  day: b.dataset.day, when: b.querySelector('.when').textContent, today: b.querySelector('.when').classList.contains('today'),
  counts: b.querySelector('.line2').textContent, places: b.querySelector('.places') ? b.querySelector('.places').textContent : null
})));
const rowOf = async (page, day) => (await listRows(page)).find((r) => r.day === day) || null;
async function syncIdle(page) {
  await page.evaluate(async () => {
    for (let i = 0; i < 3; i++) {
      await sync();
      while (syncing) await new Promise((r) => setTimeout(r, 20));
    }
  });
}
async function openList(page) {
  if ((await text(page, '#day-days')) !== 'Days') return;
  await page.click('#day-days');
  await page.waitForFunction(() => !document.getElementById('day-list').hidden);
}

(async () => {
  const srv = await startServer(PORT);
  const browser = await launch();
  const mock = makeMock();
  const phones = {};
  for (const [who, uid] of [['gary', UID], ['eric', ERIC_UID]]) {
    const ctx = await newContext(browser, { tz: 'Asia/Singapore', session: true, uid });
    const net = { offline: false, name: who };
    await attachMock(ctx, mock, net);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.log('PAGEERROR', who, e.message));
    page.on('dialog', (d) => { check(`no browser dialog (${who}): ` + d.message(), false); d.dismiss(); });
    await page.goto(BASE + 'trip.html');
    await page.waitForFunction(() => document.getElementById('day-label').textContent !== '-');
    phones[who] = { ctx, page, net };
  }
  const { page: G, ctx: gctx, net: gnet } = phones.gary;
  const offline = async (on) => { gnet.offline = on; await gctx.setOffline(on); await G.evaluate((o) => window.dispatchEvent(new Event(o ? 'offline' : 'online')), on); };

  try {
    // ---------- seed: Gary's own rows and Eric's, on the server ----------
    const today = await G.evaluate(() => todayLocal());
    const day = (n) => G.evaluate((x) => addDays(todayLocal(), x), n);
    const D1 = await day(-1), D2 = await day(-2), D3 = await day(-3), D4 = await day(-4);
    let n = 0;
    const cap = (owner, d, hm, extra = {}) => {
      n++;
      const id = `0000000${n}`.slice(-8) + '-1111-4111-8111-' + String(n).padStart(12, '0');
      const at = new Date(`${d}T${hm}:00+08:00`).toISOString();
      return Object.assign({ id, body: `cap ${n}`, kind: 'note', captured_at: at, updated_at: at, tz: 'Asia/Singapore', local_date: d,
        lat: 1.3526, lng: 103.9447, accuracy_m: 10, deleted_at: null, photo_path: null, shared: false }, extra, extra.photo ? { photo: undefined, photo_path: `${owner}/${id}.jpg` } : {});
    };
    const garyRows = [
      cap(UID, D1, '08:00', { place_name: 'Deleted Place', photo: true, deleted_at: new Date().toISOString() }),   // earliest, but deleted
      cap(UID, D1, '09:00', { place_name: 'Tampines Mall', photo: true }),
      cap(UID, D1, '10:00', { place_name: 'tampines mall ' }),             // the same name in other case
      cap(UID, D1, '11:00', {}),                                              // coordinates only
      cap(UID, D1, '13:00', { place_name: 'Jewel', photo: true }),
      cap(UID, D1, '15:00', { place_name: 'Third Place' }),
      cap(UID, D2, '12:00', { lat: null, lng: null, accuracy_m: null }),      // no GPS, no name
      cap(UID, D4, '12:00', { place_name: 'Gone', deleted_at: new Date().toISOString() })   // a day with only a deleted capture
    ];
    const ericRows = [
      cap(ERIC_UID, D1, '07:00', { place_name: 'Eric Cafe', photo: true, shared: true }),   // the day's earliest named place
      cap(ERIC_UID, D2, '09:00', { place_name: 'Eric Secret', shared: false }),             // unshared: never on Gary's phone
      cap(ERIC_UID, D3, '09:00', { shared: true })                                          // a day of Eric's only
    ];
    for (const r of garyRows.concat(ericRows)) if (r.photo_path) mock.objects.set(r.photo_path, { bytes: Buffer.from([0xff, 0xd8, 0xff, 0xd9]), contentType: 'image/jpeg' });
    mock.upsertBatch(garyRows.map((r) => { const x = Object.assign({}, r); delete x.photo; return x; }), UID);
    mock.upsertBatch(ericRows.map((r) => { const x = Object.assign({}, r); delete x.photo; return x; }), ERIC_UID);
    mock.partnerAdd(ERIC_UID, UID); mock.partnerAdd(UID, ERIC_UID);
    await syncIdle(G);
    await G.evaluate(() => { followToday = true; return render(); });

    // ---------- the day bar (7D.2, item 1) ----------
    check(`L0 v${APP}`, APP === '0.15.0' && (await G.evaluate(() => APP_VERSION)) === '0.15.0', APP);
    const bar = await G.evaluate(() => {
      const d = document.getElementById('day-days'), j = document.getElementById('j-days');
      const cs = getComputedStyle(d), js = getComputedStyle(j);
      return { inArrows: d.parentElement.classList.contains('arrows') && d.nextElementSibling === document.getElementById('day-prev'),
        text: d.textContent, cls: d.className, h: d.getBoundingClientRect().height,
        same: cs.fontSize === js.fontSize && cs.fontWeight === js.fontWeight && cs.textDecorationLine === js.textDecorationLine };
    });
    check('L1 a Days link beside the arrows, in the style of the journal\'s Days link, at least 44 px high',
      bar.inArrows && bar.text === 'Days' && bar.cls === 'link' && bar.same && bar.h >= 44, JSON.stringify(bar));
    check('L1 day view: arrows, the date and the city line show; the list is hidden',
      await shown(G, '#day-prev') && await shown(G, '#day-next') && await shown(G, '#day-sub') && !(await shown(G, '#day-list')) && await shown(G, '#records'));
    const callsBefore = mock.calls.length;
    await openList(G);
    check('L2 Days shows the list in place of the records; the link reads Today; title "Capture days"; arrows and city line hidden',
      !(await shown(G, '#records')) && (await text(G, '#day-days')) === 'Today' && (await text(G, '#day-label')) === 'Capture days'
      && !(await shown(G, '#day-prev')) && !(await shown(G, '#day-next')) && !(await shown(G, '#day-sub')) && !(await shown(G, '#empty')));
    check('L2 the list is built from IndexedDB only: opening it sends no request', mock.calls.length === callsBefore, String(mock.calls.length - callsBefore));

    // ---------- the rows (7D.2, items 2 and 3) ----------
    let rows = await listRows(G);
    check('L3 newest first: today, then every day with a live capture, own or shared (a day with only a deleted capture is absent)',
      JSON.stringify(rows.map((r) => r.day)) === JSON.stringify([today, D1, D2, D3]), JSON.stringify(rows.map((r) => r.day)));
    check('L3 each row leads with the date as the day view writes it', await G.evaluate((rs) => rs.every((r) => r.when === fmtDayLabel(r.day)), rows));
    const r1 = rows.find((r) => r.day === D1);
    check('L4 counts: own and partner captures, photos as the day view shows them, deleted not counted ("6 captures, 3 photos")',
      r1 && r1.counts === '6 captures, 3 photos', JSON.stringify(r1));
    check('L4 places: the first two distinct named places in time order, partner names included; a deleted capture\'s name, a case duplicate, coordinates and the third name left out',
      r1 && r1.places === 'Eric Cafe, Tampines Mall', JSON.stringify(r1));
    const r2 = rows.find((r) => r.day === D2), r3 = rows.find((r) => r.day === D3), r0 = rows.find((r) => r.day === today);
    check('L5 singular "1 capture", photos left out when none; Eric\'s unshared capture not counted; no place line without a named place',
      r2 && r2.counts === '1 capture' && r2.places === null, JSON.stringify(r2));
    check('L5 a day with only the partner\'s shared capture is listed and counted', r3 && r3.counts === '1 capture' && r3.places === null, JSON.stringify(r3));
    check('L5 today is always there: "No captures yet", the date in the accent', r0 && r0.counts === 'No captures yet' && r0.today && r0.places === null
      && rows.filter((r) => r.today).length === 1, JSON.stringify(r0));
    check('L5 no coordinates and no "no GPS" anywhere in the list', !/\d+\.\d{4}, \d+\.\d{4}|no GPS/.test(await text(G, '#day-list')));

    // ---------- the look (7D.2, item 6) ----------
    const look = async () => G.evaluate(() => {
      const row = document.querySelector('#day-list .dayrow'), when = row.querySelector('.when'), cs = getComputedStyle(when);
      const left = document.querySelector('#day-list').getBoundingClientRect().left + parseFloat(getComputedStyle(document.querySelector('#day-list')).paddingLeft);
      return { font: cs.fontFamily + '|' + cs.fontSize + '|' + cs.fontWeight, today: cs.color, rule: getComputedStyle(row).borderBottomColor + '|' + getComputedStyle(row).borderBottomWidth,
        line: getComputedStyle(document.documentElement).getPropertyValue('--line').trim(), places: getComputedStyle(document.querySelector('#day-list .places')).color,
        ink: getComputedStyle(document.body).color, ground: getComputedStyle(document.body).backgroundColor, gutter: Math.round(left), h: row.getBoundingClientRect().height };
    });
    let lk = await look();
    check('L6 light: serif date (Newsreader 600, 20 px) on hairlines, today in the stamp terracotta, places in ink, 20 px gutter, rows at least 44 px',
      /Newsreader/.test(lk.font) && /20px\|600/.test(lk.font) && lk.today === 'rgb(180, 71, 42)' && lk.rule === 'rgb(217, 207, 189)|1px'
      && lk.places === lk.ink && lk.ground === 'rgb(244, 238, 226)' && lk.gutter === 20 && lk.h >= 44, JSON.stringify(lk));
    await G.evaluate(() => applyTheme('dark'));
    lk = await look();
    check('L6 dark: the night page, today in the dark accent, hairlines in the dark rule',
      lk.ground === 'rgb(20, 28, 38)' && lk.today === 'rgb(224, 122, 85)' && lk.rule === 'rgb(44, 56, 70)|1px' && lk.places === lk.ink, JSON.stringify(lk));
    await G.evaluate(() => applyTheme('light'));

    // ---------- tap a row (7D.2, item 4) ----------
    await G.click(`#day-list .dayrow[data-day="${D1}"]`);
    await G.waitForFunction(() => document.getElementById('day-list').hidden);
    const dv = await G.evaluate(() => ({ view: viewDay, follow: followToday, label: document.getElementById('day-label').textContent,
      link: document.getElementById('day-days').textContent, rows: document.querySelectorAll('#records .row').length,
      prints: document.querySelectorAll('#records .print').length, prev: document.getElementById('day-prev').dataset.day, next: document.getElementById('day-next').dataset.day }));
    check('L7 a tap opens that day\'s view, the list closed, no longer following today; the link reads Days',
      dv.view === D1 && dv.follow === false && dv.label === await G.evaluate((d) => fmtDayLabel(d), D1) && dv.link === 'Days', JSON.stringify(dv));
    check('L7 the day view shows what the row counted: 6 captures, 3 photo prints', dv.rows === 6 && dv.prints === 3, JSON.stringify(dv));
    check('L7 the arrows step on from there (earlier and later days with captures)', dv.prev === D2 && dv.next === today && await shown(G, '#day-prev'), JSON.stringify(dv));
    await G.click('#day-prev');
    check('L7 the earlier arrow goes to the day before with captures', await G.evaluate((d) => viewDay === d && !followToday, D2));
    await G.click('#day-label');
    check('L8 the date tap still returns to today', await until(G, (t) => viewDay === t && followToday && document.getElementById('day-label').textContent === fmtDayLabel(t)
      && document.getElementById('day-days').textContent === 'Days', today).catch(() => false));

    // Today returns to today's day view.
    await openList(G);
    await G.click(`#day-list .dayrow[data-day="${D3}"]`);
    await G.waitForFunction(() => document.getElementById('day-list').hidden);
    check('L9 a partner-only day opens with its shared capture (read-only row)', (await G.$$('#records .row.partner')).length === 1 && (await G.$$('#records .row')).length === 1);
    await openList(G);
    await G.click('#day-days');
    await G.waitForFunction(() => document.getElementById('day-list').hidden);
    check('L9 Today returns to today\'s day view, following today again', await G.evaluate((t) => viewDay === t && followToday
      && document.getElementById('day-label').textContent === fmtDayLabel(t) && document.getElementById('day-days').textContent === 'Days' && !document.getElementById('records').hidden, today));
    await openList(G);
    await G.click(`#day-list .dayrow[data-day="${today}"]`);
    await G.waitForFunction(() => document.getElementById('day-list').hidden);
    check('L9 tapping today\'s row opens today and keeps following it', await G.evaluate((t) => viewDay === t && followToday, today));

    // ---------- the list across tabs ----------
    await openList(G);
    await G.click('#tab-journal');
    await G.click('#tab-captures');
    check('L10 the list stays up across a switch to Journal and back', await shown(G, '#day-list') && (await text(G, '#day-days')) === 'Today');

    // ---------- redrawn after a sync (7D.2 Source, item 5) ----------
    const late = cap(ERIC_UID, D2, '15:00', { place_name: 'Eric Market', shared: true });
    mock.upsertBatch([late], ERIC_UID);
    await syncIdle(G);
    let x = await rowOf(G, D2);
    check('L11 after a sync the list shows Eric\'s new shared capture and its place', x && x.counts === '2 captures' && x.places === 'Eric Market', JSON.stringify(x));
    mock.serverEdit(ericRows[0].id, { deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() });   // Eric deletes his cafe
    await G.evaluate(() => { window.__tbIdleSyncMs = 700; setIdleSync(true); });
    await until(G, (d) => { const b = document.querySelector(`#day-list .dayrow[data-day="${d}"] .line2`); return b && b.textContent === '5 captures, 2 photos'; }, D1, { timeout: 5000 }).catch(() => {});
    await G.evaluate(() => { window.__tbIdleSyncMs = 0; setIdleSync(false); });
    x = await rowOf(G, D1);
    check('L11 the idle sync redraws the list by itself: the partner\'s deleted capture leaves the counts and the places',
      x && x.counts === '5 captures, 2 photos' && x.places === 'Tampines Mall, Jewel', JSON.stringify(x));

    // Gary soft-deletes his own 0900 capture in the app: no longer counted, the next spelling leads.
    await G.click(`#day-list .dayrow[data-day="${D1}"]`);
    await G.waitForFunction(() => document.getElementById('day-list').hidden);
    await G.click(`#records .row[data-id="${garyRows[1].id}"]`);
    await waitCap(G, true);
    await G.click('#cap-delete');
    await waitCap(G, false);
    await openList(G);
    x = await rowOf(G, D1);
    const delRow = await G.evaluate((id) => idb.get('captures', id), garyRows[1].id);
    check('L12 a capture soft-deleted on the phone is not counted at once (kept with deleted_at, never removed)',
      x && x.counts === '4 captures, 1 photo' && x.places === 'tampines mall, Jewel' && delRow && !!delRow.deleted_at, JSON.stringify([x, delRow && delRow.deleted_at]));

    // ---------- offline (item 5) ----------
    await offline(true);
    await G.click('#day-days');                                   // back to today
    await G.waitForFunction(() => document.getElementById('day-list').hidden);
    await openList(G);
    rows = await listRows(G);
    check('L13 airplane mode: the list still shows every day', JSON.stringify(rows.map((r) => r.day)) === JSON.stringify([today, D1, D2, D3]), JSON.stringify(rows.map((r) => r.day)));
    await G.click(`#day-list .dayrow[data-day="${D2}"]`);
    await G.waitForFunction(() => document.getElementById('day-list').hidden);
    check('L13 airplane mode: a tap opens the day', await G.evaluate((d) => viewDay === d, D2) && (await G.$$('#records .row')).length === 2);
    await openList(G);
    await G.click('#capture');
    await waitCap(G, true);
    await G.fill('#cap-body', 'Offline from the list');
    await G.fill('#cap-place', 'Offline Stall');
    await G.click('#cap-save');
    await waitCap(G, false);
    await G.waitForFunction(() => !popWait);
    check('L14 a capture saved from the list returns to today\'s day view, where it shows', await G.evaluate((t) => viewDay === t && followToday
      && !document.getElementById('records').hidden && document.getElementById('day-list').hidden, today)
      && (await G.$$eval('#records .row .line2', (els) => els.map((e) => e.textContent))).includes('Offline from the list'));
    await openList(G);
    x = await rowOf(G, today);
    check('L14 offline, today\'s row counts it with its place', x && x.counts === '1 capture' && x.places === 'Offline Stall', JSON.stringify(x));
    await offline(false);
    await syncIdle(G);
    x = await rowOf(G, today);
    check('L14 back online and synced, the row is unchanged', x && x.counts === '1 capture' && x.places === 'Offline Stall' && (await G.evaluate(() => idb.all('captures'))).every((r) => !r.dirty), JSON.stringify(x));

    // ---------- narrow screens: the date never breaks over two lines (7D.2 Day bar) ----------
    await G.click('#day-days');
    await G.waitForFunction(() => document.getElementById('day-list').hidden);
    for (const w of [412, 360]) {
      await G.setViewportSize({ width: w, height: 860 });
      await G.evaluate(() => { document.getElementById('day-label').textContent = 'Mon 05/01/26'; });   // the widest date in 2026 and 2027
      const fit = await G.evaluate(() => {
        const l = document.getElementById('day-label').getBoundingClientRect(), d = document.getElementById('day-days').getBoundingClientRect();
        const n = document.getElementById('day-next').getBoundingClientRect();
        return { lines: Math.round(l.height / parseFloat(getComputedStyle(document.getElementById('day-label')).lineHeight)), overlap: l.right > d.left && l.bottom > d.top, inside: n.right <= innerWidth };
      });
      check(`L15 ${w} px: the widest date on one line, not under Days, the arrows on screen`, fit.lines === 1 && !fit.overlap && fit.inside, JSON.stringify(fit));
    }
    await G.setViewportSize({ width: 412, height: 860 });
    await G.evaluate(() => render());
  } finally {
    await browser.close();
    srv.close();
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed} of ${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
