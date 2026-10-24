#!/usr/bin/env node
// travelboard static checks (SPEC.md 11). Run from the repo root: node checks/static.cjs
// - every inline <script> in the root HTML files parses
// - each HTML file opens with a SOURCE OF RECORD comment block; no em dashes in HTML
// - manifest.webmanifest is valid and its icons exist at the declared sizes
// - sw.js parses; its precache list matches the files on disk; cache name tb-shell-v<N>
//   matches APP_VERSION in trip.html
// - no service_role key or string, and no sb_secret_ key, anywhere it could ship
// - no Anthropic API key anywhere in the repo (SPEC.md 8.7 item 4)
// - tb-journal: prompt.ts is current with every prompts/*.md (journal and, from M1.2,
//   journal-eric); the function reads its key only from TB_ANTHROPIC_API_KEY and uses no
//   service key
// - keep-alive workflow pings the project and key trip.html uses, daily, with no secret
// - M1.1: photo constants, IndexedDB v3 (v4 from M1.2), no file deletes, 30 photos and 1 h
//   cache in tb-journal, migration 0006 shape
// - M1.2: stores partner and pphotos, shared pushed, partner rows never pushed, Change
//   password via updateUser (10 characters minimum), migration 0008 shape
// - M1.3: Newsreader and Plex 500 vendored, 7C.8 tokens in both themes, IndexedDB v5 with
//   geocache, no kind toggle, place_name pushed, chip and Nominatim limits, tb-journal sends no
//   kind and takes the custom prompt, migration 0009 shape
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const failures = [];
const passes = [];
const check = (ok, msg) => (ok ? passes : failures).push(msg);
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));

function walk(dir, out = []) {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    if (e.name === '.git' || e.name === 'node_modules') continue;
    const rel = dir ? `${dir}/${e.name}` : e.name;
    if (e.isDirectory()) walk(rel, out); else out.push(rel);
  }
  return out;
}

// ---------- HTML ----------
const htmlFiles = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html'));
check(htmlFiles.includes('trip.html'), 'trip.html exists');
check(htmlFiles.includes('index.html'), 'index.html exists');
for (const f of htmlFiles) {
  const src = read(f);
  const head = src.slice(0, 400);
  check(/^<!doctype html>\s*<!--\s*\n?\s*SOURCE OF RECORD/i.test(head), `${f}: opens with SOURCE OF RECORD comment`);
  check(/Change log \(newest first\)/.test(src.slice(0, 3000)), `${f}: has a change log`);
  check(!src.includes('—'), `${f}: no em dashes`);
  const re = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi;
  let m, n = 0;
  while ((m = re.exec(src))) {
    const attrs = m[1] || '';
    if (/\bsrc\s*=/.test(attrs)) {
      const ref = attrs.match(/\bsrc\s*=\s*"([^"]+)"/);
      if (ref) check(exists(ref[1]), `${f}: script src ${ref[1]} exists`);
      continue;
    }
    n++;
    try { new vm.Script(m[2], { filename: `${f}#inline${n}` }); check(true, `${f}: inline script ${n} parses`); }
    catch (e) { check(false, `${f}: inline script ${n} parses (${e.message})`); }
  }
  for (const ref of src.matchAll(/\b(?:href|url\()\s*=?\s*['"]?((?:vendor|icons)\/[^'")\s]+)/g)) {
    check(exists(ref[1]), `${f}: referenced ${ref[1]} exists`);
  }
}

// ---------- manifest ----------
function pngSize(p) {
  const b = fs.readFileSync(path.join(ROOT, p));
  if (b.readUInt32BE(0) !== 0x89504e47) return null;
  return `${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`;
}
let manifest = null;
try { manifest = JSON.parse(read('manifest.webmanifest')); check(true, 'manifest: valid JSON'); }
catch (e) { check(false, `manifest: valid JSON (${e.message})`); }
if (manifest) {
  check(manifest.name === 'travelboard' && manifest.short_name === 'travelboard', 'manifest: name and short_name');
  check(manifest.start_url === './trip.html', 'manifest: start_url ./trip.html');
  check(manifest.scope === './', 'manifest: scope ./');
  check(manifest.display === 'standalone', 'manifest: display standalone');
  check(manifest.orientation === 'portrait', 'manifest: orientation portrait');
  check(/^#[0-9a-f]{6}$/i.test(manifest.theme_color || '') && /^#[0-9a-f]{6}$/i.test(manifest.background_color || ''), 'manifest: theme and background colours');
  const icons = manifest.icons || [];
  for (const want of [['192x192', 'any'], ['512x512', 'any'], ['512x512', 'maskable']]) {
    const icon = icons.find((i) => i.sizes === want[0] && (i.purpose || 'any').split(' ').includes(want[1]));
    check(!!icon, `manifest: ${want[1]} icon ${want[0]} declared`);
    if (icon) check(exists(icon.src) && pngSize(icon.src) === want[0], `manifest: ${icon.src} is a ${want[0]} PNG`);
  }
  const sc = (manifest.shortcuts || []).find((s) => s.url === './trip.html?new=1');
  check(!!sc && sc.name === 'New capture', 'manifest: "New capture" shortcut to ./trip.html?new=1');
  const st = manifest.share_target || {};
  check(st.action === './trip.html' && (st.method || 'GET').toUpperCase() === 'GET'
    && st.params && st.params.title === 'title' && st.params.text === 'text' && st.params.url === 'url',
    'manifest: share_target GET ./trip.html with title, text, url');
}

// ---------- service worker ----------
const sw = read('sw.js');
try { new vm.Script(sw, { filename: 'sw.js' }); check(true, 'sw.js: parses'); }
catch (e) { check(false, `sw.js: parses (${e.message})`); }
const ver = sw.match(/const CACHE_VERSION = '(\d+\.\d+\.\d+)';/);
check(!!ver, 'sw.js: CACHE_VERSION declared as 0.<minor>.<patch>');
check(/const CACHE = 'tb-shell-v' \+ CACHE_VERSION;/.test(sw), 'sw.js: cache name tb-shell-v<N>');
const appVer = read('trip.html').match(/const APP_VERSION = '(\d+\.\d+\.\d+)';/);
check(!!(ver && appVer && ver[1] === appVer[1]), `sw.js CACHE_VERSION (${ver && ver[1]}) equals trip.html APP_VERSION (${appVer && appVer[1]})`);
check(!/skipWaiting\(\)/.test(sw.replace(/if \(event\.data && event\.data\.type === 'SKIP_WAITING'\) self\.skipWaiting\(\);/, '')),
  'sw.js: skipWaiting only on the SKIP_WAITING message');
const pre = sw.match(/const PRECACHE = \[([\s\S]*?)\];/);
check(!!pre, 'sw.js: PRECACHE list found');
if (pre) {
  const list = [...pre[1].matchAll(/'([^']+)'/g)].map((m) => m[1].replace(/^\.\//, ''));
  for (const f of list) check(exists(f), `sw.js precache: ${f} exists on disk`);
  const expected = ['trip.html', 'manifest.webmanifest', ...walk('icons'), ...walk('vendor')].sort();
  const missing = expected.filter((f) => !list.includes(f));
  const extra = list.filter((f) => !expected.includes(f));
  check(missing.length === 0, `sw.js precache: covers trip.html, manifest, icons/*, vendor/*${missing.length ? ' (missing ' + missing.join(', ') + ')' : ''}`);
  check(extra.length === 0, `sw.js precache: nothing outside the shell${extra.length ? ' (extra ' + extra.join(', ') + ')' : ''}`);
}

// ---------- secrets ----------
// Shipped files must not contain the string service_role. Every file in the repo is
// scanned for JWTs whose role is service_role and for sb_secret_ keys. The docs and the
// checks themselves name the role in prose, so they are exempt from the string check only.
const PROSE = new Set(['SPEC.md', 'CLAUDE.md', 'TESTS.md', 'checks/static.cjs', 'checks/smoke.sql', 'checks/catalogue.sql']);
const textLike = (f) => /\.(html|js|cjs|mjs|json|webmanifest|md|sql|ts|txt|css|ya?ml)$/i.test(f) || !path.extname(f);
let secretHits = 0;
for (const f of walk('')) {
  if (!textLike(f)) continue;
  const src = read(f);
  if (!PROSE.has(f) && /service_role/.test(src)) { check(false, `secrets: "service_role" string in ${f}`); secretHits++; }
  if (/sb_secret_[A-Za-z0-9_-]{8,}/.test(src)) { check(false, `secrets: sb_secret_ key in ${f}`); secretHits++; }
  for (const m of src.matchAll(/eyJ[A-Za-z0-9_-]+\.(eyJ[A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+/g)) {
    try {
      const payload = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8'));
      if (payload.role === 'service_role') { check(false, `secrets: service_role JWT in ${f}`); secretHits++; }
    } catch (e) { /* not a JWT */ }
  }
}
check(secretHits === 0, 'secrets: no service_role or sb_secret_ material');
const anthropicHits = walk('').filter((f) => textLike(f) && /sk-ant-[A-Za-z0-9_-]{8,}/.test(read(f)));
check(anthropicHits.length === 0, `secrets: no Anthropic API key in the repo${anthropicHits.length ? ' (' + anthropicHits.join(', ') + ')' : ''}`);

// ---------- tb-journal Edge Function ----------
const FN = 'supabase/functions/tb-journal';
for (const f of ['index.ts', 'prompt.ts', 'context.mjs', 'bundle-prompt.cjs']) check(exists(`${FN}/${f}`), `tb-journal: ${f} exists`);
check(exists('prompts/journal.md'), 'tb-journal: prompts/journal.md exists');
check(exists('prompts/journal-eric.md'), 'tb-journal: prompts/journal-eric.md exists (M1.2)');
if (exists(`${FN}/prompt.ts`)) {
  const m = read(`${FN}/prompt.ts`).match(/export const PROMPTS: Record<string, string> = (\{.*\});\n/s);
  let bundled = null;
  try { bundled = m && JSON.parse(m[1]); } catch (e) { /* not current */ }
  const files = fs.readdirSync(path.join(ROOT, 'prompts')).filter((f) => f.endsWith('.md')).sort();
  const ok = !!bundled && Object.keys(bundled).sort().join() === files.map((f) => f.slice(0, -3)).sort().join()
    && files.every((f) => bundled[f.slice(0, -3)] === read('prompts/' + f));
  check(ok, `tb-journal: prompt.ts matches prompts/*.md (${files.join(', ')}; run bundle-prompt.cjs after editing a prompt)`);
  check(!!bundled && !/\bGary\b/.test(bundled['journal-eric'] || 'Gary'), 'tb-journal: journal-eric names Eric, not Gary');
}
if (exists(`${FN}/index.ts`)) {
  const fn = read(`${FN}/index.ts`);
  check(/Deno\.env\.get\('TB_ANTHROPIC_API_KEY'\)/.test(fn) && !/Deno\.env\.get\('ANTHROPIC_API_KEY'\)/.test(fn), 'tb-journal: key read only from TB_ANTHROPIC_API_KEY');
  check(!/service_role|SERVICE_ROLE|SECRET_KEY/i.test(fn), 'tb-journal: no service key');
  check(/const MODEL = 'claude-sonnet-5-5';/.test(fn) && /const MAX_TOKENS = 1500;/.test(fn), 'tb-journal: model claude-sonnet-5-5, max_tokens 1500');
}
if (exists(`${FN}/context.mjs`)) check(/export const MAX_TURNS = 40;/.test(read(`${FN}/context.mjs`)), 'tb-journal: 40-turn cap');

// ---------- M1.1 photos (SPEC.md 7A) ----------
{
  const trip = read('trip.html');
  check(/const BUCKET = 'tb-photos';/.test(trip) && /const PHOTO_EDGE = 1280;/.test(trip) && /const PHOTO_QUALITY = 0\.82;/.test(trip),
    'photos: client uses bucket tb-photos, 1280 px long edge, JPEG 0.82');
  check(/indexedDB\.open\('travelboard', 5\)/.test(trip) && /createObjectStore\('photos', \{ keyPath: 'id' \}\)/.test(trip), 'photos: IndexedDB v5 (M1.3) keeps store photos');
  check(!/storage\.from\([^)]*\)\.remove\(/.test(trip) && !/method: 'DELETE'/.test(trip), 'photos: the client never deletes a file (rule 8)');
  if (exists(`${FN}/context.mjs`)) {
    const ctx = read(`${FN}/context.mjs`);
    check(/export const MAX_PHOTOS = 30;/.test(ctx) && /export const CACHE_TTL = '1h';/.test(ctx) && /photo_to_claude !== false/.test(ctx), 'photos: tb-journal sends at most 30 switched-on photos, cache breakpoint 1 h');
  }
  const m6 = exists('supabase/migrations/0006_tb_photos_bucket.sql') ? read('supabase/migrations/0006_tb_photos_bucket.sql') : '';
  check(/values \('tb-photos', 'tb-photos', false, 2097152, array\['image\/jpeg'\]\)/.test(m6)
    && (m6.match(/create policy tb_photos_(select|insert|update) on storage\.objects for (select|insert|update) to authenticated/g) || []).length === 3
    && !/for delete/.test(m6) && !/\banon\b[^.]*\bto\b|to anon/.test(m6), 'photos: 0006 makes a private 2 MB JPEG bucket and three own-folder policies, no delete, nothing for anon');
}

// ---------- M1.2 two travellers (SPEC.md 7B) ----------
{
  const trip = read('trip.html');
  check(/createObjectStore\('partner', \{ keyPath: 'id' \}\)/.test(trip) && /createObjectStore\('pphotos', \{ keyPath: 'id' \}\)/.test(trip),
    'M1.2: IndexedDB v4 adds stores partner and pphotos');
  check(/'photo_to_claude', 'shared', 'place_name', 'updated_at', 'deleted_at'\]/.test(trip) && /k === 'shared' \? row\[k\] === true/.test(trip),
    'M1.2: captures push shared, false when absent');
  check(/sb\.rpc\('tb_partner_captures'\)/.test(trip) && !/idb\.byIndex\('partner', 'dirty'/.test(trip) && !/toServer\([^)]*partner/.test(trip.replace(/idb\.all\('partner'\)\)\.map\(\(r\) => Object\.assign\(toServer\(r\)/, '')),
    'M1.2: partner rows come from tb_partner_captures and are never pushed');
  check(/const PASSWORD_MIN = 10;/.test(trip) && /sb\.auth\.updateUser\(\{ password: a \}\)/.test(trip) && !/reauthenticate\(/.test(trip),
    'M1.2: Change password sets at least 10 characters with updateUser as the user; no reauthentication workaround');
  const m8 = exists('supabase/migrations/0008_two_travellers.sql') ? read('supabase/migrations/0008_two_travellers.sql') : '';
  check(/alter policy tb_photos_select on storage\.objects/.test(m8) && !/drop (policy|table|function|schema)/i.test(m8)
    && !/grant [^;]* to (anon|public)/i.test(m8) && (m8.match(/security definer/g) || []).length === 10,
    'M1.2: 0008 alters tb_photos_select, drops nothing, grants nothing to anon, 10 definer functions');
}

// ---------- M1.3 look and place (SPEC.md 7C) ----------
{
  const trip = read('trip.html');
  for (const [w, st] of [['500', 'normal'], ['600', 'normal'], ['500', 'italic']]) {
    check(exists(`vendor/fonts/newsreader-latin-${w}-${st}.woff2`) && new RegExp(`font-family: 'Newsreader';\\s*font-style: ${st}; font-weight: ${w};[^}]*newsreader-latin-${w}-${st}\\.woff2`).test(trip),
      `M1.3: Newsreader ${w} ${st} vendored and declared`);
  }
  check(exists('vendor/fonts/Newsreader-OFL-LICENSE') && /SIL Open Font License/.test(read('vendor/fonts/Newsreader-OFL-LICENSE')), 'M1.3: Newsreader OFL licence vendored');
  check(exists('vendor/fonts/ibm-plex-sans-latin-500-normal.woff2') && /font-weight: 500;[^}]*ibm-plex-sans-latin-500-normal\.woff2/.test(trip), 'M1.3: Plex Sans 500 vendored and declared');
  const light = (trip.match(/:root, \[data-theme="light"\] \{([^}]*)\}/) || [])[1] || '';
  const dark = (trip.match(/\[data-theme="dark"\] \{([^}]*)\}/) || [])[1] || '';
  const tok = (set, name, v) => new RegExp(`--${name}: ${v};`, 'i').test(set);
  const T = [['ground', '#F4EEE2', '#141C26'], ['surface', '#FBF8F1', '#1B2531'], ['ink', '#1F2A36', '#ECE6DA'], ['muted', '#5E6670', '#A3ACB6'],
    ['line', '#D9CFBD', '#2C3846'], ['ruled', '#E4DBCB', '#28333F'], ['accent', '#B4472A', '#E07A55'], ['accent-bg', '#F3DDD2', '#3A2620'],
    ['on-accent', '#FFF8EE', '#141C26'], ['blue', '#2F5577', '#8DB4D9'], ['blue-bg', '#DCE6EF', '#1F3247'], ['good', '#2E6B4A', '#6FC596'],
    ['good-bg', '#DDEBDF', '#173025'], ['warn', '#8A5A00', '#E2B355'], ['crit', '#b42318', '#e5534b'], ['photo', '#C2B08F', '#4A5566'], ['print', '#FFFDF8', '#2E3946']];
  const bad = T.filter(([n, l, d]) => !tok(light, n, l) || !tok(dark, n, d)).map((x) => x[0]);
  check(bad.length === 0, `M1.3: the 7C.8 colour tokens in both themes${bad.length ? ' (wrong: ' + bad.join(', ') + ')' : ''}`);
  check(/<meta name="theme-color" content="#141C26">/.test(trip) && manifest && manifest.theme_color === '#141C26' && manifest.background_color === '#141C26', 'M1.3: theme colour and manifest from the dark ground');
  check(/indexedDB\.open\('travelboard', 5\)/.test(trip) && /createObjectStore\('geocache', \{ keyPath: 'key' \}\)/.test(trip), 'M1.3: IndexedDB v5 adds store geocache');
  check(!/id="kind-/.test(trip) && /kind: 'note',/.test(trip) && !/setKind\(/.test(trip), 'M1.3: no kind toggle; new captures save kind note (7C.2a)');
  check(!/className = 'chip ' \+ \(r\.kind/.test(trip) && !/r\.kind === 'journal'/.test(trip), 'M1.3: no kind label on rows, no inline journal quotes');
  check(/const PLACE_MAX = 120;/.test(trip) && /const PLACE_NEAR_M = 75;/.test(trip) && /const PLACE_CHIPS = 3;/.test(trip) && /maxlength="120"/.test(trip),
    'M1.3: place names up to 120 characters; own names within 75 m; at most 3 chips');
  check(/const NOMINATIM_URL = 'https:\/\/nominatim\.openstreetmap\.org\/reverse';/.test(trip) && /format=jsonv2&lat=/.test(trip) && /&zoom=18&accept-language=en/.test(trip)
    && /const NOMINATIM_GAP_MS = 1000;/.test(trip) && /idb\.put\('geocache'/.test(trip), 'M1.3: Nominatim reverse jsonv2, zoom 18, English, one a second, cached in geocache');
  check(/OpenStreetMap contributors/.test(trip), 'M1.3: OpenStreetMap credit shown with the map chip');
  check(/function osmLabel\(j\)/.test(trip) && /const name = osmLabel\(j\);/.test(trip) && /=> `a:\$\{Math\.round/.test(trip),
    'M1.3 v13: map chip falls back to the address; geocache keys carry "a:" (Gary 24/10/26)');
  check(/if \(url\.origin !== self\.location\.origin\) return;/.test(sw), 'M1.3: the service worker never caches Nominatim (cross-origin is network only)');
  if (exists(`${FN}/context.mjs`)) {
    const ctx = read(`${FN}/context.mjs`);
    check(!/kind=|c\.kind/.test(ctx) && /place="\$\{attr\(named\)\}"/.test(ctx), 'M1.3: tb-journal labels captures by place name, never by kind');
    check(/export function pickPrompt/.test(ctx) && /pickPrompt\(turn\.me && turn\.me\.journal_prompt_custom, bundled\)/.test(read(`${FN}/index.ts`)), 'M1.3: tb-journal uses the custom prompt when set');
  }
  const m9 = exists('supabase/migrations/0009_place_and_prompt.sql') ? read('supabase/migrations/0009_place_and_prompt.sql') : '';
  check(/^begin;$/m.test(m9) && /^commit;$/m.test(m9) && !/drop (policy|table|function|schema|column)/i.test(m9) && !/grant [^;]* to (anon|public)/i.test(m9)
    && (m9.match(/security definer/g) || []).length === 4 && (m9.match(/^alter table (\S+)/gm) || []).every((x) => /alter table travel\./.test(x))
    && !/storage\.|auth\.users/.test(m9.replace(/^--.*$/gm, '')), 'M1.3: 0009 in one transaction, travel and tb_ only, drops nothing, grants nothing to anon, 4 definer functions');
}

// ---------- keep-alive workflow (SPEC.md 6.8 step 5) ----------
const KA = '.github/workflows/keepalive.yml';
check(exists(KA), 'keep-alive: workflow exists');
if (exists(KA)) {
  const ka = read(KA);
  const trip = read('trip.html');
  const ref = (trip.match(/const PROJECT_REF = '([a-z0-9]+)';/) || [])[1];
  const key = (trip.match(/const SUPABASE_PUBLISHABLE_KEY = '([^']+)';/) || [])[1];
  check(!!ref && ka.includes(`https://${ref}.supabase.co/rest/v1/rpc/tb_whoami`), `keep-alive: pings the project trip.html uses (${ref})`);
  check(!!key && ka.includes(`apikey: ${key}`), 'keep-alive: uses the same publishable key as trip.html');
  check(/schedule:\s*\n\s*- cron: '\d+ \d+ \* \* \*'/.test(ka), 'keep-alive: runs daily, well inside the 7-day pause window');
  check(!/secrets\./.test(ka), 'keep-alive: no secret beyond the publishable key');
}

// ---------- report ----------
for (const p of passes) console.log('PASS ' + p);
for (const f of failures) console.log('FAIL ' + f);
console.log(`\n${passes.length} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
