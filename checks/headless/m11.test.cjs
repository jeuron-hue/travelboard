// travelboard M1.1 headless tests (TESTS.md, M1.1; SPEC.md 7A.6 item 10). Run from the repo root:
//   node checks/headless/m11.test.cjs        (TB_CHROMIUM=/path/to/chrome to use an installed Chromium)
// Drives trip.html in Chromium against the RPC and Storage mocks in harness.cjs: Photo on the
// capture screen, shrink to 1280 px JPEG, offline save and thumbnail, upload to
// tb-photos/<uid>/<id>.jpg before the push, photo-only capture, draft with a photo after a
// reload, failed upload that does not hold back text and GPS, edit replace and remove,
// download on a second phone, pill counts, export fields, journal composer without Photo.
// Exit code 0 only when every check passes.
'use strict';
const { launch, startServer, makeMock, attachMock, newContext, UID } = require('./harness.cjs');

const PORT = 8733;
const BASE = `http://127.0.0.1:${PORT}/`;
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail && !ok ? '  [' + detail + ']' : '')); };

const waitCap = (page, open) => page.waitForFunction((o) => document.getElementById('cap').hidden === !o && (!o || !popWait), open, { timeout: 5000 });
const shown = (page, sel) => page.$eval(sel, (e) => !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length));
const pill = (page) => page.$eval('#status-text', (e) => e.textContent);
const settle = (page) => page.waitForFunction(() => !syncing, null, { timeout: 15000 });
async function syncIdle(page) {
  await page.evaluate(async () => {
    for (let i = 0; i < 3; i++) {
      await sync();
      while (syncing) await new Promise((r) => setTimeout(r, 20));
    }
  });
}
const caps = (page) => page.evaluate(() => idb.all('captures'));
const photos = (page) => page.evaluate(async () => (await idb.all('photos')).map((p) => ({ id: p.id, w: p.w, h: p.h, bytes: p.bytes, size: p.blob.size, type: p.blob.type, uploaded: p.uploaded })));

// JPEG width and height from the SOF marker.
function jpegSize(buf) {
  if (!buf || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) return null;
    const mk = buf[i + 1], len = buf.readUInt16BE(i + 2);
    if (mk >= 0xc0 && mk <= 0xcf && mk !== 0xc4 && mk !== 0xc8 && mk !== 0xcc) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return null;
}

// A photo-like test image drawn in the page (gradient, shapes, light noise), as a file buffer.
async function makeImage(page, w, h, type) {
  const b64 = await page.evaluate(async ({ w, h, type }) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, w, h);
    gr.addColorStop(0, '#2a6f97'); gr.addColorStop(0.5, '#f4a261'); gr.addColorStop(1, '#264653');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 60; i++) {
      g.fillStyle = `hsl(${(i * 37) % 360} 60% 50% / 0.5)`;
      g.beginPath(); g.arc((i * 997) % w, (i * 613) % h, (w + h) / 40, 0, 7); g.fill();
    }
    const d = g.getImageData(0, 0, w, h);
    for (let i = 0; i < d.data.length; i += 4) { const n = (Math.random() - 0.5) * 12; d.data[i] += n; d.data[i + 1] += n; d.data[i + 2] += n; }
    g.putImageData(d, 0, 0);
    const blob = await new Promise((r) => c.toBlob(r, type, 0.95));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }, { w, h, type });
  return Buffer.from(b64, 'base64');
}
async function attach(page, buf, name, mimeType) {
  const before = await page.evaluate(() => cap.photo && cap.photo.blob);
  await page.setInputFiles('#cap-file', { name, mimeType, buffer: buf });
  await page.waitForFunction((b) => cap.photo && cap.photo.state === 'new' && cap.photo.blob !== b, before, { timeout: 15000 }).catch(() => {});
  await page.waitForFunction(() => !document.getElementById('cap-photo').hidden, null, { timeout: 5000 }).catch(() => {});
}
async function openCapture(page) {
  await page.click('#capture');
  await waitCap(page, true);
}
async function save(page) {
  await page.click('#cap-save');
  await waitCap(page, false);
  await page.waitForFunction(() => !popWait);
}

(async () => {
  const srv = await startServer(PORT);
  const browser = await launch();

  // ================= A: one phone, Asia/Bangkok, signed in =================
  const ctx = await newContext(browser, { tz: 'Asia/Bangkok', session: true });
  const mock = makeMock();
  await attachMock(ctx, mock);
  const page = await ctx.newPage();
  page.on('dialog', (d) => { results.push({ name: 'unexpected dialog: ' + d.message(), ok: false }); console.log('FAIL dialog ' + d.message()); d.dismiss(); });
  await page.goto(BASE + 'trip.html');
  await page.waitForFunction(() => document.getElementById('day-label').textContent !== '-');
  await settle(page);
  const version = await page.$eval('#s-version', (e) => e.textContent);
  check('P0 v7, IndexedDB v3 with a photos store indexed on uploaded', version === 'v7' && await page.evaluate(async () => {
    const db = await idb.open();
    return db.version === 3 && db.objectStoreNames.contains('photos') && db.transaction('photos').objectStore('photos').indexNames.contains('uploaded');
  }), version);

  const big = await makeImage(page, 4000, 3000, 'image/jpeg');
  const tall = await makeImage(page, 1500, 2000, 'image/png');
  const small = await makeImage(page, 800, 600, 'image/jpeg');

  // --- capture screen
  await openCapture(page);
  check('P1 capture screen: Photo button shown, no preview, Save disabled', (await shown(page, '#cap-photo-btn')) && !(await shown(page, '#cap-photo'))
    && await page.$eval('#cap-save', (e) => e.disabled));
  check('P1 Photo opens the Android chooser: a file input taking images, camera or gallery', await page.$eval('#cap-file', (e) =>
    e.type === 'file' && e.accept === 'image/*' && !e.hasAttribute('capture') && !e.multiple));

  // --- acceptance 1: airplane mode, camera photo
  mock.offline = true;
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await page.fill('#cap-body', 'Jay Fai, the crab omelette');
  await attach(page, big, 'PXL_20261109_183000.jpg', 'image/jpeg');
  const pv = await page.evaluate(() => ({ state: cap.photo.state, w: cap.photo.w, h: cap.photo.h, bytes: cap.photo.bytes, type: cap.photo.blob.type,
    src: document.getElementById('cap-photo-img').src, btn: document.getElementById('cap-photo-btn').textContent,
    info: document.getElementById('cap-photo-info').textContent }));
  check('P2 4000 x 3000 photo shrunk on the phone to 1280 x 960 JPEG, preview shown, button reads Replace', pv.state === 'new' && pv.w === 1280 && pv.h === 960
    && pv.type === 'image/jpeg' && /^blob:/.test(pv.src) && pv.btn === 'Replace' && /1280 x 960/.test(pv.info), JSON.stringify(pv));
  check('P2 shrunk photo under 500 KB', pv.bytes < 500 * 1024, pv.bytes);
  const dr = await page.evaluate(() => idb.get('drafts', 'new'));
  check('P2 the draft keeps the photo with the text', dr && dr.open && dr.body === 'Jay Fai, the crab omelette' && dr.photo && dr.photo.blob && dr.photo.w === 1280);
  await save(page);
  let all = await caps(page);
  let ph = await photos(page);
  const c1 = all.find((r) => r.body === 'Jay Fai, the crab omelette');
  check('P3 offline: the capture saved at once with a queued photo, no photo_path yet', c1 && c1.dirty === 1 && c1.photo_path === null
    && ph.length === 1 && ph[0].id === c1.id && ph[0].uploaded === 0 && ph[0].w === 1280 && ph[0].type === 'image/jpeg');
  check('P3 the row shows a thumbnail from the local blob and a queued chip', await page.$eval(`.row[data-id="${c1.id}"]`, (e) =>
    !!e.querySelector('img.thumb') && /^blob:/.test(e.querySelector('img.thumb').src) && e.querySelector('.chip.queued') !== null));
  check('P3 nothing reached the server; pill counts the capture and its photo', mock.rows.size === 0 && mock.objects.size === 0
    && (await pill(page)) === 'offline, 2 queued', await pill(page));
  check('P3 draft cleared after Save', !(await page.evaluate(() => idb.get('drafts', 'new'))));

  // reconnect
  mock.offline = false;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await settle(page);
  await syncIdle(page);
  const path1 = `${UID}/${c1.id}.jpg`;
  const obj1 = mock.objects.get(path1);
  const sz1 = obj1 && jpegSize(obj1.bytes);
  const srv1 = mock.rows.get(c1.id);
  check('P4 on reconnect the file lands at tb-photos/<uid>/<id>.jpg as JPEG', !!obj1 && obj1.contentType === 'image/jpeg', [...mock.objects.keys()].join());
  check('P4 stored file at most 1280 px on the long edge and under 500 KB', sz1 && Math.max(sz1.w, sz1.h) <= 1280 && sz1.w === 1280 && obj1.bytes.length < 500 * 1024,
    JSON.stringify(sz1));
  check('P4 server row has photo_path and the size fields', srv1 && srv1.photo_path === path1 && srv1.photo_w === 1280 && srv1.photo_h === 960
    && srv1.photo_bytes === obj1.bytes.length && srv1.body === 'Jay Fai, the crab omelette', JSON.stringify(srv1));
  const upl = mock.storageCalls.filter((c) => c.method === 'POST');
  const firstPush = mock.calls.indexOf('/rest/v1/rpc/tb_captures_upsert');
  const pushes1 = mock.pushLog.filter((x) => x.id === c1.id);
  check('P4 uploaded before the push: the first push of the row already carries photo_path', upl.length === 1 && firstPush >= 0
    && pushes1.length >= 1 && pushes1[0].photo_path === path1 && pushes1[0].at >= 1, JSON.stringify(pushes1));
  ph = await photos(page);
  all = await caps(page);
  check('P4 locally: photo uploaded, capture synced, pill synced', ph[0].uploaded === 1 && all.find((r) => r.id === c1.id).dirty === 0
    && (await pill(page)) === 'synced', await pill(page));

  // --- acceptance 2: gallery photo (PNG, portrait)
  await openCapture(page);
  await page.fill('#cap-body', 'Wat Pho from the gallery');
  await attach(page, tall, 'IMG_0420.png', 'image/png');
  const pv2 = await page.evaluate(() => ({ w: cap.photo.w, h: cap.photo.h, type: cap.photo.blob.type }));
  check('P5 gallery PNG 1500 x 2000 becomes a 960 x 1280 JPEG', pv2.w === 960 && pv2.h === 1280 && pv2.type === 'image/jpeg', JSON.stringify(pv2));
  await save(page);
  await settle(page);
  await syncIdle(page);
  const c2 = (await caps(page)).find((r) => r.body === 'Wat Pho from the gallery');
  const sz2 = mock.objects.get(`${UID}/${c2.id}.jpg`) && jpegSize(mock.objects.get(`${UID}/${c2.id}.jpg`).bytes);
  check('P5 gallery photo synced the same way', sz2 && sz2.w === 960 && sz2.h === 1280 && mock.rows.get(c2.id).photo_h === 1280);

  // a small photo is kept at its size
  await openCapture(page);
  await attach(page, small, 'small.jpg', 'image/jpeg');
  const pv3 = await page.evaluate(() => ({ w: cap.photo.w, h: cap.photo.h }));
  check('P6 an 800 x 600 photo is kept at 800 x 600', pv3.w === 800 && pv3.h === 600, JSON.stringify(pv3));

  // --- acceptance 3: photo-only capture (no text)
  check('P7 photo and no text: Save enabled', !(await page.$eval('#cap-save', (e) => e.disabled)));
  await save(page);
  await settle(page);
  await syncIdle(page);
  const c3 = (await caps(page)).find((r) => r.body === '' && r.photo_w === 800);
  check('P7 photo-only capture saved and synced, row line reads (photo)', c3 && mock.rows.get(c3.id) && mock.rows.get(c3.id).body === ''
    && mock.rows.get(c3.id).photo_path === `${UID}/${c3.id}.jpg`
    && await page.$eval(`.row[data-id="${c3.id}"] .line2`, (e) => e.textContent) === '(photo)');

  // Remove before Save: text-only again, Save needs text
  await openCapture(page);
  await attach(page, small, 'small.jpg', 'image/jpeg');
  await page.click('#cap-photo-remove');
  check('P8 Remove on a new capture: preview gone, Save disabled with no text, draft has no photo',
    !(await shown(page, '#cap-photo')) && await page.$eval('#cap-save', (e) => e.disabled)
    && !('photo' in (await page.evaluate(() => idb.get('drafts', 'new')))));

  // --- acceptance 4: force-close after attaching, before Save
  await attach(page, small, 'small.jpg', 'image/jpeg');
  await page.fill('#cap-body', 'Kept through a force-close');
  await page.evaluate(() => writeDraft());
  await page.reload();
  await page.waitForFunction(() => document.getElementById('day-label').textContent !== '-');
  await waitCap(page, true);
  const re = await page.evaluate(() => ({ body: document.getElementById('cap-body').value, state: cap.photo && cap.photo.state, w: cap.photo && cap.photo.w,
    img: !document.getElementById('cap-photo').hidden && /^blob:/.test(document.getElementById('cap-photo-img').src) }));
  check('P9 reopened after a reload with the text and the photo', re.body === 'Kept through a force-close' && re.state === 'new' && re.w === 800 && re.img, JSON.stringify(re));
  await page.click('#cap-close');
  await waitCap(page, false);
  check('P9 Close keeps the photo draft: Capture reads "draft kept"', await shown(page, '#draft-note')
    && !!(await page.evaluate(() => idb.get('drafts', 'new'))).photo);
  await openCapture(page);
  check('P9 Capture restores the draft with its photo', await page.evaluate(() => cap.photo.state === 'new' && cap.photo.w === 800));
  await page.click('#cap-close');
  await waitCap(page, false);
  // a photo-only draft is kept too
  await openCapture(page);
  await page.fill('#cap-body', '');
  await page.evaluate(() => writeDraft());
  await page.click('#cap-close');
  await waitCap(page, false);
  check('P9 a photo-only draft is kept on Close', await shown(page, '#draft-note'));
  await openCapture(page);
  await page.fill('#cap-body', 'Draft photo saved');
  await save(page);
  await settle(page);

  // --- acceptance 5: upload fails; text and GPS still sync; photo follows later
  await page.evaluate(() => { window.__geo.mode = 'grant'; });
  mock.uploadFail = 'http';
  const posts0 = mock.storageCalls.filter((c) => c.method === 'POST').length;
  await openCapture(page);
  await page.fill('#cap-body', 'Upload will fail first');
  await attach(page, big, 'big.jpg', 'image/jpeg');
  await save(page);
  await page.waitForTimeout(300);
  await settle(page);
  await syncIdle(page);
  const c5 = (await caps(page)).find((r) => r.body === 'Upload will fail first');
  const s5 = mock.rows.get(c5.id);
  check('P10 upload refused: the capture text and GPS are on the server without photo_path', s5 && s5.body === 'Upload will fail first'
    && s5.lat != null && s5.photo_path === null && !mock.objects.has(`${UID}/${c5.id}.jpg`)
    && mock.storageCalls.filter((c) => c.method === 'POST').length > posts0, JSON.stringify(s5));
  const ph5 = (await photos(page)).find((p) => p.id === c5.id);
  check('P10 the photo stays queued; pill counts it and shows the error; row chip queued', ph5 && ph5.uploaded === 0
    && /queued 1|sync error/.test(await pill(page)) && await page.$eval(`.row[data-id="${c5.id}"] .chip.queued`, () => true).catch(() => false)
    && /photo upload/.test(await page.$eval('#s-error', (e) => e.textContent)), await pill(page));
  mock.uploadFail = null;
  await syncIdle(page);
  const s5b = mock.rows.get(c5.id);
  check('P10 next sync: the photo uploads and the row gets photo_path', !!mock.objects.get(`${UID}/${c5.id}.jpg`) && s5b.photo_path === `${UID}/${c5.id}.jpg`
    && (await pill(page)) === 'synced', `${s5b.photo_path} / ${await pill(page)}`);
  // network failure during upload: offline, nothing lost
  mock.uploadFail = 'network';
  await openCapture(page);
  await page.fill('#cap-body', 'Network drops during the upload');
  await attach(page, small, 'small.jpg', 'image/jpeg');
  await save(page);
  await settle(page);
  await syncIdle(page);
  const c6 = (await caps(page)).find((r) => r.body === 'Network drops during the upload');
  check('P11 network drop during upload: text pushed, photo queued, pill offline', mock.rows.has(c6.id) && mock.rows.get(c6.id).photo_path === null
    && /^offline/.test(await pill(page)), await pill(page));
  mock.uploadFail = null;
  await syncIdle(page);
  check('P11 back online: the photo follows', mock.rows.get(c6.id).photo_path === `${UID}/${c6.id}.jpg`);

  // smallest first
  mock.offline = true;
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  for (const [t, img] of [['order big', big], ['order small', small], ['order tall', tall]]) {
    await openCapture(page);
    await page.fill('#cap-body', t);
    await attach(page, img, 'x.jpg', 'image/jpeg');
    await save(page);
  }
  mock.offline = false;
  const n0 = mock.storageCalls.length;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await settle(page);
  await syncIdle(page);
  const order = mock.storageCalls.slice(n0).filter((c) => c.method === 'POST').map((c) => mock.objects.get(c.path).bytes.length);
  check('P12 queued photos upload one at a time, smallest first', order.length === 3 && order[0] <= order[1] && order[1] <= order[2], order.join());

  // --- edit: replace and remove
  await page.click(`.row[data-id="${c1.id}"]`);
  await waitCap(page, true);
  check('P13 edit opens with the full preview of the saved photo', await page.evaluate(() => cap.photo.state === 'keep' && cap.photo.w === 1280
    && !document.getElementById('cap-photo').hidden && /^blob:/.test(document.getElementById('cap-photo-img').src)));
  await attach(page, tall, 'replace.png', 'image/png');
  await save(page);
  await settle(page);
  await syncIdle(page);
  const r13 = mock.rows.get(c1.id), o13 = mock.objects.get(path1);
  check('P13 Replace uploads to the same path and updates the size fields', r13.photo_path === path1 && r13.photo_w === 960 && r13.photo_h === 1280
    && jpegSize(o13.bytes).w === 960 && r13.body === 'Jay Fai, the crab omelette');
  await page.click(`.row[data-id="${c1.id}"]`);
  await waitCap(page, true);
  await page.click('#cap-photo-remove');
  check('P14 Remove in an edit: Save stays enabled (text remains)', !(await page.$eval('#cap-save', (e) => e.disabled)));
  const objs = mock.objects.size;
  await save(page);
  await settle(page);
  await syncIdle(page);
  const r14 = mock.rows.get(c1.id);
  check('P14 Remove clears the four photo fields on the server; the file stays in Storage (no delete)', r14.photo_path === null && r14.photo_w === null
    && r14.photo_h === null && r14.photo_bytes === null && mock.objects.has(path1) && mock.objects.size === objs
    && !mock.storageCalls.some((c) => c.method === 'DELETE'));
  check('P14 the row has no thumbnail any more', await page.$eval(`.row[data-id="${c1.id}"]`, (e) => !e.querySelector('.thumb')));

  // --- export
  const [dl] = await Promise.all([page.waitForEvent('download'), page.evaluate(() => exportCaptures())]);
  const exp = JSON.parse(require('fs').readFileSync(await dl.path(), 'utf8'));
  const e2 = exp.captures.find((x) => x.id === c2.id);
  check('P15 export carries photo_path, photo_w, photo_h, photo_bytes; photos not embedded', e2 && e2.photo_path === `${UID}/${c2.id}.jpg`
    && e2.photo_w === 960 && e2.photo_h === 1280 && e2.photo_bytes > 0 && !JSON.stringify(exp).includes('data:image'));

  // --- journal composer has no Photo button
  await page.click('#tab-journal');
  await page.click('#capture');
  await waitCap(page, true);
  check('P16 journal composer: no Photo button, no preview', !(await shown(page, '#cap-photo-btn')) && !(await shown(page, '#cap-photo')));
  await page.click('#cap-close');
  await waitCap(page, false);
  await page.click('#tab-captures');

  // ================= B: second phone (reinstall): pulls rows, downloads photos =================
  const ctxB = await newContext(browser, { tz: 'Asia/Singapore', session: true });
  await attachMock(ctxB, mock);
  const pb = await ctxB.newPage();
  await pb.goto(BASE + 'trip.html');
  await pb.waitForFunction(() => document.getElementById('day-label').textContent !== '-');
  await settle(pb);
  await syncIdle(pb);
  const phB = await photos(pb);
  const withPath = [...mock.rows.values()].filter((r) => r.photo_path && !r.deleted_at);
  check('P17 reinstall: every photo on the server downloaded once, as the user, and kept as uploaded', phB.length === withPath.length
    && phB.every((p) => p.uploaded === 1 && p.size === mock.rows.get(p.id).photo_bytes), `${phB.length} of ${withPath.length}`);
  const gets = mock.storageCalls.filter((c) => c.method === 'GET').length;
  await syncIdle(pb);
  check('P17 a second sync downloads nothing again', mock.storageCalls.filter((c) => c.method === 'GET').length === gets);
  await pb.click('#day-label');
  const dayB = await pb.$eval('#day-label', (e) => e.textContent);
  const thumbsB = await pb.$$eval('.row img.thumb', (e) => e.length);
  check('P17 rows on the second phone show thumbnails', thumbsB >= 1, `${dayB}: ${thumbsB}`);

  await browser.close();
  srv.close();
  const failed = results.filter((x) => !x.ok).length;
  console.log(`\n${results.length - failed} of ${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
