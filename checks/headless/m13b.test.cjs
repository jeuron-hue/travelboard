// travelboard 0.16.x headless tests (TESTS.md, 0.16.1). Run from the repo root:
//   node checks/headless/m13b.test.cjs
// Drives trip.html in Chromium against harness.cjs, with Nominatim mocked, reverse and search (no
// request ever leaves for the real one).
// SPEC.md 7C.4 (0.16.1, 30/10/26): the chip for the place the phone is in, from Nominatim search.
// Fixtures are the live answers of 30/10/26 at the step 9 point (1.35417, 103.94492): "mall" gives
// Tampines 1 (way 166194476) and Eastlink Mall, "station" gives Tampines (way 397901195, a box
// round the whole interchange), "hotel" nothing. There the chips read "Tampines 1" then "Atrix"
// (Tampines 1 is the smallest box that holds the point; the station's holds it too); a point
// inside Eastlink only gives Eastlink Mall; results whose box does not hold the point, or whose
// kind does not match, give no chip; the four requests (reverse first, then mall, station,
// hotel) go one at a time, a second apart; the search URL is bounded to a viewbox about 150 m
// each side; the answer is cached under "p:" in the same 50 m cell (a second capture there asks
// nothing), an empty answer too; a failed search gives no area chip, leaves the nearest name
// and is not cached; no two chips alike, at most three, own names first; offline no request.
// SPEC.md 7.2 (0.16.0): Locate on a new capture. A fresh fix (maximumAge 0, high accuracy, 15 s),
// "Locating" while it waits, the hint with the accuracy, the chips reloaded for the new
// position, the fix saved as the capture's coordinates with no fix fired after Save, kept in the
// draft, an open-time fix arriving later never overrides it; denied and timed out each say so
// in one line and keep the old position; works offline (no lookup; in a cell never looked up the
// chips are own names only); not on the edit screen.
// Exit code 0 only when every check passes.
'use strict';
const fs = require('fs');
const { until, launch, startServer, makeMock, attachMock, newContext, UID } = require('./harness.cjs');

const PORT = 8737;
const BASE = `http://127.0.0.1:${PORT}/`;
const APP = fs.readFileSync(require('path').join(__dirname, '..', '..', 'trip.html'), 'utf8').match(/const APP_VERSION = '([0-9.]+)';/)[1];
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail && !ok ? '  [' + detail + ']' : '')); };

const waitCap = (page, open) => page.waitForFunction((o) => document.getElementById('cap').hidden === !o && (!o || !popWait), open, { timeout: 5000 });
const shown = (page, sel) => page.$eval(sel, (e) => !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length));
const text = (page, sel) => page.$eval(sel, (e) => e.textContent);
const chips = (page) => page.$$eval('#cap-chips .pchip', (els) => els.map((e) => ({ name: e.dataset.place, src: e.dataset.source })));
const names = async (page) => (await chips(page)).map((c) => c.name);

// Live Nominatim answers, 30/10/26, for q=mall and q=station around the step 9 point (q=hotel: []).
const nom = (osm_id, category, type, name, bb, lat, lon) => ({ place_id: osm_id, osm_type: 'way', osm_id, lat, lon, category, type, name,
  display_name: name + ', Singapore', boundingbox: bb });
const T1 = nom(166194476, 'shop', 'mall', 'Tampines 1', ['1.3536385', '1.3547970', '103.9445343', '103.9454900'], '1.3542200', '103.9451247');
const EASTLINK = nom(1167087012, 'shop', 'mall', 'Eastlink Mall', ['1.3540190', '1.3547032', '103.9439447', '103.9446259'], '1.3543254', '103.9443553');
const STATION = nom(397901195, 'railway', 'station', 'Tampines', ['1.3526267', '1.3558318', '103.9424512', '103.9457151'], '1.3542858', '103.9446184');
const TAMP = { lat: 1.35417, lng: 103.94492 };                   // step 9: inside Tampines 1 (and the station's box)
const EAST = { lat: 1.35430, lng: 103.94440 };                   // inside Eastlink (and the station's box) only
const OUT = { lat: 1.35330, lng: 103.94620 };                    // Tampines 1 found nearby, but no box holds it
// Made-up places elsewhere, as Nominatim would answer them.
const near = (a, b) => Math.abs(a.lat - b.lat) < 0.003 && Math.abs(a.lng - b.lng) < 0.003;
const box = (p, d) => [String(p.lat - d), String(p.lat + d), String(p.lng - d), String(p.lng + d)];
const at4 = (p) => [String(p.lat), String(p.lng)];
const BKK = { lat: 13.7462, lng: 100.5347 };
const SIAM = nom(4, 'shop', 'mall', 'Siam Paragon', box(BKK, 0.001), ...at4(BKK));            // accept-language=en gives the English name
const BKK_HOTEL = nom(5, 'tourism', 'hotel', 'Siam Kempinski', box(BKK, 0.0003), ...at4(BKK)); // smaller than the mall: wins
const FAIL = { lat: 1.3700, lng: 103.9700 };
const FAIL_MALL = nom(6, 'shop', 'mall', 'Fail Plaza', box(FAIL, 0.001), ...at4(FAIL));
const SAME = { lat: 1.3800, lng: 103.9800 };
const SAME_MALL = nom(7, 'shop', 'mall', 'Same Name Mall', box(SAME, 0.001), ...at4(SAME));
const OWNS = { lat: 1.3900, lng: 103.9900 };
const OWNS_MALL = nom(8, 'shop', 'mall', 'Owns Mall', box(OWNS, 0.001), ...at4(OWNS));
const LOC = { lat: 1.3450, lng: 103.9530 };                      // where Locate finds the phone
const LOC_HOTEL = nom(9, 'tourism', 'hotel', 'Locate Hotel', box(LOC, 0.001), ...at4(LOC));
const KOPI = nom(10, 'amenity', 'food_court', 'Kopitiam', box(OUT, 0.0005), ...at4(OUT));      // holds OUT, but not a mall
const ANSWERS = { mall: [T1, EASTLINK, SIAM, FAIL_MALL, SAME_MALL, OWNS_MALL, KOPI], station: [STATION], hotel: [BKK_HOTEL, LOC_HOTEL] };
// Like Nominatim with bounded=1: the results of that query whose centre lies inside the viewbox.
const search = (q, v) => (ANSWERS[q] || []).filter((r) => +r.lat <= v.n && +r.lat >= v.s && +r.lon >= v.w && +r.lon <= v.e);

async function openNew(page) {
  await page.click('#tab-captures');
  await page.click('#capture');
  await waitCap(page, true);
}
async function close(page) {
  await page.click('#cap-close');
  await waitCap(page, false);
  await page.waitForFunction(() => !popWait);
}
async function save(page) {
  await page.click('#cap-save');
  await waitCap(page, false);
  await page.waitForFunction(() => !popWait);
}
// Wait until a fresh fix is in and both map lookups, if started, have answered (the four requests
// take three seconds or more: one a second).
async function settled(page) {
  await page.waitForFunction(() => !cap.open || (cap.fix && !cap.fix.standIn), null, { timeout: 5000 }).catch(() => {});
  await page.waitForFunction(() => !cap.open || ((!cap.osm || cap.osm.done) && (!cap.area || cap.area.done)), null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(80);
}
async function at(page, pos) { await page.evaluate((p) => { __geo.mode = 'grant'; __geo.fix = p; __geo.acc = 0; }, pos); }

(async () => {
  const srv = await startServer(PORT);
  const browser = await launch();
  const mock = makeMock();
  mock.osm.name = (lat, lng) => (near({ lat, lng }, OUT) && Math.abs(lat - OUT.lat) < 0.0002 ? 'Bus Stop 75009' : near({ lat, lng }, EAST) && Math.abs(lng - EAST.lng) < 0.0002 ? 'Eastlink Food Hall'
    : near({ lat, lng }, TAMP) ? 'Atrix' : near({ lat, lng }, BKK) ? 'Gourmet Market' : near({ lat, lng }, FAIL) ? 'Fail Street Stall'
    : near({ lat, lng }, SAME) ? 'same name mall' : near({ lat, lng }, OWNS) ? 'Owns Kiosk' : near({ lat, lng }, LOC) ? 'Locate Kopitiam' : '');
  mock.osm.search = search;
  const ctx = await newContext(browser, { tz: 'Asia/Singapore', session: true, uid: UID });
  const net = { offline: false, name: 'gary' };
  await attachMock(ctx, mock, net);
  await ctx.grantPermissions(['geolocation']);
  const G = await ctx.newPage();
  G.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  G.on('dialog', (d) => { check('no browser dialog: ' + d.message(), false); d.dismiss(); });
  await G.goto(BASE + 'trip.html');
  await G.waitForFunction(() => document.getElementById('day-label').textContent !== '-');
  const offline = async (on) => { net.offline = on; await ctx.setOffline(on); await G.evaluate((o) => window.dispatchEvent(new Event(o ? 'offline' : 'online')), on); };
  const counts = () => ({ rev: mock.osm.calls.length, srch: mock.osm.searches.length, all: mock.osm.all.length });

  try {
    check(`A0 v${APP}`, (await G.evaluate(() => APP_VERSION)) === APP, APP);
    check('A0 no Overpass left: no OVERPASS_URL, no areaQuery', await G.evaluate(() => typeof OVERPASS_URL === 'undefined' && typeof areaQuery === 'undefined'));

    // ---------- the step 9 point, inside Tampines 1 ----------
    await at(G, TAMP);
    let c0 = counts();
    await openNew(G);
    await settled(G);
    let cs = await chips(G);
    check('A1 inside Tampines 1: the chips read "Tampines 1" then "Atrix" (place you are in, then nearest)',
      JSON.stringify(cs) === JSON.stringify([{ name: 'Tampines 1', src: 'area' }, { name: 'Atrix', src: 'osm' }]), JSON.stringify(cs));
    check('A1 the station\'s box holds the point too, and the smaller box (Tampines 1) wins',
      TAMP.lat >= +STATION.boundingbox[0] && TAMP.lat <= +STATION.boundingbox[1] && TAMP.lng >= +STATION.boundingbox[2] && TAMP.lng <= +STATION.boundingbox[3]);
    check('A1 the OSM credit shows with the map chips; nothing filled in', await shown(G, '#cap-osm')
      && (await text(G, '#cap-osm')).includes('OpenStreetMap contributors') && (await G.inputValue('#cap-place')) === '');
    const four = mock.osm.all.slice(c0.all);
    const qs = four.map((c) => (c.path === '/reverse' ? 'reverse' : c.q.q));
    check('A2 four Nominatim requests: reverse first, then search mall, station, hotel', JSON.stringify(qs) === JSON.stringify(['reverse', 'mall', 'station', 'hotel']), JSON.stringify(qs));
    const sq = four[1] ? four[1].q : {};
    check('A2 each search: jsonv2, bounded, limit 10, English, a viewbox about 150 m each side of the point',
      four.slice(1).every((c) => c.q.format === 'jsonv2' && c.q.bounded === '1' && c.q.limit === '10' && c.q['accept-language'] === 'en'
        && c.q.viewbox === '103.943572,1.355517,103.946268,1.352823'), JSON.stringify(sq));
    const gaps = four.slice(1).map((c, i) => c.at - four[i].at);
    check('A2 one request at a time, at least a second apart, across the reverse and the three searches', four.length === 4 && gaps.every((g) => g >= 950), JSON.stringify(gaps));
    check('A3 the answer is cached under "p:" in the same 50 m cell as the reverse answer',
      await G.evaluate((p) => idb.get('geocache', areaKey(p.lat, p.lng)).then((x) => !!x && x.name === 'Tampines 1' && x.key.startsWith('p:') && x.key.slice(1) === geoKey(p.lat, p.lng).slice(1)), TAMP));
    await G.click('#cap-chips .pchip[data-source="area"]');
    await G.fill('#cap-body', 'In the mall');
    check('A4 a tap on the mall chip fills the field with "Tampines 1"', (await G.inputValue('#cap-place')) === 'Tampines 1');
    await save(G);
    await until(G, () => idb.all('captures').then((a) => a.some((r) => r.body === 'In the mall' && r.lat != null)), null, { timeout: 3000 }).catch(() => {});
    let row = (await G.evaluate(() => idb.all('captures'))).find((r) => r.body === 'In the mall');
    check('A4 saved with place_name "Tampines 1"', row && row.place_name === 'Tampines 1', JSON.stringify(row && row.place_name));

    // A second capture at the same spot: the cache answers, nothing is asked.
    c0 = counts();
    await openNew(G);
    await settled(G);
    cs = await names(G);
    check('A5 a second capture at the same spot makes no request (cache hit)', mock.osm.all.length === c0.all, String(mock.osm.all.length - c0.all));
    check('A5 and offers "Tampines 1" as an own name first, then "Atrix"; the area chip is not repeated',
      JSON.stringify(cs) === JSON.stringify(['Tampines 1', 'Atrix']) && (await chips(G))[0].src === 'own', JSON.stringify(await chips(G)));
    await close(G);

    // ---------- inside Eastlink only; nothing holding the point ----------
    await at(G, EAST);
    await openNew(G);
    await settled(G);
    cs = await chips(G);
    check('A6 a point inside Eastlink Mall (and the station\'s box, not Tampines 1\'s): the saved "Tampines 1" nearby as an own name, then "Eastlink Mall", then its nearest name',
      JSON.stringify(cs) === JSON.stringify([{ name: 'Tampines 1', src: 'own' }, { name: 'Eastlink Mall', src: 'area' }, { name: 'Eastlink Food Hall', src: 'osm' }]), JSON.stringify(cs));
    await close(G);
    c0 = counts();
    await at(G, OUT);
    await openNew(G);
    await settled(G);
    cs = await chips(G);
    const got = mock.osm.searches.slice(c0.srch).map((c) => search(c.q.q, (([w, n, e, s]) => ({ w, n, e, s }))(c.q.viewbox.split(',').map(Number))).map((r) => r.name));
    check('A7 Tampines 1 and a food court come back, but no mall, station or hotel box holds the point: no area chip, the nearest name alone',
      JSON.stringify(cs) === JSON.stringify([{ name: 'Bus Stop 75009', src: 'osm' }]) && got.flat().includes('Tampines 1') && got.flat().includes('Kopitiam'), JSON.stringify([cs, got]));
    check('A7 the empty answer is cached under "p:"', await G.evaluate((p) => idb.get('geocache', areaKey(p.lat, p.lng)).then((x) => !!x && x.name === null), OUT));
    await close(G);

    // ---------- smallest across kinds; the English name ----------
    await at(G, BKK);
    await openNew(G);
    await settled(G);
    cs = await names(G);
    check('A8 a hotel inside a mall: the smaller box (the hotel) wins, then the nearest name', JSON.stringify(cs) === JSON.stringify(['Siam Kempinski', 'Gourmet Market']), JSON.stringify(cs));
    await close(G);

    // ---------- a failed search: the nearest name stays, nothing cached ----------
    for (const mode of ['http', 'network']) {
      await G.evaluate(() => idb.all('geocache').then((a) => Promise.all(a.filter((x) => x.key.startsWith('p:')).map((x) => idb.del('geocache', x.key)))));
      mock.osm.searchFail = mode;
      await at(G, FAIL);
      c0 = counts();
      await openNew(G);
      await settled(G);
      cs = await chips(G);
      check(`A9 a search fails (${mode}): "Fail Street Stall" (nearest) alone, the credit shown, no error on screen`,
        JSON.stringify(cs) === JSON.stringify([{ name: 'Fail Street Stall', src: 'osm' }]) && await shown(G, '#cap-osm') && (await text(G, '#cap-locate-msg')) === ''
        && mock.osm.searches.length === c0.srch + 1, JSON.stringify([cs, mock.osm.searches.length - c0.srch]));
      check(`A9 after the failure (${mode}) nothing is cached under "p:" for that cell`,
        await G.evaluate((p) => idb.get('geocache', areaKey(p.lat, p.lng)).then((x) => !x), FAIL));
      await close(G);
      mock.osm.searchFail = null;
      c0 = counts();
      await openNew(G);
      await settled(G);
      check(`A9 the next opening (${mode}) asks again (three searches, no second reverse) and gets the mall`, mock.osm.searches.length === c0.srch + 3 && mock.osm.calls.length === c0.rev
        && JSON.stringify(await names(G)) === JSON.stringify(['Fail Plaza', 'Fail Street Stall']), JSON.stringify(await names(G)));
      await close(G);
    }

    // ---------- no two alike; at most three, own names first ----------
    await at(G, SAME);
    await openNew(G);
    await settled(G);
    cs = await chips(G);
    check('A10 the area and the nearest name differ only in case: one chip', JSON.stringify(cs) === JSON.stringify([{ name: 'Same Name Mall', src: 'area' }]), JSON.stringify(cs));
    await close(G);
    await G.evaluate((p) => {
      const mk = (n, name) => ({ id: crypto.randomUUID(), body: 'own ' + n, kind: 'note', captured_at: new Date(Date.now() - n * 60000).toISOString(), tz: 'Asia/Singapore',
        local_date: todayLocal(), lat: p.lat + n * 0.00005, lng: p.lng, accuracy_m: 5, place_name: name, updated_at: new Date().toISOString(), deleted_at: null, shared: false, dirty: 0, server_ts: 'x' });
      return Promise.all([idb.put('captures', mk(1, 'Owns Mall')), idb.put('captures', mk(2, 'Kopi Corner')), idb.put('captures', mk(3, 'Bus Stop B'))]);
    }, OWNS);
    await at(G, OWNS);
    c0 = counts();
    await openNew(G);
    await settled(G);
    cs = await chips(G);
    check('A11 three own names in range: three own chips, no request, no map chip',
      cs.length === 3 && cs.every((c) => c.src === 'own') && !(await shown(G, '#cap-osm')) && mock.osm.all.length === c0.all, JSON.stringify(cs));
    await close(G);
    await G.evaluate(() => idb.all('captures').then((a) => { const r = a.find((x) => x.place_name === 'Bus Stop B'); return idb.put('captures', Object.assign({}, r, { deleted_at: new Date().toISOString() })); }));
    await openNew(G);
    await settled(G);
    cs = await chips(G);
    check('A11 two own names, one of them the area\'s: own, own, then the nearest name (three at most, no repeat)',
      JSON.stringify(cs.map((c) => c.src)) === JSON.stringify(['own', 'own', 'osm']) && cs[2].name === 'Owns Kiosk' && !cs.some((c) => c.src === 'area'), JSON.stringify(cs));
    await close(G);

    // ---------- offline: no request ----------
    await offline(true);
    await at(G, { lat: 1.2201, lng: 103.8201 });
    c0 = counts();
    await openNew(G);
    await settled(G);
    check('A12 offline: no Nominatim request of either kind, no map chip', mock.osm.all.length === c0.all && !(await shown(G, '#cap-osm')));
    await close(G);
    await offline(false);

    // ---------- Locate (7.2) ----------
    await G.evaluate(() => idb.del('drafts', 'new'));
    await at(G, TAMP);
    await openNew(G);
    await settled(G);
    const lb = await G.evaluate(() => { const b = document.getElementById('cap-locate').getBoundingClientRect(); return { w: b.width, h: b.height, label: document.getElementById('cap-locate').getAttribute('aria-label') }; });
    check('B1 new capture: a Locate button beside the Place field, at least 44 px', await shown(G, '#cap-locate') && lb.w >= 44 && lb.h >= 44
      && await G.evaluate(() => document.getElementById('cap-locate').closest('.placefield') !== null), JSON.stringify(lb));
    check('B1 before Locate the hint is the open-time position, no accuracy', (await G.getAttribute('#cap-place', 'placeholder')) === '1.3542, 103.9449');
    await G.evaluate((p) => { __geo.mode = 'hold'; __geo.fix = p; __geo.acc = 8.4; __geo.pending = []; }, LOC);
    let c1 = counts();
    await G.click('#cap-locate');
    const opts = await G.evaluate(() => __geo.lastOpts);
    check('B2 Locate asks for a fresh fix: high accuracy, maximumAge 0, 15 s', opts && opts.enableHighAccuracy === true && opts.maximumAge === 0 && opts.timeout === 15000, JSON.stringify(opts));
    check('B2 while it waits: "Locating", the button busy and off', (await text(G, '#cap-locate-msg')) === 'Locating'
      && (await G.getAttribute('#cap-locate', 'aria-busy')) === 'true' && await G.isDisabled('#cap-locate'));
    await G.evaluate(() => { const f = __geo.pending.pop(); f && f(); });
    await G.waitForFunction(() => !!cap.located, null, { timeout: 3000 }).catch(() => {});
    await settled(G);
    check('B3 the hint shows the new coordinates with the accuracy ("±8 m"); the Locating line goes',
      (await G.getAttribute('#cap-place', 'placeholder')) === '1.3450, 103.9530 ±8 m' && (await text(G, '#cap-locate-msg')) === '' && !(await G.isDisabled('#cap-locate')),
      await G.getAttribute('#cap-place', 'placeholder'));
    // The chips for the located fix are looked up after it lands: wait for that reverse lookup to be asked.
    for (const end = Date.now() + 5000; mock.osm.calls.length === c1.rev && Date.now() < end;) await G.waitForTimeout(50);
    await settled(G);
    cs = await names(G);
    check('B3 the chips reload for the new position (its hotel and nearest name; Tampines gone)', JSON.stringify(cs) === JSON.stringify(['Locate Hotel', 'Locate Kopitiam'])
      && mock.osm.searches.length === c1.srch + 3 && mock.osm.calls.length === c1.rev + 1 && mock.osm.calls[c1.rev].q.lat === '1.345000', JSON.stringify(cs));
    // An open-time fix arriving after Locate never takes over.
    await G.evaluate(() => { cap.located && fixAtOpen(cap.seq); });
    await G.evaluate((p) => { __geo.fix = p; const f = __geo.pending.pop(); f && f(); }, TAMP);
    await G.waitForTimeout(150);
    check('B4 a later open-time fix does not replace the located one', (await G.getAttribute('#cap-place', 'placeholder')) === '1.3450, 103.9530 ±8 m');
    // Kept in the draft: close and reopen.
    await G.fill('#cap-body', 'Located capture');
    await close(G);
    const draft = await G.evaluate(() => idb.get('drafts', 'new'));
    check('B5 the located fix is kept in the draft', draft && draft.located && draft.located.lat === 1.345 && draft.located.acc === 8.4, JSON.stringify(draft && draft.located));
    await G.evaluate(() => { __geo.mode = 'hold'; __geo.pending = []; });
    await openNew(G);
    await G.waitForTimeout(150);
    check('B5 reopened, the hint is the located fix with its accuracy', (await G.getAttribute('#cap-place', 'placeholder')) === '1.3450, 103.9530 ±8 m');
    const calls0 = await G.evaluate(() => __geo.calls);
    await save(G);
    await G.evaluate(() => { __geo.mode = 'grant'; __geo.fix = { lat: 1.3, lng: 103.8 }; (__geo.pending || []).splice(0).forEach((f) => f()); });
    await G.waitForTimeout(400);
    row = (await G.evaluate(() => idb.all('captures'))).find((r) => r.body === 'Located capture');
    check('B6 saved with the located coordinates and accuracy (1.3450, 103.9530, 8.4 m)', row && row.lat === 1.345 && row.lng === 103.953 && row.accuracy_m === 8.4, JSON.stringify(row && [row.lat, row.lng, row.accuracy_m]));
    check('B6 no fix is fired after Save, so nothing moves it later', (await G.evaluate(() => __geo.calls)) === calls0, String((await G.evaluate(() => __geo.calls)) - calls0));
    check('B6 the row\'s place shows those coordinates', (await G.$eval(`.row[data-id="${row && row.id}"] .place`, (e) => e.textContent).catch(() => null)) === '1.3450, 103.9530');

    // Denied and timed out: one line, the old position stays.
    for (const [mode, line] of [['deny', /^Location is blocked for travelboard\. Allow it in Chrome.s site settings\. The earlier position stays\.$/], ['timeout', /^No fix within 15 s\. The earlier position stays\.$/]]) {
      await at(G, TAMP);
      await openNew(G);
      await settled(G);
      const before = await G.getAttribute('#cap-place', 'placeholder');
      await G.evaluate((m) => { __geo.mode = m; }, mode);
      await G.click('#cap-locate');
      await G.waitForFunction(() => document.getElementById('cap-locate-msg').textContent !== 'Locating', null, { timeout: 3000 }).catch(() => {});
      const msg = await text(G, '#cap-locate-msg');
      check(`B7 Locate ${mode === 'deny' ? 'denied' : 'timed out'}: one line says so; the old position and chips stay`,
        line.test(msg) && (await G.getAttribute('#cap-place', 'placeholder')) === before && before === '1.3542, 103.9449'
        && JSON.stringify(await names(G)) === JSON.stringify(['Tampines 1', 'Atrix']) && !(await G.isDisabled('#cap-locate')) && await G.evaluate(() => !cap.located), msg);
      await close(G);
      await G.evaluate(() => idb.del('drafts', 'new'));
    }

    // Offline: the fix works, chips from own names only.
    await at(G, TAMP);
    await offline(true);
    c1 = counts();
    await openNew(G);
    await settled(G);
    // 55 m north: a 50 m cell never looked up, with the saved "Tampines 1" still within 75 m.
    await G.evaluate(() => { __geo.mode = 'grant'; __geo.fix = { lat: 1.35467, lng: 103.94492 }; __geo.acc = 20; });
    await G.click('#cap-locate');
    await G.waitForFunction(() => !!cap.located, null, { timeout: 3000 }).catch(() => {});
    await settled(G);
    cs = await chips(G);
    check('B8 offline in a cell never looked up: Locate gives a fix ("±20 m"), the chips are own names only, no request',
      (await G.getAttribute('#cap-place', 'placeholder')) === '1.3547, 103.9449 ±20 m' && cs.every((c) => c.src === 'own') && cs.some((c) => c.name === 'Tampines 1')
      && mock.osm.all.length === c1.all, JSON.stringify(cs));
    await close(G);
    await G.evaluate(() => idb.del('drafts', 'new'));
    await offline(false);

    // Not on the edit screen.
    await G.click(`.row[data-id="${row.id}"]`);
    await waitCap(G, true);
    check('B9 the edit screen has no Locate button', !(await shown(G, '#cap-locate')) && (await G.$eval('#cap-locate', (e) => e.hidden)));
    await close(G);
    await openNew(G);
    check('B9 back on a new capture it is there again, idle', await shown(G, '#cap-locate') && (await text(G, '#cap-locate-msg')) === '');
    await close(G);

    // Light and dark: the button in ink blue, the message muted.
    for (const theme of ['light', 'dark']) {
      await G.evaluate((t) => applyTheme(t), theme);
      await openNew(G);
      const c = await G.evaluate(() => ({ btn: getComputedStyle(document.getElementById('cap-locate')).color, blue: getComputedStyle(document.documentElement).getPropertyValue('--blue').trim() }));
      const want = theme === 'light' ? 'rgb(47, 85, 119)' : 'rgb(141, 180, 217)';
      check(`B10 ${theme}: the Locate button in the theme's ink blue`, c.btn === want, JSON.stringify(c));
      await close(G);
    }
    await G.evaluate(() => applyTheme('light'));
  } finally {
    await browser.close();
    srv.close();
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed} of ${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
