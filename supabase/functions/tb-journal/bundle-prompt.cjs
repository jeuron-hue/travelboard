#!/usr/bin/env node
// Writes prompt.ts from every prompts/*.md, so the prompts are bundled into tb-journal at
// deploy (SPEC.md 4.2, 8.4, 7B.4). Each file's name without .md is its key, the value of
// travel.people.journal_prompt (journal for Gary, journal-eric for Eric). Run after editing
// a prompt, then redeploy:
//   node supabase/functions/tb-journal/bundle-prompt.cjs
// checks/static.cjs fails while prompt.ts is out of date.
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..', '..');
const dir = path.join(ROOT, 'prompts');
const prompts = {};
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md')).sort()) {
  prompts[f.slice(0, -3)] = fs.readFileSync(path.join(dir, f), 'utf8');
}
const out = '// GENERATED from prompts/*.md by bundle-prompt.cjs. Do not edit by hand.\n' +
  '// Key: travel.people.journal_prompt. Value: the file\'s text.\n' +
  'export const PROMPTS: Record<string, string> = ' + JSON.stringify(prompts, null, 2) + ';\n';
fs.writeFileSync(path.join(__dirname, 'prompt.ts'), out);
console.log('prompt.ts written: ' + Object.entries(prompts).map(([k, v]) => `${k} ${v.length} characters`).join(', '));
