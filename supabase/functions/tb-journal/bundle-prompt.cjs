#!/usr/bin/env node
// Writes prompt.ts from prompts/journal.md, so the prompt is bundled into tb-journal at
// deploy (SPEC.md 4.2, 8.4). Run after editing prompts/journal.md, then redeploy:
//   node supabase/functions/tb-journal/bundle-prompt.cjs
// checks/static.cjs fails while prompt.ts is out of date.
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..', '..');
const src = fs.readFileSync(path.join(ROOT, 'prompts', 'journal.md'), 'utf8');
const out = '// GENERATED from prompts/journal.md by bundle-prompt.cjs. Do not edit by hand.\n' +
  'export const JOURNAL_PROMPT = ' + JSON.stringify(src) + ';\n';
fs.writeFileSync(path.join(__dirname, 'prompt.ts'), out);
console.log('prompt.ts written, ' + src.length + ' characters');
