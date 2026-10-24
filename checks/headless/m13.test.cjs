// travelboard M1.3 headless tests (TESTS.md, M1.3). Run from the repo root:
//   node checks/headless/m13.test.cjs
// Drives trip.html in Chromium against harness.cjs, with Gary's and Eric's phones on one mock
// and a mock of OpenStreetMap Nominatim (no request ever leaves for the real one).
// Session A (SPEC.md 7C.1, 7C.2, 7C.2a, 7C.4, 7C.7 items 2 to 5 and 6a's toggle): the look
// (fonts, tokens, header stamp, tabs at the foot), place names on rows, naming offline and its
// sync, clearing back to coordinates, drafts, own-name chips within 75 m offline, the map chip
// online with its credit, never filled in without a tap, the cached lookup (one request per
// place), one request a second, failures, three chips at most, a capture saved offline getting
// its map chip later, partner rows read-only with the owner's name for the place, export and
// Share text. Session B adds 7C.5 (the prompt editor) to this file.
// Exit code 0 only when every check passes.
'use strict';
const fs = require('fs');
const { launch, startServer, makeMock, attachMock, newContext, UID, ERIC_UID } = require('./harness.cjs');

const PORT = 8735;
const BASE = `http://127.0.0.1:${PORT}/`;
const APP = fs.readFileSync(require('path').join(__dirname, '..', '..', 'trip.html'), 'utf8').match(/const APP_VERSION = '([0-9.]+)';/)[1];
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail && !ok ? '  [' + detail + ']' : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Positions near Asok, Bangkok. m(lat, lng, north, east) moves by metres.
const BASE_POS = { lat: 13.7380, lng: 100.5601 };
const move = (p, north, east) => ({ lat: p.lat + north / 111320, lng: p.lng + east / (111320 * Math.cos(p.lat * Math.PI / 180)) });

const waitCap = (page, open) => page.waitForFunction((o) => document.getElementById('cap').hidden === !o && (!o || !popWait), open, { timeout: 5000 });
const shown = (page, sel) => page.$eval(sel, (e) => !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length));
const text = (page, sel) => page.$eval(sel, (e) => e.textContent);
const store = (page, s) => page.evaluate((x) => idb.all(x), s);
const chips = (page) => page.$$eval('#cap-chips .pchip', (els) => els.map((e) => ({ name: e.dataset.place, src: e.dataset.source, text: [...e.querySelectorAll('span')].map((x) => x.textContent).join(' ') })));
const rowPlace = (page, id) => page.$eval(`.row[data-id="${id}"] .place`, (e) => ({ text: e.textContent, cls: e.className }));
async function syncIdle(page) {
  await page.evaluate(async () => {
    for (let i = 0; i < 3; i++) {
      await sync();
      while (syncing) await new Promise((r) => setTimeout(r, 20));
    }
  });
}
async function openNew(page) {
  await page.click('#tab-captures');
  await page.click('#capture');
  await waitCap(page, true);
}
async function save(page) {
  await page.click('#cap-save');
  await waitCap(page, false);
  await page.waitForFunction(() => !popWait);
}
async function openEdit(page, id) {
  await page.click(`.row[data-id="${id}"]`);
  await waitCap(page, true);
}
// Wait until the chips have settled (own names drawn, and the map lookup, if any, finished).
async function chipsSettled(page) {
  await page.waitForFunction(() => !cap.open || !cap.osm || cap.osm.done, null, { timeout: 5000 }).catch(() => {});
  await page.evaluate(() => cap.osm && cap.osm.p);
  await page.waitForTimeout(80);
}

(async () => {
  const srv = await startServer(PORT);
  const browser = await launch();
  const mock = makeMock();
  const phones = {};
  for (const [who, uid] of [['gary', UID], ['eric', ERIC_UID]]) {
    const ctx = await newContext(browser, { tz: 'Asia/Bangkok', session: true, uid });
    const net = { offline: false, name: who };
    await attachMock(ctx, mock, net);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.log('PAGEERROR', who, e.message));
    page.on('dialog', (d) => d.accept());
    await page.goto(BASE + 'trip.html');
    await page.waitForFunction(() => document.getElementById('day-label').textContent !== '-');
    await syncIdle(page);
    phones[who] = { ctx, page, net };
  }
  const { page: G, ctx: gctx, net: gnet } = phones.gary;
  const E = phones.eric.page;
  const offline = async (on) => { gnet.offline = on; await gctx.setOffline(on); await G.evaluate((o) => window.dispatchEvent(new Event(o ? 'offline' : 'online')), on); };

  try {
    // ---------- the look (7C.1, 7C.2, 7C.8) ----------
    const look = await G.evaluate(async () => {
      await document.fonts.ready;
      const cs = (sel) => getComputedStyle(document.querySelector(sel));
      return {
        v: APP_VERSION, db: (await idb.open()).version, geocache: (await idb.open()).objectStoreNames.contains('geocache'),
        serif: (await Promise.all(["600 34px 'Newsreader'", "italic 500 20px 'Newsreader'", "500 17px 'IBM Plex Sans'"].map((f) => document.fonts.load(f))))
          .every((faces) => faces.length === 1 && faces[0].status === 'loaded'),
        loaded: [...document.fonts].filter((f) => f.status === 'loaded').map((f) => `${f.family.replace(/"/g, '')} ${f.style} ${f.weight}`).sort(),
        theme: document.documentElement.dataset.theme, body: cs('body').backgroundColor,
        title: cs('#day-label').fontFamily + '|' + cs('#day-label').fontSize + '|' + cs('#day-label').fontWeight,
        wordmark: cs('.wordmark').fontStyle + '|' + cs('.wordmark').fontSize, tabs: !!document.querySelector('footer #tab-captures') && !!document.querySelector('footer #tab-journal'),
        // the declared border (Chromium snaps 1.5 px to whole pixels at device pixel ratio 1)
        stamp: [...document.styleSheets[0].cssRules].find((r) => r.selectorText === '.stamp').style.borderTopWidth + '|' + cs('.stamp').borderRadius + '|' + cs('.stamp').transform, primary: cs('#capture').minHeight + '|' + cs('#capture').borderRadius
      };
    });
    check(`N0 v${APP}, IndexedDB v5 with the geocache store`, String(look.v) === APP && look.db === 5 && look.geocache, JSON.stringify(look));
    check('N0 Newsreader 600 and italic 500 and Plex 500 load from vendor/', look.serif && look.loaded.some((f) => /Newsreader normal 600/.test(f)), look.loaded.join(', ') + ' ' + look.serif);
    check('N0 7C.8 tokens: day title Newsreader 600 34 px; wordmark italic 20 px', /Newsreader/.test(look.title) && /34px\|600/.test(look.title) && look.wordmark === 'italic|20px', look.title + ' ' + look.wordmark);
    check('N0 ground is the paper (light) or the night page (dark)', (look.theme === 'light' && look.body === 'rgb(244, 238, 226)') || (look.theme === 'dark' && look.body === 'rgb(20, 28, 38)'), look.theme + ' ' + look.body);
    check('N0 sync pill as a stamp (1.5 px border, radius 4 px, rotated); tabs at the foot; main button 54 px, radius 10 px',
      /^1\.5px\|4px\|matrix/.test(look.stamp) && look.tabs && look.primary === '54px|10px', look.stamp + ' ' + look.primary);
    await G.evaluate(() => applyTheme('dark'));
    check('N0 dark theme: night page and the dark accent', await G.evaluate(() => getComputedStyle(document.body).backgroundColor === 'rgb(20, 28, 38)'
      && getComputedStyle(document.querySelector('#capture')).backgroundColor === 'rgb(224, 122, 85)'));
    await G.evaluate(() => applyTheme('light'));
    check('N0 light theme: paper and the stamp terracotta', await G.evaluate(() => getComputedStyle(document.body).backgroundColor === 'rgb(244, 238, 226)'
      && getComputedStyle(document.querySelector('#capture')).backgroundColor === 'rgb(180, 71, 42)'));
    check('N0 "sign in" stamp is ink blue, not the accent (status colours distinct from the accent)', await G.evaluate(async () => {
      const keep = syncState.phase; syncState.phase = 'signin'; await renderStatus();
      const c = getComputedStyle(document.getElementById('status')).color;
      syncState.phase = keep; await renderStatus();
      return c === 'rgb(47, 85, 119)';
    }));

    // ---------- display (7C.4): no GPS, then coordinates, then the name ----------
    await openNew(G);
    check('N1 new capture with location not yet granted: no position asked at open (the prompt stays at the first Save)',
      await G.evaluate(() => __geo.calls === 0) && (await G.getAttribute('#cap-place', 'placeholder')) === 'no GPS' && (await G.inputValue('#cap-place')) === '');
    check('N1 the place field and its label sit under the time; no kind toggle (6a)', await shown(G, '#cap-place') && (await text(G, '#cap-place-box label')) === 'Place'
      && (await G.$('#kind-note, #kind-journal, #kind-group')) === null);
    await G.fill('#cap-body', 'No GPS capture');
    await save(G);
    let rows = await store(G, 'captures');
    const noGps = rows.find((r) => r.body === 'No GPS capture');
    check('N1 a capture with no GPS and no name shows "no GPS"', noGps && noGps.place_name === null && (await rowPlace(G, noGps.id)).text === 'no GPS');

    await gctx.grantPermissions(['geolocation']);
    await G.evaluate((p) => { __geo.mode = 'grant'; __geo.fix = p; }, BASE_POS);
    await openNew(G);
    await G.waitForFunction(() => !!cap.fix, null, { timeout: 3000 }).catch(() => {});
    check('N2 location granted: a new capture takes a position at open for its chips; the field shows the coordinates as a hint, empty',
      (await G.getAttribute('#cap-place', 'placeholder')) === '13.7380, 100.5601' && (await G.inputValue('#cap-place')) === '');
    await G.fill('#cap-body', 'Coconut ice cream cart');
    await chipsSettled(G);
    await save(G);
    await G.waitForFunction(() => idb.all('captures').then((a) => a.some((r) => r.body === 'Coconut ice cream cart' && r.lat != null)), null, { timeout: 3000 });
    rows = await store(G, 'captures');
    const cart = rows.find((r) => r.body === 'Coconut ice cream cart');
    let rp = await rowPlace(G, cart.id);
    check('N2 a capture with GPS shows its coordinates to 4 decimals until named (item 2)', cart.place_name === null && rp.text === '13.7380, 100.5601' && /coords/.test(rp.cls), JSON.stringify(rp));
    await syncIdle(G);

    // ---------- naming offline, then sync (item 2) ----------
    await offline(true);
    const osmOff = mock.osm.calls.length;
    const before = (await store(G, 'captures')).find((r) => r.id === cart.id);
    await openEdit(G, cart.id);
    check('N3 edit screen shows the place field with the coordinates as its hint', (await G.getAttribute('#cap-place', 'placeholder')) === '13.7380, 100.5601');
    await G.fill('#cap-place', '  Asok BTS stairs  ');
    await G.waitForTimeout(80);
    await save(G);
    let after = (await store(G, 'captures')).find((r) => r.id === cart.id);
    rp = await rowPlace(G, cart.id);
    check('N3 named offline: saved trimmed, updated_at bumped, queued, row shows the name in the place style',
      after.place_name === 'Asok BTS stairs' && Date.parse(after.updated_at) > Date.parse(before.updated_at) && after.dirty === 1
      && rp.text === 'Asok BTS stairs' && /named/.test(rp.cls) && mock.rows.get(cart.id).place_name === null, JSON.stringify([after.place_name, rp]));
    check('N3 offline: no OpenStreetMap request was tried', mock.osm.calls.length === osmOff, String(mock.osm.calls.length - osmOff));
    await offline(false);
    await syncIdle(G);
    check('N3 on reconnect the name reaches the server', mock.rows.get(cart.id).place_name === 'Asok BTS stairs' && (await store(G, 'captures')).find((r) => r.id === cart.id).dirty === 0);

    // ---------- shared: the partner sees the name, read-only (item 2) ----------
    mock.partnerAdd(ERIC_UID, UID); mock.partnerAdd(UID, ERIC_UID);
    await syncIdle(G);
    await openEdit(G, cart.id);
    if (!(await G.isChecked('#cap-share-on'))) await G.click('#cap-share-on');
    await save(G);
    await syncIdle(G);
    await syncIdle(E);
    await E.evaluate(() => { followToday = true; return render(); });
    const ePlace = await E.$eval(`.row[data-id="${cart.id}"] .place`, (e) => e.textContent).catch(() => null);
    check('N4 shared: the name shows on the partner\'s phone', ePlace === 'Asok BTS stairs', String(ePlace));
    await E.click(`.row[data-id="${cart.id}"]`);
    await E.waitForFunction(() => document.getElementById('view-dlg').open);
    check('N4 partner view is read-only: the owner\'s name for the place, no place field, no kind', (await text(E, '#view-meta')).includes('Asok BTS stairs')
      && !(await E.$('#view-dlg input')) && !/\b(note|journal)\b/.test(await text(E, '#view-meta')) && (await E.$eval('#cap', (e) => e.hidden)), await text(E, '#view-meta'));
    await E.click('#view-close');
    const exRow = Object.assign({}, mock.rows.get(cart.id));
    let rejected = false;
    try { mock.upsertBatch([Object.assign({}, exRow, { place_name: 'Renamed by Eric', updated_at: new Date(Date.now() + 1e6).toISOString() })], ERIC_UID); } catch (e) { rejected = /another user/.test(e.message); }
    check('N4 only the owner can name his capture (the RPC rejects Eric\'s rename)', rejected && mock.rows.get(cart.id).place_name === 'Asok BTS stairs');

    // ---------- clearing returns to coordinates ----------
    await openEdit(G, cart.id);
    check('N5 the clear control shows while a name is set', await shown(G, '#cap-place-clear'));
    await G.click('#cap-place-clear');
    check('N5 cleared: the field is empty and hints the coordinates again', (await G.inputValue('#cap-place')) === '' && (await G.getAttribute('#cap-place', 'placeholder')) === '13.7380, 100.5601');
    await save(G);
    await syncIdle(G);
    after = (await store(G, 'captures')).find((r) => r.id === cart.id);
    check('N5 saved cleared: place_name null on the phone and the server, row back to coordinates',
      after.place_name === null && mock.rows.get(cart.id).place_name === null && (await rowPlace(G, cart.id)).text === '13.7380, 100.5601');
    await openEdit(G, cart.id);
    await G.fill('#cap-place', 'Asok BTS stairs');
    await save(G);
    await syncIdle(G);

    // ---------- draft keeps the place ----------
    await openNew(G);
    await G.fill('#cap-body', 'Draft with a place');
    await G.fill('#cap-place', 'Terminal 21');
    await G.waitForTimeout(100);
    await G.reload();
    await waitCap(G, true);
    check('N6 killed mid-typing: the place comes back with the text', (await G.inputValue('#cap-place')) === 'Terminal 21' && (await G.inputValue('#cap-body')) === 'Draft with a place');
    await save(G);
    const t21 = (await store(G, 'captures')).find((r) => r.body === 'Draft with a place');
    check('N6 saved with its place_name', t21 && t21.place_name === 'Terminal 21');
    await syncIdle(G);

    // ---------- own-name chips, offline (item 3) ----------
    // Named captures on the server around a new spot: 30 m, 60 m and 200 m away, and a second
    // capture with the 30 m name (one chip, not two).
    const spot = move(BASE_POS, 600, 0);
    const seed = (id, name, p, body) => ({ id, body, kind: 'note', captured_at: new Date().toISOString(), tz: 'Asia/Bangkok', local_date: '2026-10-01',
      lat: p.lat, lng: p.lng, accuracy_m: 10, place_name: name, updated_at: new Date().toISOString() });
    mock.upsertBatch([
      seed('0b000000-0000-4000-8000-000000000001', 'Health Land Asoke', move(spot, 30, 0), 'massage'),
      seed('0b000000-0000-4000-8000-000000000002', 'Health Land Asoke', move(spot, 0, 35), 'massage again'),
      seed('0b000000-0000-4000-8000-000000000003', 'Soi 23 noodle stall', move(spot, -60, 0), 'noodles'),
      seed('0b000000-0000-4000-8000-000000000004', 'Far away mall', move(spot, 200, 0), 'too far')
    ], UID);
    await syncIdle(G);
    await offline(true);
    await G.evaluate((p) => { __geo.mode = 'grant'; __geo.fix = p; }, spot);   // the N6 reload reset the stub
    const osm0 = mock.osm.calls.length;
    await openNew(G);
    await G.waitForFunction(() => !!cap.fix, null, { timeout: 3000 }).catch(() => {});
    await chipsSettled(G);
    let cs = await chips(G);
    check('N7 offline near named places: own names within 75 m, nearest first, each once, with distance (item 3)',
      cs.length === 2 && cs[0].name === 'Health Land Asoke' && cs[0].src === 'own' && cs[0].text === 'Health Land Asoke 30 m'
      && cs[1].name === 'Soi 23 noodle stall' && cs[1].text === 'Soi 23 noodle stall 60 m', JSON.stringify(cs));
    check('N7 the 200 m name is not offered; no map chip and no request offline', !cs.some((c) => c.name === 'Far away mall') && !cs.some((c) => c.src === 'osm')
      && mock.osm.calls.length === osm0 && !(await shown(G, '#cap-osm')));
    check('N7 nothing is filled in without a tap', (await G.inputValue('#cap-place')) === '');
    await G.click('#cap-chips .pchip[data-place="Soi 23 noodle stall"]');
    await chipsSettled(G);
    check('N7 a tap fills the field; that chip goes, the other stays', (await G.inputValue('#cap-place')) === 'Soi 23 noodle stall'
      && (await chips(G)).map((c) => c.name).join() === 'Health Land Asoke');
    await G.fill('#cap-body', 'Offline noodles');
    await save(G);
    const noodles = (await store(G, 'captures')).find((r) => r.body === 'Offline noodles');
    check('N7 saved offline with the chosen name, queued', noodles.place_name === 'Soi 23 noodle stall' && noodles.dirty === 1);
    await offline(false);
    await syncIdle(G);

    // ---------- the map chip, online (item 4) ----------
    const mall = move(BASE_POS, -3000, 0);
    mock.osm.name = (lat, lng) => (Math.abs(lat - mall.lat) < 0.002 ? 'Tampines Mall' : '');
    await G.evaluate((p) => { __geo.fix = p; }, mall);
    const osm1 = mock.osm.calls.length;
    await openNew(G);
    await G.waitForFunction(() => !!cap.fix, null, { timeout: 3000 }).catch(() => {});
    await chipsSettled(G);
    cs = await chips(G);
    const q = mock.osm.calls[osm1] && mock.osm.calls[osm1].q;
    check('N8 online at a named place: one map chip with the OSM name and the credit (item 4)', cs.length === 1 && cs[0].src === 'osm' && cs[0].name === 'Tampines Mall'
      && await shown(G, '#cap-osm') && (await text(G, '#cap-osm')) === 'Map suggestion © OpenStreetMap contributors', JSON.stringify(cs));
    check('N8 one reverse request: format jsonv2, zoom 18, English, the phone\'s position', mock.osm.calls.length === osm1 + 1 && mock.osm.calls[osm1].path === '/reverse'
      && q.format === 'jsonv2' && q.zoom === '18' && q['accept-language'] === 'en' && Math.abs(Number(q.lat) - mall.lat) < 1e-5 && Math.abs(Number(q.lon) - mall.lng) < 1e-5, JSON.stringify(q));
    check('N8 nothing is filled without a tap', (await G.inputValue('#cap-place')) === '');
    check('N8 map chip styled as a suggestion (dashed accent), own chips solid blue', await G.$eval('#cap-chips .pchip.map', (e) => getComputedStyle(e).borderTopStyle === 'dashed'));
    await G.fill('#cap-place', 'Tamp');
    await G.waitForTimeout(150);
    check('N8 typing does not ask OpenStreetMap again', mock.osm.calls.length === osm1 + 1);
    await G.fill('#cap-place', '');
    await chipsSettled(G);
    await G.click('#cap-chips .pchip.map');
    await chipsSettled(G);
    check('N8 a tap fills the field with the name; the credit goes with the chip', (await G.inputValue('#cap-place')) === 'Tampines Mall' && !(await shown(G, '#cap-osm')));
    await G.fill('#cap-body', 'Lunch at the mall');
    await save(G);
    const lunch = (await store(G, 'captures')).find((r) => r.body === 'Lunch at the mall');
    const gc = await store(G, 'geocache');
    check('N8 saved with the name only; the lookup is cached in IndexedDB by position', lunch.place_name === 'Tampines Mall'
      && Object.keys(lunch).filter((k) => /osm|nominatim/i.test(k)).length === 0 && gc.some((x) => x.name === 'Tampines Mall'));

    // ---------- the cached lookup (item 5) ----------
    const osm2 = mock.osm.calls.length;
    await G.evaluate((p) => { __geo.fix = p; }, move(mall, 8, 5));   // the same spot, give or take a few metres
    await openNew(G);
    await G.waitForFunction(() => !!cap.fix, null, { timeout: 3000 }).catch(() => {});
    await chipsSettled(G);
    cs = await chips(G);
    check('N9 a second capture at the same spot: no second Nominatim request (item 5)', mock.osm.calls.length === osm2, `${mock.osm.calls.length - osm2} new`);
    check('N9 its chips: the own name first (now a name of yours), no duplicate map chip', cs.length === 1 && cs[0].src === 'own' && cs[0].name === 'Tampines Mall', JSON.stringify(cs));
    await G.click('#cap-close');
    await waitCap(G, false);
    await G.evaluate(() => idb.del('drafts', 'new'));

    // ---------- one request a second ----------
    const osm3 = mock.osm.calls.length;
    await G.evaluate(async (ps) => { await Promise.all(ps.map((p) => osmName(p.lat, p.lng))); }, [move(BASE_POS, 5000, 0), move(BASE_POS, 6000, 0), move(BASE_POS, 7000, 0)]);
    const ts = mock.osm.calls.slice(osm3).map((c) => c.at);
    check('N10 three new places at once: three requests, at least a second apart', ts.length === 3 && ts[1] - ts[0] >= 950 && ts[2] - ts[1] >= 950, JSON.stringify(ts.map((t) => t - ts[0])));
    check('N10 an empty answer gives no chip and is cached (not asked again)', await G.evaluate(async (p) => (await osmName(p.lat, p.lng)) === null, move(BASE_POS, 5000, 0))
      && mock.osm.calls.length === osm3 + 3);

    // ---------- failures ----------
    for (const mode of ['http', 'network']) {
      mock.osm.fail = mode;
      const far = move(BASE_POS, mode === 'http' ? 9000 : 9500, 0);
      const n = mock.osm.calls.length;
      await G.evaluate((p) => { __geo.fix = p; }, far);
      await openNew(G);
      await G.waitForFunction(() => !!cap.fix, null, { timeout: 3000 }).catch(() => {});
      await chipsSettled(G);
      check(`N11 lookup fails (${mode}): no chip, no credit, no error shown`, (await chips(G)).length === 0 && !(await shown(G, '#cap-osm')) && mock.osm.calls.length === n + 1);
      await G.click('#cap-close');
      await waitCap(G, false);
      mock.osm.fail = null;
      mock.osm.name = 'Benjakitti Park';
      await openNew(G);
      await G.waitForFunction(() => !!cap.fix, null, { timeout: 3000 }).catch(() => {});
      await chipsSettled(G);
      check(`N11 after a failure (${mode}) nothing was cached: the next opening asks again and gets the chip`,
        mock.osm.calls.length === n + 2 && (await chips(G)).some((c) => c.src === 'osm' && c.name === 'Benjakitti Park'));
      await G.click('#cap-close');
      await waitCap(G, false);
      await G.evaluate(() => idb.del('drafts', 'new'));
    }

    // ---------- three chips at most, own names first ----------
    const crowd = move(BASE_POS, 0, 4000);
    mock.upsertBatch(['A', 'B', 'C', 'D'].map((x, i) => seed(`0c000000-0000-4000-8000-00000000000${i}`, 'Stall ' + x, move(crowd, 10 * (i + 1), 0), 'crowd ' + x)), UID);
    await syncIdle(G);
    mock.osm.name = 'Should not be asked';
    const osm4 = mock.osm.calls.length;
    await G.evaluate((p) => { __geo.fix = p; }, crowd);
    await openNew(G);
    await G.waitForFunction(() => !!cap.fix, null, { timeout: 3000 }).catch(() => {});
    await chipsSettled(G);
    cs = await chips(G);
    check('N12 four own names in range: three chips, nearest first, no map lookup at all', cs.map((c) => c.name).join() === 'Stall A,Stall B,Stall C'
      && cs.every((c) => c.src === 'own') && mock.osm.calls.length === osm4, JSON.stringify(cs));
    await G.click('#cap-close');
    await waitCap(G, false);
    await G.evaluate(() => idb.del('drafts', 'new'));

    // ---------- a capture saved offline gets its map chip later, with signal ----------
    const later = move(BASE_POS, -8000, 0);
    mock.osm.name = (lat) => (Math.abs(lat - later.lat) < 0.002 ? 'Chatuchak Market' : '');
    await offline(true);
    await G.evaluate((p) => { __geo.fix = p; }, later);
    await openNew(G);
    await G.waitForFunction(() => !!cap.fix, null, { timeout: 3000 }).catch(() => {});
    await chipsSettled(G);
    check('N13 offline at a new place: no chips', (await chips(G)).length === 0);
    await G.fill('#cap-body', 'Market, no signal');
    await save(G);
    await G.waitForFunction(() => idb.all('captures').then((a) => a.some((r) => r.body === 'Market, no signal' && r.lat != null)), null, { timeout: 3000 });
    const market = (await store(G, 'captures')).find((r) => r.body === 'Market, no signal');
    await offline(false);
    await syncIdle(G);
    await openEdit(G, market.id);
    await chipsSettled(G);
    cs = await chips(G);
    check('N13 opened later with signal: the map chip appears for the saved position (7C.4)', cs.length === 1 && cs[0].name === 'Chatuchak Market' && (await G.inputValue('#cap-place')) === '', JSON.stringify(cs));
    await G.click('#cap-close');
    await waitCap(G, false);

    // ---------- partner rows: read-only, no chips, the owner's name ----------
    check('N14 Eric\'s phone never asked OpenStreetMap for Gary\'s rows (no edit screen for them)', !mock.osm.calls.some((c) => c.phone === 'eric'));

    // ---------- journal composer, export, Share text ----------
    await G.click('#tab-journal');
    await G.click('#capture');
    await waitCap(G, true);
    check('N15 the journal composer has no place field and no chips', !(await shown(G, '#cap-place-box')) && !(await shown(G, '#cap-chips')));
    await G.click('#cap-close');
    await waitCap(G, false);
    await G.evaluate(() => idb.del('drafts', 'journal:' + jDay));
    const [dl] = await Promise.all([G.waitForEvent('download'), G.evaluate(() => exportCaptures())]);
    const ex = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
    check('N15 export carries place_name (null when not named)', ex.captures.find((c) => c.id === lunch.id).place_name === 'Tampines Mall'
      && ex.captures.find((c) => c.id === noGps.id).place_name === null);
    const share = await G.evaluate((d) => dayText(d), lunch.local_date);
    check('N15 Share text names the place', share.includes(', at Tampines Mall'), share.slice(0, 400));
    await G.click('#tab-captures');

    // ---------- the day heading ----------
    await G.evaluate(() => { followToday = true; return render(); });
    const sub = await text(G, '#day-sub');
    const nToday = await G.evaluate(async () => (await idb.all('captures')).filter((r) => !r.deleted_at && r.local_date === viewDay).length
      + (await idb.all('partner')).filter((r) => r.local_date === viewDay).length);
    check('N16 under the day title: the city and the count', sub === `Bangkok, ${nToday} captures`, sub);
    check('N16 rows: time stamp with "hrs", a timeline dot (blue for a partner row), no kind label', await G.$$eval('#records .row', (els) => els.every((e) =>
      /^\d{4} hrs$/.test(e.querySelector('.when').textContent) && !!e.querySelector('.spine .pin') && !/\b(note|journal)\b/i.test(e.querySelector('.line1').textContent))));

    // ---------- no fresh fix at open (indoors, airplane mode), found on the Pixel 24/10/26 ----------
    // A first satellite fix indoors with no network location takes longer than 5 s. The last fix
    // the app saw (under 5 min old) gives chips at once; the open-time request waits up to 30 s
    // and takes a fix up to 5 min old; a fresh fix replaces the stand-in when it comes.
    await offline(true);
    const minuteAgo = new Date(Date.now() - 60000).toISOString();
    await G.evaluate(({ p, at }) => { __geo.mode = 'hold'; __geo.pending = []; return meta.set('last_fix', { lat: p.lat, lng: p.lng, at }); }, { p: spot, at: minuteAgo });
    await openNew(G);
    await G.waitForFunction(() => !!cap.fix, null, { timeout: 3000 }).catch(() => {});
    await chipsSettled(G);
    cs = await chips(G);
    check('N17 no fix yet, last fix 1 min old at a named spot: own chips at once, offline, nearest first',
      cs.map((c) => c.name).join() === 'Soi 23 noodle stall,Health Land Asoke', JSON.stringify(cs));
    check('N17 the open-time request waits up to 30 s and accepts a fix up to 5 min old', await G.evaluate(() => __geo.lastOpts.timeout === 30000
      && __geo.lastOpts.maximumAge === 300000 && __geo.lastOpts.enableHighAccuracy === true && __geo.pending.length === 1));
    await G.evaluate((p) => { __geo.fix = p; __geo.pending.shift()(); }, move(spot, 2000, 0));
    await G.waitForFunction(() => cap.fix && Math.abs(cap.fix.lat - __geo.fix.lat) < 1e-9, null, { timeout: 3000 }).catch(() => {});
    await chipsSettled(G);
    check('N17 the fresh fix replaces the stand-in: 2 km away, no chips', (await chips(G)).length === 0 && await G.evaluate(() => cap.fix.standIn === false)
      && await G.evaluate(() => idb.get('meta', 'last_fix').then((m) => Math.abs(m.value.lat - __geo.fix.lat) < 1e-9)));
    await G.click('#cap-close');
    await waitCap(G, false);
    await G.evaluate(() => idb.del('drafts', 'new'));
    await G.evaluate(({ p, at }) => { __geo.pending = []; return meta.set('last_fix', { lat: p.lat, lng: p.lng, at }); }, { p: spot, at: new Date(Date.now() - 600000).toISOString() });
    await openNew(G);
    await G.waitForTimeout(400);
    check('N17 a last fix 10 min old is not used: no chips, the hint says no GPS', (await chips(G)).length === 0
      && await G.evaluate(() => cap.fix === null) && (await G.getAttribute('#cap-place', 'placeholder')) === 'no GPS');
    await G.click('#cap-close');
    await waitCap(G, false);
    await G.evaluate(() => idb.del('drafts', 'new'));
    await offline(false);
    const osm5 = mock.osm.calls.length;
    await G.evaluate(({ p, at }) => { __geo.mode = 'hold'; __geo.pending = []; return meta.set('last_fix', { lat: p.lat, lng: p.lng, at }); }, { p: later, at: minuteAgo });
    await openNew(G);
    await G.waitForFunction(() => !!cap.fix, null, { timeout: 3000 }).catch(() => {});
    await chipsSettled(G);
    check('N17 online with only a stand-in position: no OpenStreetMap request until a fresh fix', mock.osm.calls.length === osm5 && await G.evaluate(() => cap.fix.standIn === true));
    await G.evaluate((p) => { __geo.fix = p; __geo.pending.shift()(); }, later);
    await G.waitForFunction(() => cap.fix && cap.fix.standIn === false, null, { timeout: 3000 }).catch(() => {});
    await chipsSettled(G);
    check('N17 the fresh fix then gets the map chip (cached here, so still no new request)', (await chips(G)).some((c) => c.name === 'Chatuchak Market'), JSON.stringify(await chips(G)));
    await G.click('#cap-close');
    await waitCap(G, false);
    await G.evaluate(() => idb.del('drafts', 'new'));
    await offline(true);
    await G.evaluate((p) => { __geo.mode = 'grant'; __geo.fix = p; }, move(spot, 10, 10));
    await openNew(G);
    await G.fill('#cap-body', 'Fix kept for next time');
    await save(G);
    await G.waitForFunction((p) => idb.get('meta', 'last_fix').then((m) => m && Math.abs(m.value.lat - p.lat) < 1e-9), move(spot, 10, 10), { timeout: 3000 }).catch(() => {});
    check('N17 a Save\'s fix becomes the last fix', await G.evaluate((p) => idb.get('meta', 'last_fix').then((m) => !!m && Math.abs(m.value.lat - p.lat) < 1e-9), move(spot, 10, 10)));
    await offline(false);
    await syncIdle(G);

    // ---------- address when OpenStreetMap has no name (Gary's decision 24/10/26, v13) ----------
    const hdb = move(BASE_POS, 0, -9000);
    mock.osm.name = '';
    mock.osm.address = (lat) => (Math.abs(lat - hdb.lat) < 0.002
      ? { house_number: '238', road: 'Tampines Street 21', neighbourhood: 'Tampines East', city: 'Singapore', postcode: '520238', country: 'Singapore', country_code: 'sg' }
      : { neighbourhood: 'Somewhere', city: 'Singapore', country: 'Singapore', country_code: 'sg' });
    const osm6 = mock.osm.calls.length;
    await G.evaluate((p) => { __geo.mode = 'grant'; __geo.fix = p; }, hdb);
    await openNew(G);
    await G.waitForFunction(() => cap.fix && cap.fix.standIn === false, null, { timeout: 3000 }).catch(() => {});
    await chipsSettled(G);
    cs = await chips(G);
    check('N18 no name but an address: the map chip offers house number and street, with the credit', cs.length === 1 && cs[0].src === 'osm'
      && cs[0].name === '238 Tampines Street 21' && await shown(G, '#cap-osm') && (await G.inputValue('#cap-place')) === '', JSON.stringify(cs));
    await G.click('#cap-close');
    await waitCap(G, false);
    await G.evaluate(() => idb.del('drafts', 'new'));
    const labels = await G.evaluate(() => [
      osmLabel({ name: 'Tampines Mall', address: { house_number: '4', road: 'Tampines Central 5' } }),
      osmLabel({ name: '', address: { road: 'Sukhumvit Soi 23' } }),
      osmLabel({ name: ' ', address: { house_number: '12', pedestrian: 'Haji Lane' } }),
      osmLabel({ name: '', address: { house_number: '9', neighbourhood: 'Tampines East' } }),
      osmLabel({ name: '', address: null }), osmLabel(null)]);
    check('N18 a name wins over the address; a street alone, or a pedestrian street, works; a house number with no street gives nothing',
      JSON.stringify(labels) === JSON.stringify(['Tampines Mall', 'Sukhumvit Soi 23', '12 Haji Lane', null, null, null]), JSON.stringify(labels));
    await G.evaluate(async (p) => { await idb.put('geocache', { key: geoKey(p.lat, p.lng).slice(2), name: null, at: '2026-10-24T05:00:00Z' }); }, hdb);
    check('N18 v12 cache keys (no "a:") are not read, so an old empty answer cannot hide the address', await G.evaluate((p) => geoKey(p.lat, p.lng).startsWith('a:'), hdb)
      && mock.osm.calls.length === osm6 + 1);
    mock.osm.address = null;
  } finally {
    await browser.close();
    srv.close();
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed} of ${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
