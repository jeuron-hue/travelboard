// travelboard M1.2 headless tests (TESTS.md, M1.2; SPEC.md 7B.5 item 12). Run from the repo root:
//   node checks/headless/m12.test.cjs        (TB_CHROMIUM=/path/to/chrome to use an installed Chromium)
// Two phones against one mock server (harness.cjs, which mirrors migration 0008): Gary's and
// Eric's, each its own browser context with its own session, IndexedDB and network switch.
// Separate by default; Add on one side waits for the other; linked, the Share with switch
// shows, on by default; a shared capture and its photo appear read-only on the other phone and
// show offline; switched off or never shared it does not; captures from before linking stay
// unshared until switched on; no edit or delete of the other's capture; removing the link
// from either side clears both phones and adding again brings the still-shared back; journals
// private, Eric's prompt and Gary's shared capture in Eric's journal call; an airplane-mode
// capture on Eric's phone reaches Gary; export; the share switch in a draft; Change password.
// Exit code 0 only when every check passes.
'use strict';
const APP = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'trip.html'), 'utf8').match(/const APP_VERSION = (\d+);/)[1];
const { launch, startServer, makeMock, attachMock, newContext, UID, ERIC_UID } = require('./harness.cjs');

const PORT = 8734;
const BASE = `http://127.0.0.1:${PORT}/`;
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail && !ok ? '  [' + detail + ']' : '')); };

const waitCap = (page, open) => page.waitForFunction((o) => document.getElementById('cap').hidden === !o && (!o || !popWait), open, { timeout: 5000 });
const shown = (page, sel) => page.$eval(sel, (e) => !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length)).catch(() => false);
const pill = (page) => page.$eval('#status-text', (e) => e.textContent);
const text = (page, sel) => page.$eval(sel, (e) => e.textContent).catch(() => null);
async function syncIdle(page) {
  await page.evaluate(async () => {
    for (let i = 0; i < 3; i++) {
      await sync();
      while (syncing) await new Promise((r) => setTimeout(r, 20));
    }
    await render();
  });
}
const store = (page, name) => page.evaluate((n) => idb.all(n), name);
const rowsOnScreen = (page) => page.$$eval('#records .row', (els) => els.map((e) => ({
  id: e.dataset.id, partner: !!e.dataset.partner, text: e.textContent,
  who: (e.querySelector('.chip.who') || {}).textContent || null, sync: !!e.querySelector('.chip.queued, .chip.synced'),
  thumb: !!e.querySelector('img.thumb') })));
const panelText = (page) => page.$$eval('#partners .partner-state', (els) => els.map((e) => e.textContent).join(' | '));

async function makeImage(page, w, h) {
  const b64 = await page.evaluate(async ({ w, h }) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.fillStyle = '#2a6f97'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#f4a261'; g.fillRect(w / 4, h / 4, w / 2, h / 2);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }, { w, h });
  return Buffer.from(b64, 'base64');
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
async function newCapture(page, body, { share, photo } = {}) {
  await openCapture(page);
  await page.fill('#cap-body', body);
  if (photo) {
    await page.setInputFiles('#cap-file', { name: 'p.jpg', mimeType: 'image/jpeg', buffer: photo });
    await page.waitForFunction(() => cap.photo && cap.photo.state === 'new', null, { timeout: 15000 });
  }
  if (share !== undefined && (await page.isChecked('#cap-share-on')) !== share) await page.click('#cap-share-on');
  await save(page);
  return (await store(page, 'captures')).find((r) => r.body === body);
}
async function openSettings(page) {
  await page.click('#status');
  await page.waitForFunction(() => document.getElementById('settings').open);
  await page.waitForTimeout(50);
}
async function closeSettings(page) {
  await page.click('#close');
  await page.waitForFunction(() => !document.getElementById('settings').open);
}
async function partnerButton(page, label) {
  await openSettings(page);
  await page.click(`#partners button:has-text("${label}")`);
  await page.waitForFunction(() => !syncing, null, { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(150);
}

(async () => {
  const srv = await startServer(PORT);
  const browser = await launch();
  const mock = makeMock();
  const phones = {};
  for (const [who, uid] of [['gary', UID], ['eric', ERIC_UID]]) {
    const ctx = await newContext(browser, { tz: 'Asia/Bangkok', session: true, uid });
    const net = { offline: false };           // this phone's airplane mode, for the Supabase host
    await attachMock(ctx, mock, net);
    const page = await ctx.newPage();
    page.on('dialog', (d) => d.accept());      // Remove asks to confirm
    await page.goto(BASE + 'trip.html');
    await page.waitForFunction(() => document.getElementById('day-label').textContent !== '-');
    await syncIdle(page);
    phones[who] = { ctx, page, net };
  }
  const G = phones.gary.page, E = phones.eric.page;
  const img = await makeImage(G, 1600, 1200);
  try {
    // ---------- 1. Separate by default ----------
    check(`M0 both phones on v${APP} with IndexedDB v5 (partner, pphotos kept; geocache from M1.3)`, await G.evaluate(async (app) => {
      const db = await idb.open();
      return APP_VERSION === app && db.version === 5 && db.objectStoreNames.contains('partner') && db.objectStoreNames.contains('pphotos');
    }, Number(APP)) && (await text(E, '#s-version')) === 'v' + APP);
    await openCapture(G);
    check('M1 not linked: no Share with switch on the capture screen', !(await shown(G, '#cap-share')));
    await G.click('#cap-close'); await waitCap(G, false);
    const gPre = await newCapture(G, 'Gary before linking');
    const ePre = await newCapture(E, 'Eric before linking');
    await syncIdle(G); await syncIdle(E); await syncIdle(G);
    check('M1 captures made while not linked are saved with shared false', gPre.shared === false && ePre.shared === false
      && mock.rows.get(gPre.id).shared === false && mock.rows.get(ePre.id).owner === ERIC_UID);
    let gRows = await rowsOnScreen(G), eRows = await rowsOnScreen(E);
    check('M1 item 1: each phone shows only its own captures; partner stores empty', gRows.length === 1 && gRows[0].id === gPre.id
      && eRows.length === 1 && eRows[0].id === ePre.id && (await store(G, 'partner')).length === 0 && (await store(E, 'partner')).length === 0,
      JSON.stringify([gRows, eRows]));
    await openSettings(G);
    check('M1 Gary\'s panel: "Not linked with Eric." with Add Eric', (await panelText(G)) === 'Not linked with Eric.'
      && await shown(G, '#partners button:has-text("Add Eric")'), await panelText(G));
    await closeSettings(G);

    // ---------- 2. Linking ----------
    await partnerButton(G, 'Add Eric');
    check('M2 Gary adds Eric: "You added Eric. Waiting for Eric to add you"', (await panelText(G)) === 'You added Eric. Waiting for Eric to add you'
      && await shown(G, '#partners button:has-text("Remove")'), await panelText(G));
    await closeSettings(G);
    await syncIdle(E);
    await openSettings(E);
    check('M2 Eric\'s panel: "Gary added you. Add him to link"', (await panelText(E)) === 'Gary added you. Add him to link', await panelText(E));
    await closeSettings(E);
    check('M2 nothing shared yet; no Share with switch on either phone', (await store(E, 'partner')).length === 0
      && await (async () => { await openCapture(G); const s = await shown(G, '#cap-share'); await G.click('#cap-close'); await waitCap(G, false); return !s; })());
    await partnerButton(E, 'Add Gary');
    check('M2 Eric adds Gary: "Linked with Gary"', (await panelText(E)) === 'Linked with Gary', await panelText(E));
    await closeSettings(E);
    await syncIdle(G);
    await openSettings(G);
    check('M2 Gary\'s panel after his next sync: "Linked with Eric"', (await panelText(G)) === 'Linked with Eric', await panelText(G));
    await closeSettings(G);

    // ---------- 3. Share with, default on; shared capture on the other phone, read-only, offline ----------
    await openCapture(G);
    check('M3 linked: Share with Eric shown on a new capture, on by default', await shown(G, '#cap-share')
      && (await text(G, '#cap-share-label')) === 'Share with Eric' && await G.isChecked('#cap-share-on'));
    await G.click('#cap-close'); await waitCap(G, false);
    const gSh = await newCapture(G, 'Gary shared: Chatuchak stall 12', { photo: img });
    await syncIdle(G);
    check('M3 saved shared, photo uploaded to Gary\'s folder', gSh.shared === true && mock.rows.get(gSh.id).shared === true
      && mock.objects.has(`${UID}/${gSh.id}.jpg`) && mock.rows.get(gSh.id).photo_path === `${UID}/${gSh.id}.jpg`);
    await syncIdle(E);
    eRows = await rowsOnScreen(E);
    const eSh = eRows.find((r) => r.id === gSh.id);
    check('M3 item 3: on Eric\'s phone after his sync, labelled Gary, no sync chip, with its photo', !!eSh && eSh.partner && eSh.who === 'Gary'
      && !eSh.sync && eSh.thumb && await E.evaluate(async (id) => { const p = await idb.get('pphotos', id); return !!p && p.blob.size > 0; }, gSh.id), JSON.stringify(eRows));
    check('M3 the partner row is not in Eric\'s own captures and not counted in his pill', !(await store(E, 'captures')).some((r) => r.id === gSh.id)
      && (await pill(E)) === 'synced', await pill(E));
    await E.click(`#records .row[data-id="${gSh.id}"]`);
    await E.waitForFunction(() => document.getElementById('view-dlg').open);
    check('M6 tapping it opens the read-only view: text, photo, Gary; no capture screen, no Delete, no switches',
      (await text(E, '#view-body')) === 'Gary shared: Chatuchak stall 12' && /^Gary, /.test(await text(E, '#view-head'))
      && await shown(E, '#view-img') && (await E.$eval('#cap', (e) => e.hidden)) && !(await E.$('#view-dlg input, #view-dlg #cap-delete')));
    await E.click('#view-close');
    // Offline afterwards: reload with Supabase unreachable; the row and photo still show.
    phones.eric.net.offline = true;
    await E.reload();
    await E.waitForFunction(() => document.getElementById('day-label').textContent !== '-');
    await E.waitForTimeout(300);
    eRows = await rowsOnScreen(E);
    check('M3 offline after one online sync: the shared row and its photo still show on Eric\'s phone',
      eRows.some((r) => r.id === gSh.id && r.thumb && r.who === 'Gary'), JSON.stringify(eRows));

    // ---------- 11. Airplane-mode capture on Eric's phone, shared, reaches Gary ----------
    await openCapture(E);
    check('M11 offline, still linked by the last known state: Share with Gary shown, on', await shown(E, '#cap-share')
      && (await text(E, '#cap-share-label')) === 'Share with Gary' && await E.isChecked('#cap-share-on'));
    await E.click('#cap-close'); await waitCap(E, false);
    const eAir = await newCapture(E, 'Eric airplane: boat to Wat Arun');
    check('M11 saved offline, queued, shared', eAir.shared === true && eAir.dirty === 1 && !mock.rows.has(eAir.id) && /offline, 1 queued/.test(await pill(E)), await pill(E));
    phones.eric.net.offline = false;
    await syncIdle(E);
    await syncIdle(G);
    gRows = await rowsOnScreen(G);
    check('M11 item 11: after reconnect it lands, and shows on Gary\'s phone labelled Eric', mock.rows.get(eAir.id)
      && mock.rows.get(eAir.id).owner === ERIC_UID && gRows.some((r) => r.id === eAir.id && r.who === 'Eric'), JSON.stringify(gRows));

    // ---------- 4. Switched off: never appears; switching off removes it and its photo ----------
    const gOff = await newCapture(G, 'Gary not shared', { share: false, photo: img });
    await syncIdle(G); await syncIdle(E);
    check('M4 a capture saved with Share with off never reaches Eric', mock.rows.get(gOff.id).shared === false
      && !(await store(E, 'partner')).some((r) => r.id === gOff.id) && !(await rowsOnScreen(E)).some((r) => r.id === gOff.id));
    const eStorage = mock.storageCalls.filter((c) => c.method === 'GET' && c.path === `${UID}/${gOff.id}.jpg`);
    check('M4 and Eric never fetched its photo', eStorage.length === 0);
    await G.click(`#records .row[data-id="${gSh.id}"]`); await waitCap(G, true);
    check('M4 edit screen shows the switch, on for the shared capture', await shown(G, '#cap-share') && await G.isChecked('#cap-share-on'));
    await G.click('#cap-share-on');
    await save(G);
    await syncIdle(G);
    check('M4 switched off: shared false on the server, the row queued then synced', mock.rows.get(gSh.id).shared === false);
    await syncIdle(E);
    check('M4 item 4: at Eric\'s next sync the row and its photo leave his phone', !(await store(E, 'partner')).some((r) => r.id === gSh.id)
      && !(await store(E, 'pphotos')).some((p) => p.id === gSh.id) && !(await rowsOnScreen(E)).some((r) => r.id === gSh.id));
    // a direct read of the file as Eric is now refused
    const refused = await E.evaluate(async (p) => { const { data, error } = await sb.storage.from('tb-photos').download(p); return !data && !!error; }, `${UID}/${gSh.id}.jpg`);
    check('M4 Eric can no longer download that photo', refused);

    // ---------- 5. Captures from before linking stay unshared until switched on ----------
    check('M5 Gary\'s capture from before linking is not on Eric\'s phone', !(await store(E, 'partner')).some((r) => r.id === gPre.id));
    await G.click(`#records .row[data-id="${gPre.id}"]`); await waitCap(G, true);
    check('M5 its edit screen shows Share with Eric off', await shown(G, '#cap-share') && !(await G.isChecked('#cap-share-on')));
    await G.click('#cap-share-on');
    await save(G);
    await syncIdle(G); await syncIdle(E);
    check('M5 item 5: switched on in edit, it appears on Eric\'s phone', (await rowsOnScreen(E)).some((r) => r.id === gPre.id && r.who === 'Gary'));

    // ---------- 6. Neither can edit or delete the other's capture ----------
    const rej = await E.evaluate(async (row) => {
      const out = [];
      for (const patch of [{ body: 'Eric edits Gary' }, { deleted_at: new Date().toISOString() }]) {
        const { error } = await sb.rpc('tb_captures_upsert', { p: [Object.assign({}, row, patch, { updated_at: new Date(Date.now() + 86400000).toISOString() })] });
        out.push(!!error);
      }
      return out;
    }, (await store(E, 'partner')).find((r) => r.id === gPre.id));
    check('M6 item 6: the server rejects Eric\'s edit and delete of Gary\'s capture; Gary\'s row unchanged', rej[0] && rej[1]
      && mock.rows.get(gPre.id).body === 'Gary before linking' && !mock.rows.get(gPre.id).deleted_at && mock.rows.get(gPre.id).owner === UID, JSON.stringify(rej));
    check('M6 Eric\'s pill counts only his own rows (synced while he holds Gary\'s)', (await pill(E)) === 'synced' && (await store(E, 'partner')).length >= 1);

    // ---------- 9 and 10. Journals private; Eric's prompt; Gary's shared capture in Eric's call ----------
    await G.click('#tab-journal');
    await G.click('#capture'); await waitCap(G, true);
    await G.fill('#cap-body', 'Gary private journal turn');
    await save(G);
    await syncIdle(G);
    await E.click('#tab-journal');
    await E.click('#capture'); await waitCap(E, true);
    await E.fill('#cap-body', 'Did Gary find the stall?');
    const nClaude = mock.claude.length;
    await save(E);
    await syncIdle(E);
    const eCall = mock.claude.slice(nClaude).find((c) => c.uid === ERIC_UID);
    check('M10 Eric\'s journal call uses his prompt (journal-eric)', !!eCall && eCall.system === 'PROMPT journal-eric', eCall && eCall.system);
    check('M10 Gary\'s shared capture is in Eric\'s context by="Gary"; the unshared one is absent', !!eCall
      && /by="Gary"[^>]*>\nGary before linking/.test(eCall.context) && !eCall.context.includes('Gary not shared')
      && /by="Eric"[^>]*>\nEric airplane: boat to Wat Arun/.test(eCall.context), eCall && eCall.context.slice(0, 500));
    const eJournal = await store(E, 'journal'), gJournal = await store(G, 'journal');
    check('M9 item 9: Eric\'s phone holds only his own thread; Gary\'s holds only his', eJournal.every((r) => !/Gary private/.test(r.content))
      && eJournal.some((r) => r.content === 'Did Gary find the stall?') && gJournal.every((r) => r.content !== 'Did Gary find the stall?')
      && !(await E.$eval('#j-thread', (e) => e.textContent)).includes('Gary private'));
    const eDay = (eJournal[0] || {}).local_date;
    check('M9 for Eric the server counts and returns only his own 2 rows that day (Gary wrote there too)',
      mock.jdayList(400, ERIC_UID).find((d) => d.local_date === eDay).messages === 2 && mock.jdayList(400, UID).find((d) => d.local_date === eDay).messages === 2
      && mock.jday(eDay, ERIC_UID).messages.every((m) => !/Gary private/.test(m.content)));
    await G.click('#tab-captures'); await E.click('#tab-captures');

    // ---------- export ----------
    const [dl] = await Promise.all([E.waitForEvent('download'), E.evaluate(() => exportCaptures())]);
    const ex = JSON.parse(require('fs').readFileSync(await dl.path(), 'utf8'));
    const exG = ex.captures.find((c) => c.id === gPre.id), exE = ex.captures.find((c) => c.id === eAir.id);
    check('M12 export: own and partner captures, with owner_name and shared', ex.app_version === Number(APP) && ex.own >= 2 && ex.partner >= 1
      && exG && exG.owner_name === 'Gary' && exG.partner === true && exG.shared === true
      && exE && exE.owner_name === 'Eric' && exE.shared === true && !exE.partner, JSON.stringify({ own: ex.own, partner: ex.partner }));

    // ---------- the switch in a draft ----------
    await openCapture(G);
    await G.fill('#cap-body', 'Draft kept unshared');
    await G.click('#cap-share-on');
    await G.waitForTimeout(150);
    await G.reload();
    await G.waitForFunction(() => document.getElementById('day-label').textContent !== '-');
    await waitCap(G, true);
    check('M13 killed mid-typing: the draft comes back with Share with off', (await G.inputValue('#cap-body')) === 'Draft kept unshared'
      && !(await G.isChecked('#cap-share-on')));
    await save(G);
    await syncIdle(G);
    const gDraft = (await store(G, 'captures')).find((r) => r.body === 'Draft kept unshared');
    check('M13 saved from the draft unshared', gDraft && gDraft.shared === false && mock.rows.get(gDraft.id).shared === false);

    // ---------- partner pull failure keeps the mirror ----------
    mock.partnerFail = true;
    const before = (await store(E, 'partner')).length;
    await syncIdle(E);
    check('M14 a failed partner pull leaves Eric\'s shared rows in place and reports the error', (await store(E, 'partner')).length === before && before > 0
      && /error/.test(await pill(E)), await pill(E));
    mock.partnerFail = false;
    await syncIdle(E);

    // ---------- Add or Remove offline: not queued ----------
    phones.eric.net.offline = true;
    const callsBefore = mock.calls.length;
    await partnerButton(E, 'Remove');
    check('M15 Remove offline: "Needs a connection", nothing sent, still linked', /Needs a connection/.test(await text(E, '#partners .err'))
      && mock.calls.length === callsBefore && mock.linked(UID, ERIC_UID), await text(E, '#partners .err'));
    await closeSettings(E);
    phones.eric.net.offline = false;

    // ---------- 8. Removing the link from either side ----------
    await syncIdle(E);
    await partnerButton(E, 'Remove');
    check('M8 Eric removes the link: his panel "Gary added you. Add him to link"', (await panelText(E)) === 'Gary added you. Add him to link', await panelText(E));
    await closeSettings(E);
    await syncIdle(E); await syncIdle(G);
    check('M8 item 8: Gary\'s captures leave Eric\'s phone and Eric\'s leave Gary\'s, photos too', (await store(E, 'partner')).length === 0
      && (await store(G, 'partner')).length === 0 && (await store(E, 'pphotos')).length === 0
      && !(await rowsOnScreen(E)).some((r) => r.partner) && !(await rowsOnScreen(G)).some((r) => r.partner));
    await openSettings(G);
    check('M8 Gary\'s panel: "You added Eric. Waiting for Eric to add you"', (await panelText(G)) === 'You added Eric. Waiting for Eric to add you', await panelText(G));
    await closeSettings(G);
    await openCapture(G);
    check('M8 unlinked: the Share with switch is gone again', !(await shown(G, '#cap-share')));
    await G.click('#cap-close'); await waitCap(G, false);
    await partnerButton(E, 'Add Gary');
    await closeSettings(E);
    await syncIdle(E); await syncIdle(G);
    check('M8 adding again shows the captures still shared, not the unshared', (await store(E, 'partner')).some((r) => r.id === gPre.id)
      && !(await store(E, 'partner')).some((r) => r.id === gSh.id || r.id === gOff.id) && (await store(G, 'partner')).some((r) => r.id === eAir.id));
    await partnerButton(G, 'Remove');
    await closeSettings(G);
    await syncIdle(G); await syncIdle(E);
    check('M8 Gary removes the link: both phones cleared again', (await store(E, 'partner')).length === 0 && (await store(G, 'partner')).length === 0);

    // ---------- Change password (SPEC.md 7B.3, 7B.5 item 13) ----------
    await openSettings(E);
    check('P1 Change password offered while signed in', await shown(E, '#pw-open'));
    await E.click('#pw-open');
    await E.fill('#pw-new', 'short'); await E.fill('#pw-again', 'short');
    await E.click('#pw-save');
    check('P1 under 10 characters refused on the phone, nothing sent', /At least 10/.test(await text(E, '#pw-err'))
      && !mock.authCalls.some((c) => c.method === 'PUT'));
    await E.fill('#pw-new', 'eric-new-password-2'); await E.fill('#pw-again', 'eric-new-password-3');
    await E.click('#pw-save');
    check('P1 the two entries must match', /differ/.test(await text(E, '#pw-err')) && !mock.authCalls.some((c) => c.method === 'PUT'));
    phones.eric.net.offline = true;
    await E.fill('#pw-again', 'eric-new-password-2');
    await E.click('#pw-save');
    await E.waitForFunction(() => /connection/.test(document.getElementById('pw-err').textContent), null, { timeout: 8000 }).catch(() => {});
    check('P2 offline: "Needs a connection", not queued', /Needs a connection/.test(await text(E, '#pw-err')) && !mock.authCalls.some((c) => c.method === 'PUT')
      && mock.passwords[ERIC_UID] === 'eric-password-1');
    phones.eric.net.offline = false;
    mock.reauthRequired = true;
    await E.click('#pw-save');
    await E.waitForFunction(() => document.getElementById('pw-err').textContent && !/connection/.test(document.getElementById('pw-err').textContent), null, { timeout: 8000 }).catch(() => {});
    check('P3 the server asks for reauthentication: its error is shown, password unchanged, no reauthenticate call',
      /reauthentication/i.test(await text(E, '#pw-err')) && mock.passwords[ERIC_UID] === 'eric-password-1'
      && !mock.authCalls.some((c) => /reauthenticate/.test(c.path)), await text(E, '#pw-err'));
    mock.reauthRequired = false;
    await E.click('#pw-save');
    await E.waitForFunction(() => /changed/.test(document.getElementById('pw-ok').textContent), null, { timeout: 8000 }).catch(() => {});
    const put = mock.authCalls.filter((c) => c.method === 'PUT' && c.path === '/auth/v1/user').pop();
    check('P4 changed as the signed-in user: success shown, server holds the new password', /Password changed/.test(await text(E, '#pw-ok'))
      && mock.passwords[ERIC_UID] === 'eric-new-password-2' && put && put.body.password === 'eric-new-password-2'
      && (await E.$eval('#pw-form', (f) => f.hidden)) && (await E.inputValue('#pw-new')) === '', await text(E, '#pw-ok'));
    await E.click('#signout');
    await E.waitForFunction(() => !document.getElementById('signin').hidden);
    await E.fill('#email', 'eric@travelboard.local'); await E.fill('#password', 'eric-password-1');
    await E.click('#signin button[type="submit"]');
    await E.waitForFunction(() => document.getElementById('signin-err').textContent, null, { timeout: 8000 }).catch(() => {});
    check('P5 the old password is refused', /Invalid login credentials/.test(await text(E, '#signin-err')) && !(await shown(E, '#signout')), await text(E, '#signin-err'));
    await E.fill('#password', 'eric-new-password-2');
    await E.click('#signin button[type="submit"]');
    await E.waitForFunction(() => document.getElementById('signin').hidden, null, { timeout: 8000 }).catch(() => {});
    await closeSettings(E);
    await syncIdle(E);
    check('P5 the new password signs Eric in and he syncs', (await text(E, '#s-user')) === 'eric@travelboard.local' && (await pill(E)) === 'synced', await pill(E));
    await openSettings(E);
    await E.click('#pw-open');
    await E.fill('#pw-new', 'eric-new-password-2'); await E.fill('#pw-again', 'eric-new-password-2');
    await E.click('#pw-save');
    await E.waitForFunction(() => document.getElementById('pw-err').textContent, null, { timeout: 8000 }).catch(() => {});
    check('P6 the same password again: the server\'s own error is shown', /different from the old password/.test(await text(E, '#pw-err')), await text(E, '#pw-err'));
    await closeSettings(E);
  } catch (e) {
    console.error(e);
    check('suite ran to the end', false, e.message);
  } finally {
    await browser.close();
    srv.close();
  }
  const failed = results.filter((x) => !x.ok).length;
  console.log(`\n${results.length - failed} of ${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
