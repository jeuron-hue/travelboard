// SOURCE OF RECORD: tb-journal, travelboard's journal Edge Function (SPEC.md 8.3).
//
// One call per user turn: POST { local_date, message_id, content, created_at } with the
// signed-in user's JWT. verify_jwt is on. The function reaches the database only as that
// user, through tb_journal_turn and tb_journal_reply (migration 0004); it holds no
// service key. The Anthropic key is the secret TB_ANTHROPIC_API_KEY (Console workspace
// travelboard) and never leaves this function.
//
// Steps: store the user turn (idempotent) -> if a reply exists, return it with no API
// call -> else build the system prompt (prompts/journal.md plus the day's captures) and
// the thread (last 40 turns) -> Claude -> store the reply once -> return it.
//
// Responses: 200 { user, reply, cached }. Errors: { error, message } with 400 bad request,
// 401 not signed in, 502 Anthropic or database failure, 503 Anthropic busy. The client
// keeps the user turn and offers Retry.
//
// Change log (newest first)
// - 10/10/26 First version (M2).

import Anthropic from 'npm:@anthropic-ai/sdk@0.127.0';
import { JOURNAL_PROMPT } from './prompt.ts';
import { buildMessages, buildSystem } from './context.mjs';

const MODEL = 'claude-sonnet-5-5';
const MAX_TOKENS = 1500;          // SPEC.md 8.3 step 6, 8.6
const API_TIMEOUT_MS = 90_000;    // the client waits 120 s for the whole call

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

    // Steps 5 and 6.
    const system = buildSystem(JOURNAL_PROMPT, turn.user.local_date, turn.captures);
    const messages = buildMessages(turn.thread);
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
    console.log('reply', { model: msg.model, input_tokens: msg.usage.input_tokens,
      output_tokens: msg.usage.output_tokens, stop_reason: msg.stop_reason });

    // Step 7: stored once. A concurrent retry that got there first wins; return its reply.
    const stored = await rpc('tb_journal_reply', {
      reply_to: message_id, content: text, model: msg.model,
      input_tokens: msg.usage.input_tokens, output_tokens: msg.usage.output_tokens,
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
