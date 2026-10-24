// tb-journal context building (SPEC.md 8.3 steps 5 and 6, 7A.4, 7B.4). Plain ES module with no
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

export const MAX_PHOTOS = 30;      // SPEC.md 7A.4: the most recent 30 switched-on photos of the day go in as images
export const CACHE_TTL = '1h';     // an evening's turns can be more than 5 min apart (SPEC.md 7A.4)

// System prompt: the caller's journal contract, prompts/<key>.md (journal for Gary,
// journal-eric for Eric, 7B.4). The day's context goes in a
// block before the thread (buildContext), so the system prompt is the same every day.
export function buildSystem(prompt) {
  return String(prompt).trim();
}

// A photo Claude may see: it has a path and its switch is on. tb_journal_turn already
// withholds the path of a switched-off photo (migration 0007); the switch is checked here
// too, so a switched-off photo is never sent, listed or mentioned (SPEC.md 7A.4).
const forClaude = (c) => !!c.photo_path && c.photo_to_claude !== false;

// Which of the day's photos go in as images: the most recent MAX_PHOTOS switched-on photos by
// captured_at, own and shared together (the 30 are combined across both travellers, D15).
// captures: the day's live captures, oldest first. Returns ids, oldest first.
export function photosToSend(captures) {
  return (captures || []).filter(forClaude).map((c) => c.id).slice(-MAX_PHOTOS);
}

// The day's context as content blocks, placed before the thread (SPEC.md 7A.4, 7B.4): the day,
// every capture with its local time, kind, place and text, then each photo sent as an image,
// labelled with its capture. A photo beyond the 30 is listed as "not shown"; one that failed
// to download as "could not be loaded". The last block carries the cache breakpoint, so the
// later turns of the evening read the images from cache.
// images: Map capture id -> base64 JPEG, or null when the download failed. Ids missing from
// the map were not sent (beyond the 30). A switched-off photo leaves no trace: its capture is
// listed like one without a photo.
// name: the caller's display name (tb_journal_turn me.display_name). From M1.2 the captures can
// include those a live partner shared (own false, owner_name the partner's name); then every
// capture says whose it is (by="..."), so Claude never takes a partner's note as the caller's.
export function buildContext(localDate, captures, images, name) {
  const imgs = images || new Map();
  const me = String(name || 'Gary');
  const caps = captures || [];
  const whose = (c) => (c.own === false ? String(c.owner_name || 'their partner') : me);
  const others = [...new Set(caps.filter((c) => c.own === false).map(whose))];
  const list = caps.map((c, i) => {
    const where = c.lat != null && c.lng != null
      ? `${Number(c.lat).toFixed(5)}, ${Number(c.lng).toFixed(5)}` +
        (c.accuracy_m != null ? ` (within ${Math.round(c.accuracy_m)} m)` : '')
      : '';
    let photo = '';
    if (forClaude(c)) {
      const at = `photo at ${fmtLocalTime(c.captured_at, c.tz).replace(/ time$/, '')}`;
      photo = !imgs.has(c.id) ? ` photo="${at}, not shown"` : imgs.get(c.id) === null ? ` photo="${at}, could not be loaded"` : ' photo="shown below"';
    }
    const by = others.length ? ` by="${whose(c)}"` : '';
    return `<capture n="${i + 1}" time="${fmtLocalTime(c.captured_at, c.tz)}"${by} kind="${c.kind}"${where ? ` location="${where}"` : ''}${photo}>\n` +
      `${String(c.body || '').trim() || '(no text)'}\n</capture>`;
  });
  const shared = others.join(' and ');
  const intro = !list.length
    ? `${me} made no captures on this day.`
    : others.length
      ? `Captures for this day, oldest first (${list.length}): ${me}'s own, and those ${shared} shared with ${me}. ` +
        `They are notes typed or dictated on the street. by= says whose each one is; a capture by ${shared} is ` +
        `${shared}'s own note, so do not assume ${me} was there for it:\n\n${list.join('\n\n')}`
      : `${me}'s captures for this day, oldest first (${list.length}). These are his own notes, typed or dictated on the street:\n\n${list.join('\n\n')}`;
  const blocks = [{ type: 'text', text:
    `<day>${fmtDay(localDate)}. A local day runs from 0400 to 0400, so captures after midnight belong to this evening.</day>\n\n` + intro }];
  caps.forEach((c, i) => {
    const data = imgs.get(c.id);
    if (!data) return;
    const text = String(c.body || '').trim();
    const by = others.length ? ` (by ${whose(c)})` : '';
    blocks.push({ type: 'text', text: `Photo from capture ${i + 1}${by}, ${fmtLocalTime(c.captured_at, c.tz)}, ${c.kind}: ${text || '(no text)'}` });
    blocks.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } });
  });
  blocks[blocks.length - 1].cache_control = { type: 'ephemeral', ttl: CACHE_TTL };
  return blocks;
}

// thread: [{role, content}] in thread order, ending with the user turn being answered.
// Consecutive turns of one role are joined (a turn that failed and a later one, both sent
// before any reply), capped to the most recent MAX_TURNS, starting on a user turn. When
// context blocks are given, they open the first user message, ahead of its text.
export function buildMessages(thread, context) {
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
  if (context && context.length) msgs[0] = { role: 'user', content: [...context, { type: 'text', text: msgs[0].content }] };
  return msgs;
}
