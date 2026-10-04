#!/usr/bin/env node
// travelboard static checks (SPEC.md 11). Run from the repo root: node checks/static.cjs
// - every inline <script> in the root HTML files parses
// - each HTML file opens with a SOURCE OF RECORD comment block; no em dashes in HTML
// - manifest.webmanifest is valid and its icons exist at the declared sizes
// - sw.js parses; its precache list matches the files on disk; cache name tb-shell-v<N>
//   matches APP_VERSION in trip.html
// - no service_role key or string, and no sb_secret_ key, anywhere it could ship
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
const ver = sw.match(/const CACHE_VERSION = (\d+);/);
check(!!ver, 'sw.js: CACHE_VERSION declared');
check(/const CACHE = 'tb-shell-v' \+ CACHE_VERSION;/.test(sw), 'sw.js: cache name tb-shell-v<N>');
const appVer = read('trip.html').match(/const APP_VERSION = (\d+);/);
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
const textLike = (f) => /\.(html|js|cjs|mjs|json|webmanifest|md|sql|ts|txt|css)$/i.test(f) || !path.extname(f);
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

// ---------- report ----------
for (const p of passes) console.log('PASS ' + p);
for (const f of failures) console.log('FAIL ' + f);
console.log(`\n${passes.length} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
