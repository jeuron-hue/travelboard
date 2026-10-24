// Regenerates icons/icon-192.png, icon-512.png and icon-maskable-512.png from icon-b.svg
// (SPEC.md 7C.8, option B). Dev only, never shipped. Run from the repo root after
// `npm install` in checks/headless:  node design/m1.3/make-icons.cjs
// The "any" icons keep the rounded ink ground with transparent corners; the maskable icon has
// a full-bleed square ground, so Android's mask never shows a corner. The manifest's shortcut
// icon is icons/icon-192.png.
'use strict';
const fs = require('fs');
const path = require('path');
const { launch } = require('../../checks/headless/harness.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const svg = fs.readFileSync(path.join(__dirname, 'icon-b.svg'), 'utf8');
const square = svg.replace(/<rect id="ground" width="100" height="100" rx="22"/, '<rect id="ground" width="100" height="100"');
if (square === svg) throw new Error('icon-b.svg: ground rect not found');

(async () => {
  const browser = await launch();
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const [file, size, src] of [['icon-192.png', 192, svg], ['icon-512.png', 512, svg], ['icon-maskable-512.png', 512, square]]) {
    await page.setViewportSize({ width: size, height: size });
    const sized = src.replace('width="100" height="100">', `width="${size}" height="${size}">`);
    await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">${sized}</body></html>`);
    await page.screenshot({ path: path.join(ROOT, 'icons', file), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
    console.log('wrote icons/' + file);
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
