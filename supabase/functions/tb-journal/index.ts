// SOURCE OF RECORD: tb-journal, travelboard's journal Edge Function (SPEC.md 8.3).
//
// One call per user turn: POST { local_date, message_id, content, created_at } with the
// signed-in user's JWT. verify_jwt is on. The function reaches the database only as that
// user, through tb_journal_turn and tb_journal_reply (migration 0004); it holds no
// service key. The Anthropic key is the secret TB_ANTHROPIC_API_KEY (Console workspace
// travelboard) and never leaves this function.
//
// Steps: store the user turn (idempotent) -> if a reply exists, return it with no API
// call -> else download the day's switched-on photos as the user (most recent 30, 7A.4,
// own and shared together) -> build the system prompt (the caller's own: prompts/<key>.md,
// key from travel.people.journal_prompt, 7B.4), the day's context block (own captures and
// those a live partner shared, each labelled with whose it is, and photos, with a
// prompt-cache breakpoint after the last one) and the thread (last 40 turns, the caller's
// own) -> Claude -> store the reply once, with token and cache counts -> return it.
//
// Responses: 200 { user, reply, cached }. Errors: { error, message } with 400 bad request,
// 401 not signed in, 502 Anthropic or database failure, 503 Anthropic busy. The client
// keeps the user turn and offers Retry.
//
// Change log (newest first)
// - 24/10/26 M1.2 Two travellers (SPEC.md 7B.4, migration 0008). The system prompt is the
//   caller's: tb_journal_turn returns me.journal_prompt, the key into PROMPTS (prompts/*.md);
//   an unknown key fails with no_prompt and no Claude call. The context lists the caller's
//   captures and those shared by a live partner, labelled by name; a partner's switched-on
//   photo is downloaded as the caller (the tb_photos_select policy admits it).
// - 24/10/26 "Claude sees this" switch (SPEC.md 7A.4, migration 0007): at most 30 switched-on
//   photos per day (was 20); a switched-off photo is not sent, listed or mentioned.
// - 23/10/26 M1.1 Photo capture (SPEC.md 7A.4). The day's captures move from the system
//   prompt into a context block before the thread; each of the most recent 20 photos goes
//   in as an image labelled with its capture, the rest are listed as not shown, a failed
//   download is listed as could not be loaded and the call goes ahead. Cache breakpoint
//   (1 h) after the context; cache write and read tokens stored on the reply.
// - 10/10/26 First version (M2).

import Anthropic from 'npm:@anthropic-ai/sdk@0.127.0';
import { PROMPTS } from './prompt.ts';
import { buildContext, buildMessages, buildSystem, photosToSend } from './context.mjs';

const MODEL = 'claude-sonnet-5-5';
const MAX_TOKENS = 1500;          // SPEC.md 8.3 step 6, 8.6
const API_TIMEOUT_MS = 90_000;    // the client waits 120 s for the whole call
const PHOTO_TIMEOUT_MS = 15_000;  // per photo download; a slow one is listed as not loaded
const BUCKET = 'tb-photos';

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const fail = (status: number, error: string, message: string) => json(status, { error, message });

// Uint8Array -> base64, in chunks so a 300 KB photo never overflows the argument list.
function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

class RpcError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

function apiKeyForRest(req: Request): string {
  try {
    const keys = JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') || '{}');
    if (keys && keys.default) return keys.default;
  } catch (_) { /* fall through */ }
  return Deno.env.get('SUPABASE_ANON_KEY') || req.headers.get('apikey') || '';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return fail(405, 'method', 'POST only');

  const auth = req.headers.get('Authorization') || '';
  if (!/^Bearer\s+\S+/.test(auth)) return fail(401, 'auth', 'Not signed in.');

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch (_) { return fail(400, 'bad_request', 'Body must be JSON.'); }
  const { local_date, message_id, content, created_at } = body as Record<string, string>;
  if (typeof message_id !== 'string' || !UUID.test(message_id) || typeof local_date !== 'string' ||
      !YMD.test(local_date) || typeof content !== 'string' || !content.trim() ||
      typeof created_at !== 'string' || !Number.isFinite(Date.parse(created_at))) {
    return fail(400, 'bad_request', 'Need local_date, message_id, content and created_at.');
  }

  // As the caller: PostgREST checks the same JWT and the RPCs check auth.uid().
  const rest = Deno.env.get('SUPABASE_URL') + '/rest/v1/rpc/';
  const apikey = apiKeyForRest(req);
  async function rpc(name: string, p: unknown) {
    const r = await fetch(rest + name, {
      method: 'POST',
      headers: { apikey, Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p }),
    });
    const text = await r.text();
    if (!r.ok) {
      let msg = text;
      try { msg = JSON.parse(text).message || text; } catch (_) { /* keep text */ }
      throw new RpcError(r.status, `${name}: ${msg}`);
    }
    return JSON.parse(text);
  }

  try {
    // Steps 1 to 4: store the turn; a stored reply ends it here, with no API call.
    const turn = await rpc('tb_journal_turn', { message_id, local_date, content, created_at });
    if (turn.reply) return json(200, { user: turn.user, reply: turn.reply, cached: true });

    const key = Deno.env.get('TB_ANTHROPIC_API_KEY');
    if (!key) return fail(502, 'no_key', 'TB_ANTHROPIC_API_KEY is not set in the Edge Function secrets.');
    const promptKey = turn.me && turn.me.journal_prompt;
    const prompt = typeof promptKey === 'string' && Object.hasOwn(PROMPTS, promptKey) ? PROMPTS[promptKey] : null;
    if (!prompt) return fail(502, 'no_prompt', `No journal prompt "${promptKey}" in this deploy of tb-journal.`);

    // Step 4 (7A.4): the day's photos, downloaded as the caller, so Storage applies the
    // tb_photos_select policy. A failure is null: listed as "could not be loaded".
    const storage = Deno.env.get('SUPABASE_URL') + '/storage/v1/object/' + BUCKET + '/';
    const captures = turn.captures || [];
    const images = new Map<string, string | null>();
    await Promise.all(photosToSend(captures).map(async (id: string) => {
      const c = captures.find((x: { id: string }) => x.id === id);
      try {
        const r = await fetch(storage + c.photo_path, {
          headers: { apikey, Authorization: auth }, signal: AbortSignal.timeout(PHOTO_TIMEOUT_MS) });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        images.set(id, toBase64(new Uint8Array(await r.arrayBuffer())));
      } catch (e) {
        console.error('photo download failed', c.photo_path, (e as Error).message || String(e));
        images.set(id, null);
      }
    }));

    // Steps 5 and 6.
    const system = buildSystem(prompt);
    const context = buildContext(turn.user.local_date, captures, images, turn.me.display_name);
    const messages = buildMessages(turn.thread, context);
    const client = new Anthropic({ apiKey: key, timeout: API_TIMEOUT_MS, maxRetries: 1 });
    let msg;
    try {
      msg = await client.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        // Conversation, no tools: thinking off (between_tools is Sonnet 5.5's lowest
        // setting) and low effort, so the 1500-token cap goes to the reply.
        thinking: { type: 'between_tools' },
        output_config: { effort: 'low' },
        system,
        messages,
      } as unknown as Anthropic.MessageCreateParamsNonStreaming);
    } catch (e) {
      const status = (e as { status?: number }).status;
      const detail = (e as Error).message || String(e);
      console.error('anthropic error', status, detail);
      if (status === 401) {
        return fail(502, 'anthropic_auth',
          'Anthropic rejected TB_ANTHROPIC_API_KEY (401). Check the key in the travelboard workspace and the Edge Function secret.');
      }
      if (status === 403) return fail(502, 'anthropic_forbidden', `Anthropic refused the key (403): ${detail}`);
      if (status === 429 || status === 529) {
        return fail(503, 'anthropic_busy', `Claude is busy or the workspace limit is reached (${status}). Try again later.`);
      }
      if (status === 400) return fail(502, 'anthropic_request', `Anthropic rejected the request (400): ${detail}`);
      return fail(502, 'anthropic', `Could not reach Claude${status ? ` (${status})` : ''}: ${detail}`);
    }

    if (msg.stop_reason === 'refusal') {
      return fail(502, 'refusal', 'Claude declined to answer this one. Rephrase and send again.');
    }
    const text = msg.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('').trim();
    if (!text) return fail(502, 'empty', `Claude returned no text (stop reason ${msg.stop_reason}).`);
    const cacheWrite = msg.usage.cache_creation_input_tokens ?? 0;
    const cacheRead = msg.usage.cache_read_input_tokens ?? 0;
    console.log('reply', { model: msg.model, input_tokens: msg.usage.input_tokens,
      output_tokens: msg.usage.output_tokens, cache_write_tokens: cacheWrite, cache_read_tokens: cacheRead,
      photos: [...images.values()].filter(Boolean).length, stop_reason: msg.stop_reason });

    // Step 7: stored once. A concurrent retry that got there first wins; return its reply.
    const stored = await rpc('tb_journal_reply', {
      reply_to: message_id, content: text, model: msg.model,
      input_tokens: msg.usage.input_tokens, output_tokens: msg.usage.output_tokens,
      cache_write_tokens: cacheWrite, cache_read_tokens: cacheRead,
    });
    return json(200, { user: turn.user, reply: stored.reply, cached: !stored.inserted });
  } catch (e) {
    if (e instanceof RpcError) {
      console.error('rpc error', e.status, e.message);
      if (e.status === 401) return fail(401, 'auth', 'Sign in again to sync.');
      if (e.status === 400 || e.status === 403) return fail(400, 'bad_request', e.message);
      return fail(502, 'db', e.message);
    }
    console.error('tb-journal failed', e);
    return fail(502, 'internal', (e as Error).message || String(e));
  }
});
