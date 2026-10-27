// travelboard 0.16.0 headless tests (TESTS.md, M1.3, 0.16.0). Run from the repo root:
//   node checks/headless/m13b.test.cjs
// Drives trip.html in Chromium against harness.cjs, with Nominatim and Overpass both mocked (no
// request ever leaves for the real ones).
// SPEC.md 7C.4 (27/10/26): the chip for the place the phone is in, from Overpass is_in. At the
// Tampines 1 point (step 9, 27/10/26) the chips read "Tampines 1" then "Atrix"; the smallest
// enclosing area wins; name:en before name; the request is a POST of an is_in query asking only
// for the named kinds 7C.4 lists, with tags and bounding boxes; the answer is cached under "e:"
// in the same 50 m cell (a second capture there asks neither service); an empty answer is
// cached too; a failed lookup (HTTP or network) gives no area chip, leaves the nearest-name chip
// alone and is not cached; no two chips alike and at most three, own names first; offline no
// request; one Overpass request at a time.
// SPEC.md 7.2 (27/10/26): Locate on a new capture. A fresh fix (maximumAge 0, high accuracy,
// 15 s), "Locating" while it waits, the hint with the accuracy, the chips reloaded for the new
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

// Tampines 1 (way 166194476, shop=mall) around the step 9 point, and other fixtures.
const TAMP = { lat: 1.35417, lng: 103.94492 };
const box = (lat, lng, dLat, dLng) => ({ minlat: lat - dLat, minlon: lng - dLng, maxlat: lat + dLat, maxlon: lng + dLng });
const inBox = (b, lat, lng) => lat >= b.minlat && lat <= b.maxlat && lng >= b.minlon && lng <= b.maxlon;
const T1 = { id: 166194476, name: 'Tampines 1', tags: { shop: 'mall' }, bounds: { minlat: 1.3534, minlon: 103.9442, maxlat: 1.3550, maxlon: 103.9458 } };
const NEST = { lat: 1.3600, lng: 103.9600 };                     // three areas, one inside another
const NESTED = [
  { id: 1, name: 'Big Retail Area', tags: { landuse: 'retail' }, bounds: box(NEST.lat, NEST.lng, 0.005, 0.005) },
  { id: 2, name: 'Small Hall', tags: { building: 'yes' }, bounds: box(NEST.lat, NEST.lng, 0.0002, 0.0002) },
  { id: 3, name: 'Middle Park', tags: { leisure: 'park' }, bounds: box(NEST.lat, NEST.lng, 0.001, 0.001) }
];
const BKK = { lat: 13.7462, lng: 100.5347 };                     // a Thai name with name:en
const SIAM = { id: 4, name: 'สยามพารากอน', tags: { shop: 'mall', 'name:en': 'Siam Paragon' }, bounds: box(BKK.lat, BKK.lng, 0.001, 0.001) };
const FAIL = { lat: 1.3700, lng: 103.9700 };                     // enclosing lookup fails here first
const SAME = { lat: 1.3800, lng: 103.9800 };                     // area and nearest share a name
const OWNS = { lat: 1.3900, lng: 103.9900 };                     // two own names in range
const LOC = { lat: 1.3450, lng: 103.9530 };                      // where Locate finds the phone
const AREAS = [
  [T1, (lat, lng) => inBox(T1.bounds, lat, lng)],
  ...NESTED.map((a) => [a, (lat, lng) => inBox(a.bounds, lat, lng)]),
  [SIAM, (lat, lng) => inBox(SIAM.bounds, lat, lng)],
  [{ id: 5, name: 'Fail Plaza', tags: { shop: 'mall' }, bounds: box(FAIL.lat, FAIL.lng, 0.001, 0.001) }, (lat, lng) => inBox(box(FAIL.lat, FAIL.lng, 0.001, 0.001), lat, lng)],
  [{ id: 6, name: 'Same Name Mall', tags: { shop: 'mall' }, bounds: box(SAME.lat, SAME.lng, 0.001, 0.001) }, (lat, lng) => inBox(box(SAME.lat, SAME.lng, 0.001, 0.001), lat, lng)],
  [{ id: 7, name: 'Owns Mall', tags: { shop: 'mall' }, bounds: box(OWNS.lat, OWNS.lng, 0.001, 0.001) }, (lat, lng) => inBox(box(OWNS.lat, OWNS.lng, 0.001, 0.001), lat, lng)],
  [{ id: 8, name: 'Locate Centre', tags: { building: 'yes' }, bounds: box(LOC.lat, LOC.lng, 0.001, 0.001) }, (lat, lng) => inBox(box(LOC.lat, LOC.lng, 0.001, 0.001), lat, lng)]
];
const near = (a, b) => Math.abs(a.lat - b.lat) < 0.003 && Math.abs(a.lng - b.lng) < 0.003;

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
// Wait until a fresh fix is in and both map lookups, if started, have answered.
async function settled(page) {
  await page.waitForFunction(() => !cap.open || (cap.fix && !cap.fix.standIn), null, { timeout: 5000 }).catch(() => {});
  await page.waitForFunction(() => !cap.open || ((!cap.osm || cap.osm.done) && (!cap.area || cap.area.done)), null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(80);
}
async function at(page, pos) { await page.evaluate((p) => { __geo.mode = 'grant'; __geo.fix = p; __geo.acc = 0; }, pos); }

(async () => {
  const srv = await startServer(PORT);
  const browser = await launch();
  const mock = makeMock();
  mock.osm.name = (lat, lng) => (near({ lat, lng }, TAMP) ? 'Atrix' : near({ lat, lng }, NEST) ? 'Corner Shop'
    : near({ lat, lng }, BKK) ? 'Gourmet Market' : near({ lat, lng }, FAIL) ? 'Fail Street Stall'
    : near({ lat, lng }, SAME) ? 'same name mall' : near({ lat, lng }, OWNS) ? 'Owns Kiosk' : near({ lat, lng }, LOC) ? 'Locate Kopitiam' : '');
  mock.overpass.areas = (lat, lng) => AREAS.filter(([, inside]) => inside(lat, lng)).map(([a]) => a);
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
  const geocache = () => G.evaluate(() => idb.all('geocache'));

  try {
    check(`A0 v${APP}`, (await G.evaluate(() => APP_VERSION)) === APP, APP);

    // ---------- the Tampines 1 point (step 9, 27/10/26) ----------
    await at(G, TAMP);
    let o0 = mock.overpass.calls.length, n0 = mock.osm.calls.length;
    await openNew(G);
    await settled(G);
    let cs = await chips(G);
    check('A1 inside Tampines 1: the chips read "Tampines 1" then "Atrix" (place you are in, then nearest)',
      JSON.stringify(cs) === JSON.stringify([{ name: 'Tampines 1', src: 'area' }, { name: 'Atrix', src: 'osm' }]), JSON.stringify(cs));
    check('A1 the OSM credit shows with the map chips; nothing filled in', await shown(G, '#cap-osm')
      && (await text(G, '#cap-osm')).includes('OpenStreetMap contributors') && (await G.inputValue('#cap-place')) === '');
    const call = mock.overpass.calls[o0];
    check('A2 one Overpass request: a form POST to overpass-api.de with an is_in query at the phone\'s position',
      mock.overpass.calls.length === o0 + 1 && call.method === 'POST' && /application\/x-www-form-urlencoded/.test(call.contentType)
      && call.url === 'https://overpass-api.de/api/interpreter' && /is_in\(1\.354170,103\.944920\)->\.a;/.test(call.query), JSON.stringify(call));
    check('A2 the query asks only for the named kinds 7C.4 lists, with tags and bounding boxes, under an 8 s server timeout',
      ['[shop=mall]', '[building]', '[railway=station]', '[public_transport=station]', '[leisure=park]', '[amenity=marketplace]', '[tourism]', '[landuse=retail]']
        .every((f) => call.query.includes(`wr(pivot.a)[name]${f};`)) && /out tags bb;$/.test(call.query) && /^\[out:json\]\[timeout:8\];/.test(call.query), call.query);
    check('A2 the nearest-name lookup still goes to Nominatim once', mock.osm.calls.length === n0 + 1);
    let cache = await geocache();
    check('A3 the answer is cached under "e:" in the same 50 m cell as the Nominatim name',
      await G.evaluate((p) => idb.get('geocache', areaKey(p.lat, p.lng)).then((x) => !!x && x.name === 'Tampines 1' && x.key.startsWith('e:') && x.key.slice(1) === geoKey(p.lat, p.lng).slice(1)), TAMP),
      JSON.stringify(cache.map((c) => c.key)));
    await G.click('#cap-chips .pchip[data-source="area"]');
    await G.fill('#cap-body', 'In the mall');
    check('A4 a tap on the mall chip fills the field with "Tampines 1"', (await G.inputValue('#cap-place')) === 'Tampines 1');
    await save(G);
    await until(G, () => idb.all('captures').then((a) => a.some((r) => r.body === 'In the mall' && r.lat != null)), null, { timeout: 3000 }).catch(() => {});
    let row = (await G.evaluate(() => idb.all('captures'))).find((r) => r.body === 'In the mall');
    check('A4 saved with place_name "Tampines 1"', row && row.place_name === 'Tampines 1', JSON.stringify(row && row.place_name));

    // A second capture at the same spot: the cache answers, neither service is asked.
    o0 = mock.overpass.calls.length; n0 = mock.osm.calls.length;
    await openNew(G);
    await settled(G);
    cs = await names(G);
    check('A5 a second capture at the same spot asks neither service (cache hit)', mock.overpass.calls.length === o0 && mock.osm.calls.length === n0, `${mock.overpass.calls.length - o0} ${mock.osm.calls.length - n0}`);
    check('A5 and offers "Tampines 1" as an own name first (saved), then "Atrix"; the area chip is not repeated',
      JSON.stringify(cs) === JSON.stringify(['Tampines 1', 'Atrix']) && (await chips(G))[0].src === 'own', JSON.stringify(await chips(G)));
    await close(G);

    // ---------- the smallest enclosing area wins; name:en first ----------
    await at(G, NEST);
    await openNew(G);
    await settled(G);
    cs = await chips(G);
    check('A6 three areas enclose the point: the smallest ("Small Hall") is the chip, then the nearest name',
      JSON.stringify(cs) === JSON.stringify([{ name: 'Small Hall', src: 'area' }, { name: 'Corner Shop', src: 'osm' }]), JSON.stringify(cs));
    await close(G);
    await at(G, BKK);
    await openNew(G);
    await settled(G);
    cs = await names(G);
    check('A6 a Thai mall with name:en offers "Siam Paragon"', JSON.stringify(cs) === JSON.stringify(['Siam Paragon', 'Gourmet Market']), JSON.stringify(cs));
    await close(G);

    // ---------- the enclosing lookup fails: the nearest name stays, nothing cached ----------
    for (const mode of ['http', 'network']) {
      await G.evaluate(() => idb.all('geocache').then((a) => Promise.all(a.filter((x) => x.key.startsWith('e:')).map((x) => idb.del('geocache', x.key)))));
      mock.overpass.fail = mode;
      await at(G, FAIL);
      o0 = mock.overpass.calls.length;
      await openNew(G);
      await settled(G);
      cs = await chips(G);
      check(`A7 Overpass fails (${mode}): "Fail Street Stall" (nearest) alone, the credit shown, no error on screen`,
        JSON.stringify(cs) === JSON.stringify([{ name: 'Fail Street Stall', src: 'osm' }]) && await shown(G, '#cap-osm') && (await text(G, '#cap-locate-msg')) === ''
        && mock.overpass.calls.length === o0 + 1, JSON.stringify(cs));
      check(`A7 after the failure (${mode}) nothing is cached under "e:" for that cell`,
        await G.evaluate((p) => idb.get('geocache', areaKey(p.lat, p.lng)).then((x) => !x), FAIL));
      await close(G);
      mock.overpass.fail = null;
      await openNew(G);
      await settled(G);
      check(`A7 the next opening (${mode}) asks again and gets the mall`, mock.overpass.calls.length === o0 + 2
        && JSON.stringify(await names(G)) === JSON.stringify(['Fail Plaza', 'Fail Street Stall']), JSON.stringify(await names(G)));
      await close(G);
    }

    // ---------- no two alike; at most three, own names first ----------
    await at(G, SAME);
    await openNew(G);
    await settled(G);
    cs = await chips(G);
    check('A8 the area and the nearest name differ only in case: one chip', JSON.stringify(cs) === JSON.stringify([{ name: 'Same Name Mall', src: 'area' }]), JSON.stringify(cs));
    await close(G);
    await G.evaluate((p) => {
      const mk = (n, name) => ({ id: crypto.randomUUID(), body: 'own ' + n, kind: 'note', captured_at: new Date(Date.now() - n * 60000).toISOString(), tz: 'Asia/Singapore',
        local_date: todayLocal(), lat: p.lat + n * 0.00005, lng: p.lng, accuracy_m: 5, place_name: name, updated_at: new Date().toISOString(), deleted_at: null, shared: false, dirty: 0, server_ts: 'x' });
      return Promise.all([idb.put('captures', mk(1, 'Owns Mall')), idb.put('captures', mk(2, 'Kopi Corner')), idb.put('captures', mk(3, 'Bus Stop B'))]);
    }, OWNS);
    await at(G, OWNS);
    await openNew(G);
    await settled(G);
    cs = await chips(G);
    check('A9 three own names in range: three own chips, no lookup, no map chip (the area equals an own name anyway)',
      cs.length === 3 && cs.every((c) => c.src === 'own') && !(await shown(G, '#cap-osm')), JSON.stringify(cs));
    await close(G);
    await G.evaluate(() => idb.all('captures').then((a) => { const r = a.find((x) => x.place_name === 'Bus Stop B'); return idb.put('captures', Object.assign({}, r, { deleted_at: new Date().toISOString() })); }));
    await openNew(G);
    await settled(G);
    cs = await chips(G);
    check('A9 two own names, one of them the area\'s: own, own, then the nearest name (three at most, no repeat)',
      JSON.stringify(cs.map((c) => c.src)) === JSON.stringify(['own', 'own', 'osm']) && cs[2].name === 'Owns Kiosk' && !cs.some((c) => c.src === 'area'), JSON.stringify(cs));
    await close(G);

    // ---------- one Overpass request at a time ----------
    mock.overpass.delayMs = 300;
    o0 = mock.overpass.calls.length;
    await G.evaluate(() => Promise.all([areaName(1.2001, 103.8001), areaName(1.2101, 103.8101)]));
    mock.overpass.delayMs = 0;
    const two = mock.overpass.calls.slice(o0);
    check('A10 two lookups queued together go one after the other', two.length === 2 && two[1].at - two[0].at >= 280, JSON.stringify(two.map((c) => c.at - two[0].at)));

    // ---------- offline: no request, own names only ----------
    await offline(true);
    await at(G, { lat: 1.2201, lng: 103.8201 });
    o0 = mock.overpass.calls.length; n0 = mock.osm.calls.length;
    await openNew(G);
    await settled(G);
    check('A11 offline: no Overpass and no Nominatim request, no map chip', mock.overpass.calls.length === o0 && mock.osm.calls.length === n0 && !(await shown(G, '#cap-osm')));
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
    o0 = mock.overpass.calls.length;
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
    cs = await names(G);
    check('B3 the chips reload for the new position (its area and nearest name; Tampines gone)', JSON.stringify(cs) === JSON.stringify(['Locate Centre', 'Locate Kopitiam'])
      && mock.overpass.calls.length === o0 + 1 && mock.overpass.calls[o0].lat === 1.345, JSON.stringify(cs));
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
    o0 = mock.overpass.calls.length; n0 = mock.osm.calls.length;
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
      && mock.overpass.calls.length === o0 && mock.osm.calls.length === n0, JSON.stringify(cs));
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
