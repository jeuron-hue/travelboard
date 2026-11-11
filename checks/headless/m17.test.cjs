// travelboard 0.17.0 headless tests (TESTS.md, 0.17.0). Run from the repo root:
//   node checks/headless/m17.test.cjs
// Drives trip.html in Chromium against harness.cjs, with Gary's and Eric's phones on one mock.
// Gary's decisions 09/11/26, mid-trip (SPEC.md 7A.2, 7B.3):
// - V: a row's photo opens the large photo view, own and shared alike; a tap elsewhere on an
//   own row still opens edit, on a shared row still the view. On the capture and edit sheet the
//   photo opens the same view, saved or not yet saved, and closing it leaves the sheet as it was.
// - O: a photo from the Camera input is saved untouched as a download named
//   travelboard_YYYYMMDD_HHMMSS.jpg before the shrink; a Gallery photo is not; when the
//   download cannot start, the photo still attaches and saves and one line says the original
//   was not saved; the line is gone at the next sheet.
// 0.18.0 (Gary 10/11/26, SPEC.md 7.2, 7A.2):
// - D: a new capture has Discard (an edit keeps Delete); Discard asks in the app's sheet;
//   Cancel keeps everything; Discard drops the draft, text and photo, adds no capture.
// - F: Settings, Photos, Camera originals: Choose folder (showDirectoryPicker stubbed with a real
//   OPFS folder handle, so storing it and its permission checks are real). With a folder, a
//   Camera original is written there, no download; the folder survives a reload; when access
//   is not granted, or the write fails, the original goes to Download and one line says why;
//   Allow asks again and the row recovers.
// Exit code 0 only when every check passes.
'use strict';
const fs = require('fs');
const { launch, startServer, makeMock, attachMock, newContext, newPersistentContext, UID, ERIC_UID } = require('./harness.cjs');

const PORT = 8739;
const BASE = `http://127.0.0.1:${PORT}/`;
const APP = fs.readFileSync(require('path').join(__dirname, '..', '..', 'trip.html'), 'utf8').match(/const APP_VERSION = '([0-9.]+)';/)[1];
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail && !ok ? '  [' + detail + ']' : '')); };

const waitCap = (page, open) => page.waitForFunction((o) => document.getElementById('cap').hidden === !o && (!o || !popWait), open, { timeout: 5000 });
const shown = (page, sel) => page.$eval(sel, (e) => !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length));
const text = (page, sel) => page.$eval(sel, (e) => e.textContent);
const viewOpen = (page) => page.$eval('#view-dlg', (d) => d.open);
async function syncIdle(page) {
  await page.evaluate(async () => {
    for (let i = 0; i < 3; i++) {
      await sync();
      while (syncing) await new Promise((r) => setTimeout(r, 20));
    }
  });
}
// A photo-like JPEG drawn in the page, as a file buffer (as m11).
async function makeImage(page, w, h) {
  const b64 = await page.evaluate(async ({ w, h }) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, w, h);
    gr.addColorStop(0, '#2a6f97'); gr.addColorStop(1, '#f4a261');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 40; i++) { g.fillStyle = `hsl(${(i * 37) % 360} 60% 50% / 0.5)`; g.beginPath(); g.arc((i * 997) % w, (i * 613) % h, (w + h) / 40, 0, 7); g.fill(); }
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.95));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }, { w, h });
  return Buffer.from(b64, 'base64');
}
// Tap Photo, then Camera or Gallery, and answer the file chooser (the path a tap takes on the phone).
async function attach(page, buf, name, via) {
  const before = await page.evaluate(() => cap.photo && cap.photo.blob);
  await page.click('#cap-photo-btn');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser', { timeout: 5000 }), page.click('#photo-' + via)]);
  await chooser.setFiles({ name, mimeType: 'image/jpeg', buffer: buf });
  await page.waitForFunction((b) => cap.photo && cap.photo.state === 'new' && cap.photo.blob !== b, before, { timeout: 15000 }).catch(() => {});
}
async function closeView(page) {
  await page.click('#view-close');
  await page.waitForFunction(() => !document.getElementById('view-dlg').open);
}
const rowSel = (id) => `#records .row[data-id="${id}"]`;
// The files in the OPFS folder 'travelboard' (the stubbed chosen folder): name -> base64.
const folderFiles = (page) => page.evaluate(async () => {
  const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('travelboard', { create: true });
  const out = {};
  for await (const [name, h] of dir.entries()) {
    const b = new Uint8Array(await (await h.getFile()).arrayBuffer());
    let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
    out[name] = btoa(s);
  }
  return out;
});
const STUB_PICKER = () => { window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('travelboard', { create: true }); };
async function openSettings(page) {
  await page.click('#status');
  await page.waitForFunction(() => document.getElementById('settings').open);
  await page.waitForFunction(() => document.getElementById('orig-pick').dataset.action);
}
async function closeSettings(page) {
  await page.click('#close');
  await page.waitForFunction(() => !document.getElementById('settings').open);
}

(async () => {
  const srv = await startServer(PORT);
  const browser = await launch();
  const mock = makeMock();
  const phones = {};
  for (const [who, uid] of [['gary', UID], ['eric', ERIC_UID]]) {
    const ctx = await newContext(browser, { tz: 'Asia/Bangkok', session: true, uid });
    await attachMock(ctx, mock, { offline: false, name: who });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.log('PAGEERROR', who, e.message));
    page.on('dialog', (d) => { check(`no browser dialog (${who}): ` + d.message(), false); d.dismiss(); });
    await page.goto(BASE + 'trip.html');
    await page.waitForFunction(() => document.getElementById('day-label').textContent !== '-');
    phones[who] = { ctx, page };
  }
  const G = phones.gary.page;
  const downloads = [];
  G.on('download', (d) => downloads.push(d));

  try {
    check(`V0 v${APP}`, (await G.evaluate(() => APP_VERSION)) === APP, APP);
    // ---------- seed: Gary's own photo row and plain row, Eric's shared photo row, today ----------
    const today = await G.evaluate(() => todayLocal());
    const jpg = await makeImage(G, 800, 600);
    const at = (hm) => new Date(`${today}T${hm}:00+07:00`).toISOString();
    const id = (n) => `0000000${n}-2222-4222-8222-00000000000${n}`;
    const row = (n, owner, hm, extra) => Object.assign({ id: id(n), body: `Row ${n} text`, kind: 'note', captured_at: at(hm), updated_at: at(hm),
      tz: 'Asia/Bangkok', local_date: today, lat: 13.7524, lng: 100.5045, accuracy_m: 10, deleted_at: null, photo_path: null, shared: false }, extra);
    const OWN = id(1), PLAIN = id(2), THEIRS = id(3);
    mock.objects.set(`${UID}/${OWN}.jpg`, { bytes: jpg, contentType: 'image/jpeg' });
    mock.objects.set(`${ERIC_UID}/${THEIRS}.jpg`, { bytes: jpg, contentType: 'image/jpeg' });
    mock.upsertBatch([row(1, UID, '09:00', { photo_path: `${UID}/${OWN}.jpg`, photo_w: 800, photo_h: 600, photo_bytes: jpg.length }),
      row(2, UID, '10:00', {})], UID);
    mock.upsertBatch([row(3, ERIC_UID, '11:00', { shared: true, photo_path: `${ERIC_UID}/${THEIRS}.jpg`, photo_w: 800, photo_h: 600, photo_bytes: jpg.length })], ERIC_UID);
    mock.partnerAdd(ERIC_UID, UID); mock.partnerAdd(UID, ERIC_UID);
    await syncIdle(G);
    await G.evaluate(() => { followToday = true; return render(); });
    await G.waitForSelector(rowSel(OWN) + ' .print img.thumb');
    await G.waitForSelector(rowSel(THEIRS) + ' .print img.thumb');

    // ---------- V: the large photo view ----------
    await G.click(rowSel(OWN) + ' .print');
    await G.waitForFunction(() => document.getElementById('view-dlg').open);
    const v1 = await G.evaluate(() => ({ head: document.getElementById('view-head').textContent, img: !document.getElementById('view-img').hidden,
      src: document.getElementById('view-img').src, w: document.getElementById('view-img').naturalWidth,
      body: document.getElementById('view-body').textContent, nophoto: !document.getElementById('view-nophoto').hidden, cap: !document.getElementById('cap').hidden,
      edits: !!document.querySelector('#view-dlg input, #view-dlg #cap-delete') }));
    await G.waitForFunction(() => document.getElementById('view-img').complete && document.getElementById('view-img').naturalWidth > 0);
    check('V1 own row: tapping its photo opens the view with the photo large, the text, Gary\'s name and the day; no edit screen, no controls',
      v1.img && /^blob:/.test(v1.src) && /^Gary, /.test(v1.head) && v1.body === 'Row 1 text' && !v1.nophoto && !v1.cap && !v1.edits
      && await G.$eval('#view-img', (i) => i.naturalWidth === 800), JSON.stringify(v1));
    await closeView(G);
    await G.click(rowSel(OWN) + ' .line2');
    await waitCap(G, true);
    check('V2 own row: tapping elsewhere still opens edit, not the view', !(await viewOpen(G)) && (await text(G, '#cap-title')) === 'Edit capture'
      && (await G.evaluate(() => cap.row && cap.row.id)) === OWN);

    // ---------- V: the sheet's photo ----------
    const sheet0 = await G.evaluate(() => ({ body: document.getElementById('cap-body').value, place: document.getElementById('cap-place').value, state: cap.photo.state }));
    check('V3 edit sheet: the photo print is marked tappable', await G.$eval('#cap-photo-view', (e) => e.hasAttribute('data-view') && getComputedStyle(e).cursor === 'pointer'
      && e.getAttribute('role') === 'button'));
    await G.click('#cap-photo-view');
    await G.waitForFunction(() => document.getElementById('view-dlg').open);
    const v3 = await G.evaluate(() => ({ head: document.getElementById('view-head').textContent, src: document.getElementById('view-img').src, img: !document.getElementById('view-img').hidden,
      meta: document.getElementById('view-meta').textContent, cap: !document.getElementById('cap').hidden }));
    check('V3 edit sheet: tapping the photo opens the same view over the sheet, with its size line', v3.img && /^blob:/.test(v3.src) && v3.head === 'Photo'
      && /^800 x 600, \d+ KB$/.test(v3.meta) && v3.cap, JSON.stringify(v3));
    await closeView(G);
    const sheet1 = await G.evaluate(() => ({ body: document.getElementById('cap-body').value, place: document.getElementById('cap-place').value, state: cap.photo.state, open: cap.open }));
    check('V4 closing the view leaves the sheet open and unchanged', sheet1.open && JSON.stringify(Object.assign({}, sheet1, { open: undefined })) === JSON.stringify(sheet0), JSON.stringify(sheet1));
    await G.click('#cap-close');
    await waitCap(G, false);

    // ---------- V: a shared row ----------
    await G.click(rowSel(THEIRS) + ' .print');
    await G.waitForFunction(() => document.getElementById('view-dlg').open);
    check('V5 shared row: tapping its photo opens the view, Eric\'s name, the photo shown', /^Eric, /.test(await text(G, '#view-head')) && !(await G.$eval('#view-img', (i) => i.hidden))
      && (await text(G, '#view-body')) === 'Row 3 text');
    await closeView(G);
    await G.click(rowSel(THEIRS) + ' .line2');
    await G.waitForFunction(() => document.getElementById('view-dlg').open);
    check('V5 shared row: tapping elsewhere still opens the read-only view (unchanged)', /^Eric, /.test(await text(G, '#view-head')) && !(await G.$eval('#cap', (e) => !e.hidden)));
    await closeView(G);
    await G.click(rowSel(PLAIN));
    await waitCap(G, true);
    check('V6 own row without a photo: a tap opens edit; the sheet has no photo to view', !(await viewOpen(G)) && (await G.evaluate(() => cap.row.id)) === PLAIN
      && (await G.$eval('#cap-photo', (e) => e.hidden)));
    await G.click('#cap-close');
    await waitCap(G, false);

    // ---------- O: the Camera original ----------
    const big = await makeImage(G, 3000, 2250);
    await G.click('#capture');
    await waitCap(G, true);
    const t0 = Date.now();
    const dl = G.waitForEvent('download', { timeout: 10000 }).catch(() => null);
    await attach(G, big, 'image.jpg', 'camera');
    const d1 = await dl;
    const name1 = d1 && d1.suggestedFilename();
    const bytes1 = d1 && fs.readFileSync(await d1.path());
    const now = await G.evaluate(() => { const d = new Date(); return [d.getFullYear(), d.getMonth() + 1, d.getDate()].map((n) => String(n).padStart(2, '0')).join(''); });
    check('O1 Camera: the original is saved as a download named travelboard_YYYYMMDD_HHMMSS.jpg in phone time', !!name1 && /^travelboard_\d{8}_\d{6}\.jpg$/.test(name1)
      && name1.slice(12, 20) === now, name1);
    check('O1 the download is the untouched original, byte for byte (3000 x 2250), not the 1280 px copy', !!bytes1 && bytes1.equals(big)
      && (await G.evaluate(() => cap.photo.w)) === 1280, bytes1 && bytes1.length);
    check('O1 the photo still attaches as before, no "not saved" line', (await G.evaluate(() => cap.photo.state)) === 'new' && (await text(G, '#cap-photo-orig')) === ''
      && !(await shown(G, '#cap-photo-orig')));
    await G.click('#cap-photo-view');
    await G.waitForFunction(() => document.getElementById('view-dlg').open);
    check('V7 new capture: the photo not saved yet opens in the view too', /not saved yet/.test(await text(G, '#view-meta')) && !(await G.$eval('#view-img', (i) => i.hidden)));
    await closeView(G);
    await G.fill('#cap-body', 'Camera shot');
    await G.click('#cap-save');
    await waitCap(G, false);
    check('O1 the capture saves with its photo', await G.evaluate(async () => {
      const c = (await idb.all('captures')).find((r) => r.body === 'Camera shot');
      return !!c && !!(await idb.get('photos', c.id));
    }));

    const before = downloads.length;
    await G.click('#capture');
    await waitCap(G, true);
    await attach(G, big, 'gallery.jpg', 'gallery');
    await G.waitForTimeout(800);
    check('O2 Gallery: no download (the photo already lives in the phone\'s gallery)', downloads.length === before, String(downloads.length - before));
    await G.click('#cap-close');
    await waitCap(G, false);

    // A download that cannot start: object URLs for the original File throw. The shrunk blob
    // (a Blob, not a File) still gets its preview URL.
    await G.evaluate(() => {
      const real = URL.createObjectURL.bind(URL);
      window.__realObjectURL = real;
      URL.createObjectURL = (b) => { if (b instanceof File) throw new Error('blocked for the test'); return real(b); };
    });
    const before3 = downloads.length;
    await G.click('#capture');
    await waitCap(G, true);
    await attach(G, big, 'image.jpg', 'camera');
    await G.waitForTimeout(500);
    check('O3 download fails: one line says the original was not saved; the photo still attaches', downloads.length === before3
      && (await text(G, '#cap-photo-orig')) === 'Original not saved to the phone.' && await shown(G, '#cap-photo-orig')
      && (await G.evaluate(() => cap.photo.state === 'new' && cap.photo.w === 1280)));
    await G.fill('#cap-body', 'Camera shot, no original');
    await G.click('#cap-save');
    await waitCap(G, false);
    check('O3 the capture still saves with its photo', await G.evaluate(async () => {
      const c = (await idb.all('captures')).find((r) => r.body === 'Camera shot, no original');
      return !!c && !!(await idb.get('photos', c.id));
    }));
    await G.evaluate(() => { URL.createObjectURL = window.__realObjectURL; });
    await G.click('#capture');
    await waitCap(G, true);
    check('O4 the line is gone at the next sheet', (await text(G, '#cap-photo-orig')) === '');
    await G.click('#cap-close');
    await waitCap(G, false);
    check('O5 the original never waits on anything: keepOriginal is synchronous and returns before the shrink', await G.evaluate(() =>
      keepOriginal.constructor.name === 'Function' && attachPhoto.constructor.name === 'AsyncFunction'), String(Date.now() - t0));

    // ---------- D: Discard a new capture (0.18.0) ----------
    const nCaps = async () => G.evaluate(async () => (await idb.all('captures')).length);
    const n0 = await nCaps();
    await G.click('#capture');
    await waitCap(G, true);
    await attach(G, jpg, 'gallery.jpg', 'gallery');
    await G.fill('#cap-body', 'Not this one');
    check('D1 a new capture shows Discard at the foot, no Delete', await shown(G, '#cap-discard') && !(await shown(G, '#cap-delete'))
      && (await text(G, '#cap-discard')) === 'Discard');
    await G.click('#cap-discard');
    await G.waitForFunction(() => document.getElementById('confirm-dlg').open);
    check('D2 Discard asks first, in the app\'s sheet', (await text(G, '#confirm-head')) === 'Discard this capture?' && (await text(G, '#confirm-ok')) === 'Discard');
    await G.click('#confirm-cancel');
    await G.waitForFunction(() => !document.getElementById('confirm-dlg').open);
    check('D2 Cancel keeps the sheet, the text and the photo', (await G.evaluate(() => cap.open && cap.photo.state === 'new'))
      && (await G.$eval('#cap-body', (t) => t.value)) === 'Not this one');
    await G.click('#cap-discard');
    await G.waitForFunction(() => document.getElementById('confirm-dlg').open);
    await G.click('#confirm-ok');
    await waitCap(G, false);
    await G.waitForFunction(() => !popWait);
    check('D3 Discard closes the sheet, keeps no draft, adds no capture; the Capture button has no "draft kept"',
      !(await G.evaluate(() => idb.get('drafts', 'new'))) && (await nCaps()) === n0 && !(await shown(G, '#draft-note')));
    await G.click('#capture');
    await waitCap(G, true);
    check('D3 the next capture opens empty, no photo', (await G.$eval('#cap-body', (t) => t.value)) === '' && (await G.$eval('#cap-photo', (e) => e.hidden)));
    await G.click('#cap-close');
    await waitCap(G, false);
    await G.click(rowSel(OWN) + ' .line2');
    await waitCap(G, true);
    check('D4 an edit keeps Delete, no Discard', await shown(G, '#cap-delete') && !(await shown(G, '#cap-discard')));
    await G.click('#cap-close');
    await waitCap(G, false);

    // ---------- F: a folder for Camera originals (0.18.0) ----------
    // On a normal profile (newPersistentContext): in Playwright's incognito contexts Chromium
    // stops when a stored folder handle is read back, which the installed app never meets.
    {
    const pctx = await newPersistentContext({ tz: 'Asia/Bangkok', session: true, uid: UID });
    await attachMock(pctx, mock, { offline: false, name: 'gary-normal-profile' });
    const G = pctx.pages()[0] || await pctx.newPage();
    G.on('pageerror', (e) => console.log('PAGEERROR gary-normal-profile', e.message));
    G.on('dialog', (d) => { check('no browser dialog (normal profile): ' + d.message(), false); d.dismiss(); });
    const downloads = [];
    G.on('download', (d) => downloads.push(d));
    await G.goto(BASE + 'trip.html');
    await G.waitForFunction(() => document.getElementById('day-label').textContent !== '-');
    try {
    await openSettings(G);
    check('F1 Settings, Photos: Camera originals, saved to Download, Choose folder', await shown(G, '#g-photos')
      && (await text(G, '#orig-detail')) === 'Saved to Download' && (await text(G, '#orig-pick')) === 'Choose folder');
    await G.evaluate(STUB_PICKER);
    await G.click('#orig-pick');
    await G.waitForFunction(() => document.getElementById('orig-pick').textContent === 'Change');
    check('F2 a folder chosen: the row names it, Change; the handle is kept', (await text(G, '#orig-detail')) === 'Saved to the folder travelboard'
      && await G.evaluate(async () => !!(await meta.get('orig_dir'))));
    await closeSettings(G);
    let dlBefore = downloads.length;
    await G.click('#capture');
    await waitCap(G, true);
    await attach(G, big, 'image.jpg', 'camera');
    await G.waitForTimeout(800);
    let files = await folderFiles(G);
    let names = Object.keys(files);
    check('F3 Camera with a folder: the untouched original is written there, no download, no line', names.length === 1 && /^travelboard_\d{8}_\d{6}\.jpg$/.test(names[0])
      && Buffer.from(files[names[0]], 'base64').equals(big) && downloads.length === dlBefore && (await text(G, '#cap-photo-orig')) === '', JSON.stringify(names));
    await G.click('#cap-discard');
    await G.waitForFunction(() => document.getElementById('confirm-dlg').open);
    await G.click('#confirm-ok');
    await waitCap(G, false);
    check('F3 discarding the capture leaves the original in the folder', Object.keys(await folderFiles(G)).length === 1);

    await G.reload();
    await G.waitForFunction(() => document.getElementById('day-label').textContent !== '-');
    await openSettings(G);
    check('F4 after a reload the folder is still chosen', (await text(G, '#orig-detail')) === 'Saved to the folder travelboard');
    await closeSettings(G);
    // Access not granted this session: what Chrome reports when it has not kept the permission.
    await G.evaluate(() => {
      window.__q = FileSystemHandle.prototype.queryPermission;
      window.__r = FileSystemHandle.prototype.requestPermission;
      FileSystemHandle.prototype.queryPermission = async () => 'prompt';
      FileSystemHandle.prototype.requestPermission = async () => { FileSystemHandle.prototype.queryPermission = window.__q; return 'granted'; };
    });
    dlBefore = downloads.length;
    await G.click('#capture');
    await waitCap(G, true);
    const dl5 = G.waitForEvent('download', { timeout: 10000 }).catch(() => null);
    await attach(G, big, 'image.jpg', 'camera');
    const d5 = await dl5;
    await G.waitForFunction(() => document.getElementById('cap-photo-orig').textContent !== '', null, { timeout: 5000 }).catch(() => {});
    check('F5 access not granted: the original goes to Download, never a prompt at capture, and one line says why',
      !!d5 && fs.readFileSync(await d5.path()).equals(big) && Object.keys(await folderFiles(G)).length === 1
      && (await text(G, '#cap-photo-orig')) === 'Original saved to Download instead: allow the folder again in Settings, Photos.', await text(G, '#cap-photo-orig'));
    check('F5 the capture still attaches its photo', await G.evaluate(() => cap.photo.state === 'new' && cap.photo.w === 1280));
    await G.click('#cap-close');
    await waitCap(G, false);
    await openSettings(G);
    check('F6 Settings says to allow the folder again, with Allow', (await text(G, '#orig-pick')) === 'Allow' && /allow it again; Download until then/.test(await text(G, '#orig-detail')));
    await G.click('#orig-pick');
    await G.waitForFunction(() => document.getElementById('orig-pick').textContent === 'Change');
    check('F6 Allow asks again and the row recovers', (await text(G, '#orig-detail')) === 'Saved to the folder travelboard');
    await closeSettings(G);
    // The write failing: Download instead, with the reason.
    await G.evaluate(() => { window.__g = FileSystemDirectoryHandle.prototype.getFileHandle; FileSystemDirectoryHandle.prototype.getFileHandle = async () => { throw new Error('disk full for the test'); }; });
    await G.click('#capture');
    await waitCap(G, true);
    const dl7 = G.waitForEvent('download', { timeout: 10000 }).catch(() => null);
    await attach(G, big, 'image.jpg', 'camera');
    const d7 = await dl7;
    await G.waitForFunction(() => document.getElementById('cap-photo-orig').textContent !== '', null, { timeout: 5000 }).catch(() => {});
    check('F7 the folder write failing: the original goes to Download and one line says so', !!d7
      && (await text(G, '#cap-photo-orig')) === 'Original saved to Download instead: the folder could not be written.', await text(G, '#cap-photo-orig'));
    await G.evaluate(() => { FileSystemDirectoryHandle.prototype.getFileHandle = window.__g; });
    await G.click('#cap-close');
    await waitCap(G, false);
    } finally { await pctx.close(); }
    }
  } catch (e) {
    check('suite ran to the end', false, (e && e.stack) || String(e));
  } finally {
    await browser.close();
    srv.close();
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
