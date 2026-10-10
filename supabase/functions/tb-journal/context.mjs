// tb-journal context building (SPEC.md 8.3 steps 5 and 6). Plain ES module with no
// imports, so the Edge Function (Deno) and the headless checks (node) run the same code.

export const MAX_TURNS = 40;

function partsIn(iso, tz) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short'
  });
  const p = {};
  for (const x of fmt.formatToParts(new Date(iso))) p[x.type] = x.value;
  return p;
}

// '2026-10-10' -> 'Sat 10/10/26'
export function fmtDay(ymd) {
  const [y, m, d] = String(ymd).split('-').map(Number);
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${wd} ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${String(y).slice(2)}`;
}

// Local time in the capture's own zone: '0030 hrs Bangkok time'
export function fmtLocalTime(iso, tz) {
  const p = partsIn(iso, tz);
  const city = String(tz || 'UTC').split('/').pop().replace(/_/g, ' ');
  return `${p.hour}${p.minute} hrs ${city} time`;
}

// System prompt: the journal contract from prompts/journal.md, then the day's context.
export function buildSystem(prompt, localDate, captures) {
  const list = (captures || []).map((c, i) => {
    const where = c.lat != null && c.lng != null
      ? `, at ${Number(c.lat).toFixed(5)}, ${Number(c.lng).toFixed(5)}` +
        (c.accuracy_m != null ? ` (within ${Math.round(c.accuracy_m)} m)` : '')
      : '';
    return `<capture n="${i + 1}" time="${fmtLocalTime(c.captured_at, c.tz)}" kind="${c.kind}"${where ? ` location="${where.slice(5)}"` : ''}>\n` +
      `${String(c.body || '').trim()}\n</capture>`;
  });
  return `${String(prompt).trim()}\n\n` +
    `<day>${fmtDay(localDate)}. A local day runs from 0400 to 0400, so captures after midnight belong to this evening.</day>\n\n` +
    (list.length
      ? `Gary's captures for this day, oldest first (${list.length}). These are his own notes, typed or dictated on the street:\n\n${list.join('\n\n')}`
      : 'Gary made no captures on this day.');
}

// thread: [{role, content}] in thread order, ending with the user turn being answered.
// Consecutive turns of one role are joined (a turn that failed and a later one, both sent
// before any reply), capped to the most recent MAX_TURNS, starting on a user turn.
export function buildMessages(thread) {
  const out = [];
  for (const m of thread || []) {
    const role = m.role === 'assistant' ? 'assistant' : 'user';
    const text = String(m.content || '').trim();
    if (!text) continue;
    const last = out[out.length - 1];
    if (last && last.role === role) last.content += '\n\n' + text;
    else out.push({ role, content: text });
  }
  let msgs = out.slice(-MAX_TURNS);
  while (msgs.length && msgs[0].role !== 'user') msgs = msgs.slice(1);
  if (!msgs.length || msgs[msgs.length - 1].role !== 'user') throw new Error('thread must end with a user turn');
  return msgs;
}
