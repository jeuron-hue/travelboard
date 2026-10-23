# travelboard: tests

Manual and automated test records, newest first. Device steps run by Gary on the Pixel.
Acceptance lists are in `SPEC.md`; this file holds how each item is tested and the dated result.

---

## M1.1 Photo capture (SPEC.md 7A)

**Status 24/10/26: move passed; 0005 and 0006 applied to `travelboard` and `checks/smoke.sql` passes 71 of 71. `tb-journal` v2 and client v7 next. Cut-off on the Pixel 27/10/26.**

| Applied, 24/10/26 | Result | Evidence |
|---|---|---|
| Migration 0005 | Applied, file unchanged | Supabase migration `tb_0005_photo_fields`. Snapshot before = after 0004 (REST 517, `8726dc225828`). Diff: `travel.captures` and `travel.journal_messages` gain their columns, 4 new photo constraints, new bodies for `tb_capture_upsert`, `tb_journal_turn`, `tb_journal_reply` (ACL still `postgres, authenticated`). REST unchanged; rows intact (34 captures, 14 messages). |
| Migration 0006 | Applied, file unchanged | `tb_0006_tb_photos_bucket`. Diff: bucket `tb-photos` (private, 2097152, `{image/jpeg}`) and `tb_photos_select`, `_insert`, `_update` (authenticated, own folder). REST unchanged, the 36 `travel` and `public` objects unchanged. |
| `tb-journal` v2 | Deployed, version 2, `verify_jwt` on | Same `index.ts`, `context.mjs`, `prompt.ts` as the repo (`fn.test.cjs` 35 of 35). Works with the v6 client too: same request; a day with no photos sends no images. |
| `checks/smoke.sql` | PASS, 71 of 71 | 53 earlier tests plus P1 to P10 (photo fields, `photo_path` rule, Remove, `tb_journal_turn` and `tb_journal_reply`, bucket, policies, own-folder read and write, second synthetic uid, anon, no delete). One transaction, rolled back. |

### Automated results, 24/10/26 (before applying)

| Check | Result | Evidence |
|---|---|---|
| Migrations 0005, 0006 | Written, not applied | 0005: four photo columns on `travel.captures`, two cache columns on `travel.journal_messages`; `tb_capture_upsert` carries the photo fields and accepts only the caller's own `<uid>/<id>.jpg`; `tb_journal_turn` returns `photo_path` per capture; `tb_journal_reply` stores the cache counts. `tb_captures_since` unchanged (returns whole rows). 0006: bucket `tb-photos` (private, 2 MB, `image/jpeg`) and `tb_photos_select`, `_insert`, `_update` on `storage.objects` for `authenticated`, own folder only, no delete. |
| `checks/smoke.sql` | Written, runs after applying | P1 to P10: photo fields round-trip, wrong `photo_path` rejected, Remove clears the fields, `photo_path` reaches `tb_journal_turn`, cache counts stored, bucket settings, the three policies, own-folder read and write for Gary, a second synthetic uid cannot read Gary's folder, anon reads and writes nothing, no delete. |
| `checks/static.cjs` | PASS, 74 of 74 | Adds: bucket, 1280 px and JPEG 0.82 in the client, IndexedDB v3, no file deletes, 20 photos and a 1 h cache in `tb-journal`, the shape of 0006. |
| `checks/headless/fn.test.cjs` | PASS, 35 of 35 | Deno 2.9.4. System prompt is `prompts/journal.md` alone; the day and its captures move to a context block before the thread. F13: 22 photos on a day, the most recent 20 fetched as the user, 19 images (one file missing), each after a label with its capture's time, kind and text, the 2 oldest listed "not shown", the missing one "could not be loaded", the call still made, one 1 h cache breakpoint after the last image. F14: the second turn sends the same context byte for byte and stores `cache_read_tokens` above zero. F4 and F6: cache counts stored on replies. `deno check` clean. |
| `checks/headless/m11.test.cjs` (new) | PASS, 41 of 41 (three runs) | Below. |
| `checks/headless/m1.test.cjs`, `m2.test.cjs` on v7 | PASS, 103 of 103 and 80 of 80 | K0 and K12 now expect IndexedDB v3. |

Headless M1.1 groups (`m11.test.cjs`, Storage mock with the own-folder rule, 2 MB and JPEG limits):
- Capture screen: Photo is a file input taking images (the Android chooser offers camera and gallery), no `capture` attribute.
- Acceptance 1: in airplane mode a 4000 x 3000 photo becomes a 1280 x 960 JPEG under 500 KB, saves at once with its thumbnail and a queued chip, pill "offline, 2 queued" (capture and photo); on reconnect the file lands at `tb-photos/<uid>/<id>.jpg` (1280 px long edge, read from the JPEG header) and the row's first push already carries `photo_path` and the size fields.
- Acceptance 2: a 1500 x 2000 PNG from the gallery becomes a 960 x 1280 JPEG and syncs the same way; an 800 x 600 photo keeps its size.
- Acceptance 3: a photo with no text saves and syncs; the row reads "(photo)".
- Acceptance 4: a reload after attaching, before Save, reopens the capture screen with the text and the photo; Close keeps the draft with its photo ("draft kept"), also with no text.
- Acceptance 5: Storage refusing the upload: text and GPS on the server without `photo_path`, the photo queued, the error in settings; the next sync uploads it. A network drop mid-upload: text pushed, pill offline, photo follows. Queued photos go one at a time, smallest first.
- Edit: full preview; Replace uploads to the same path and updates the sizes; Remove clears the four fields, the file stays in Storage, no delete call.
- Export carries the four photo fields, no image data. The journal composer has no Photo button.
- A second phone (reinstall) downloads every photo once, keeps them, shows thumbnails, and does not download again.

### Device steps (Pixel, Chrome), v7: SPEC.md 7A.6

To be run once v7 is live (Claude confirms `const CACHE_VERSION = 7;`). Report the step number and what you saw for any step that does not match.

1. **Update.** Open `https://jeuron-hue.github.io/travelboard/sw.js`: it should read `const CACHE_VERSION = 7;`. Update the app as before; Version v7. Nothing else changes on screen until you open Capture.
2. **Camera photo offline (item 1).** Turn airplane mode on and check the pill reads "offline". Tap Capture. Next to note/journal there is now a Photo button. Tap it: Android offers Camera and your gallery apps. Choose Camera and photograph something with visible detail the text will not mention (a sign, a menu, a shelf). Back in travelboard the photo shows above the text, with its size (about 1280 x 960) and Remove. Type `Photo test 1`, Save. The row shows a small thumbnail and a yellow "queued" chip; the pill counts the capture and the photo. Turn airplane mode off; within about 35 s everything reads "synced". Note the time. Claude checks the file in `tb-photos` (at most 1280 px, under 500 KB) and the row's photo fields.
3. **Gallery photo (item 2).** Capture, Photo, pick an existing photo from Google Photos or Files, type `Photo test 2`, Save. It syncs the same way.
4. **Photo only (item 3).** Capture, Photo, take a photo, and Save with no text. The row reads "(photo)" and syncs.
5. **Force-close with a photo (item 4).** Capture, Photo, take a photo, type `Photo draft`, and do not Save. Swipe travelboard away from recents. Reopen it: the capture screen comes back with the text and the photo. Save. If Android closes travelboard while the camera is open and the photo is lost on return, report it: that is the phone reclaiming memory, and the step is then repeated.
6. **Edit.** Tap the `Photo test 2` row: the full photo shows. Tap Replace, pick another photo, Save. Then open `Photo test 1`, tap Remove, Save: its thumbnail goes, the text stays.
7. **Claude sees the photo (item 6).** With signal, in Journal, Write: `What is in the first photo I took today?` Claude should describe something visible in it that the capture text does not say. Report what it said.
8. **Cache (item 7).** Within the hour, send one more journal message the same evening. Claude checks `cache_read_tokens` is above zero on that reply.
9. **Failed upload (item 5)** is covered headless; on the Pixel, note it if a photo ever stays "queued" after its text synced, and whether it caught up later.

Item 8 (anonymous and other-user access refused) is checked by Claude: the smoke tests, and an anonymous REST request for one of your photo paths from outside this sandbox.

---

## Move to own project (SPEC.md 6.8)

**Status 23/10/26: steps 2 to 6 done; step 8 PASSES (Pixel and keep-alive, 2347 hrs). The move is done. Step 7 (weatherboard clean-up) waits on Gary's yes.**

### Automated results, 23/10/26

Project `travelboard` (`nnnnonspfljdkrxstslw`). Catalogue snapshots used `checks/catalogue.sql` in compact form: one hash over every object outside `travel`, `public.*`, policies and buckets ("REST"), plus each of those listed by name.

| Check | Result | Evidence |
|---|---|---|
| Baseline before 0001 | Recorded | REST 511 objects, hash `d645cb03eb64`. In `public`: only Supabase's `rls_auto_enable()` (the "automatic RLS" setting). No `travel`, no buckets, no pg_cron. One auth user, `gary@travelboard.local`, confirmed. |
| Migration 0001 | Applied, file unchanged | Supabase migration `tb_0001_travel_schema_captures`. New: schema `travel` (ACL owner only), `travel.captures` (RLS on, ACL null, no policies), 3 indexes, 4 constraints. REST went 511 to 517: the 6 extra are Supabase's own migration history (`supabase_migrations` schema, `schema_migrations` table, 2 indexes, 2 constraints) created by the first applied migration. Nothing else. |
| Migration 0002 | Applied, file unchanged | `tb_0002_rpcs`. New: the 4 `public.tb_*` functions, each definer, `search_path=travel, public`, ACL `postgres, authenticated` only. REST unchanged (517, `8726dc225828`). |
| Migration 0003 | Applied, file unchanged | `tb_0003_journal_tables`. New: 13 objects in `travel` (2 tables RLS on, no grants; 4 indexes; 7 constraints). REST unchanged. |
| Migration 0004 | Applied, file unchanged | `tb_0004_journal_rpcs`. New: 5 `public.tb_journal_*` functions, same guardrails. REST unchanged; 0001 to 0003 objects unchanged. |
| Same schema as weatherboard | PASS | md5 of all 9 function bodies and of all 3 table definitions (columns, types, not null, defaults) equal in both projects (weatherboard read only). |
| `checks/smoke.sql` | PASS, 53 of 53 | Run in `travelboard`, one transaction, rolled back. |
| Data copy (step 3) | PASS | Read from weatherboard (read only): 33 captures (1 soft-deleted), 12 journal messages, 1 day title. Inserted in one transaction with `owner` set to the new uid `40d3790a-...` and `server_ts` fresh; the transaction checked its own digests and would have rolled back on a mismatch. id-by-id digest over every column except `owner` and `server_ts`, identical in both projects: captures `23eb76cc...`, messages `75d3ae01...`, days `7321bcc8...`. One owner. Rows are not in this repo (it is public). |
| `tb-journal` (step 4) | Deployed, version 1, `verify_jwt` on | Same source as the repo. The test call is device step 5. |
| Keep-alive (step 5) | Built, not yet run | `.github/workflows/keepalive.yml`, daily 0243 UTC. Passes only on Postgres's own 42501 to an anonymous `rpc/tb_whoami` (rule 3 leaves nothing anon can read). This sandbox cannot reach supabase.co, so the first GitHub run is the live test (device step 6). |
| Client v6 (step 6) | Built | `trip.html` and `sw.js` version 6, URL and publishable key of `travelboard` (key from the connector). |
| Deploy v6 | PASS | `main` fast-forwarded to `95c9d20` on Gary's yes. Live `sw.js` reads `const CACHE_VERSION = 6;` (Last-Modified 23/10/26 2324 hrs SGT), fetched through Apify. |
| `checks/static.cjs` | PASS, 69 of 69 | Adds: keep-alive pings the project and key `trip.html` uses, daily, no secrets; `.yml` files scanned for keys. |
| `checks/headless/m1.test.cjs` on v6 | PASS, 103 of 103 | Run with `TB_CHROMIUM=/opt/pw-browsers/chromium`. |
| `checks/headless/m2.test.cjs` on v6 | PASS, 80 of 80 | New group L, the move: a v5 phone (synced, session stored, cursor set) opens v6: session and cursor cleared, `project_ref` recorded, nothing deleted, every capture dirty, the sent turn pending, a failed turn left failed, the day title re-queued, nothing sent and pill "sign in, 3 queued". After sign in: both captures on the server (the soft-deleted one still deleted), the turn resent once with the stored reply back and no Claude call, still one reply with the same id, the title on the server, pill synced. Next launch: no second reset. K12 updated: a pre-move database now asks to sign in, then syncs. |
| Security advisor | No new issue | Flags RLS with no policies on the 3 `travel` tables and definer functions callable by `authenticated`: both by design (rule 3). Flags `public.rls_auto_enable()` as callable by anon: it is Supabase's own and returns `event_trigger`, so it cannot be called over REST; left alone (rule 1). Leaked password protection off: irrelevant with self-signup off and one synthetic login. |

### Device steps (Pixel, Chrome), v6: SPEC.md 6.8 step 8

Report back the step number and what you saw for any step that does not match. Claude checks the server side in project `travelboard`.

1. **Update.** Open `https://jeuron-hue.github.io/travelboard/sw.js` in Chrome: it should read `const CACHE_VERSION = 6;` (if it still shows 5, wait a few minutes and reload). Open travelboard from the home-screen icon, tap "Update ready, tap to reload" when it shows (or swipe the app away and reopen). Tap the pill: Version v6. The pill should read "sign in, n queued", with n about 35 or more: every capture on the phone plus your sent journal turns, queued again for the new project. Every capture row shows a yellow "queued" chip. Nothing is missing.
2. **Sign in to the new project.** With signal, in the same panel, sign in as `gary@travelboard.local` with the new password you set on 23/10/26 (not the old weatherboard one). The pill should turn green "synced" within about 35 s, and every chip "synced". Note the time.
3. **Everything from before the move.** On Captures, step back through 04/10, 09/10, 10/10 and 23/10: the same captures as before, Ap03 still gone. On Journal, open Days: 10/10 shows "Singapore test" with its messages, and 23/10 its three turns with replies, none marked "not sent" (any that were "not sent" before stay that way). Claude checks every one of the 33 copied captures and anything you made on v5 after the copy is on the server, each once.
4. **A new capture.** Turn airplane mode on and check the pill reads "offline". Capture `v6 move test`. Turn airplane mode off; within about 35 s it should read "synced". Note the time.
5. **A journal reply (step 4 test call).** With signal, Journal, Write `Move check. Reply in one sentence.`, Send. A reply should come within about 15 s. If it shows "not sent" instead, send Claude the exact message: "(401)" means Anthropic rejected the key in `TB_ANTHROPIC_API_KEY`; "TB_ANTHROPIC_API_KEY is not set" means the secret is missing in project `travelboard`.
6. **Keep-alive.** On github.com, `jeuron-hue/travelboard`, Actions, "keep-alive", Run workflow on `main` (Claude can start it instead once it is on `main`). The run should go green within a minute, and the log shows `HTTP 401` and code `42501`. A red run, or anything else in the log, report it.

When all six pass, Claude records step 8 here and asks for your yes on step 7.

### Device results, v6 (Pixel, Gary), 23/10/26

Checked in project `travelboard` through the Supabase connector, the function logs and the GitHub API. Times SGT.

| Step | Result |
|---|---|
| 1 | PASS. v6 running; before sign-in the pill read "sign in, 39 queued" (33 captures plus the 6 sent journal turns), every chip "queued" (Gary's screenshot 2338 hrs). |
| 2 | PASS. Signed in as `gary@travelboard.local` on the new project; "synced", last sync 2341 hrs, no error (screenshot). |
| 3 | PASS. Screenshots of 04/10, 09/10 (0031 hrs Bangkok), 10/10 and 23/10 show the same captures as before. Server: 33 copied captures, digest still `23eb76cc...` (the re-push changed nothing, as their `updated_at` was equal); 14 journal rows, no turn with two replies. The 6 re-queued turns went through `tb-journal` at 2340:46 to 2340:51, all 200, none with a Claude call (stored replies returned). |
| 4 | PASS. New capture "Test" captured 2343:23 with GPS, landed 2343:39. |
| 5 | PASS. "Move check. Reply in one sentence." at 2344:14, one reply at 2344:18 from `claude-sonnet-5-5` (2576 in, 56 out): the new `TB_ANTHROPIC_API_KEY` works. |
| 6 | PASS. GitHub returned 403 to a workflow dispatch from this session, so the workflow now also runs when its own file changes on `main` (`c7d6a32`; the stamp commit is pushed with `GITHUB_TOKEN` and starts no run). Run 1 (`39981679816`, 2350 hrs): `HTTP 401`, `{"code":"42501",...,"message":"permission denied for function tb_whoami"}`, green; stamp commit `25b3f72`. Daily runs at 0243 UTC from 24/10. |

## M2 Journal (SPEC.md 8.7)

**Status 23/10/26: all five acceptance items PASS. `checks/static.cjs` and `checks/smoke.sql` pass. M2 done.** v5 adds Share on the journal bar (device step 8).

### Automated results, 10/10/26

| Check | Result | Evidence |
|---|---|---|
| Migration 0003 (`travel.journal_messages`, `travel.journal_days`) | Applied | Supabase migration `tb_0003_journal_tables`. Catalogue diff: 13 new objects, all in `travel` (2 tables with RLS on and no grants, 4 indexes including `journal_one_reply`, 7 constraints). Nothing else added, removed or changed. |
| Migration 0004 (journal RPCs) | Applied | Supabase migration `tb_0004_journal_rpcs`. Catalogue diff: 5 new functions, all `public.tb_journal_*`. Nothing else changed. |
| `checks/smoke.sql` | PASS, 53 of 53 | 24 M0 tests plus J1 to J12: anon denied on all 5 journal functions; no direct table reads; definer, `search_path` and grants on all 5; a new turn returns the thread and only live captures; a retried turn leaves one unchanged row; a reply is stored once and a second returns the first; a retried turn with a reply returns it with no context; thread order (a turn sent late sorts by its own time; each reply right after its turn); day list and trimmed suffix; validation; a reply cannot answer a reply; token sum by day. One transaction, rolled back. |
| `checks/static.cjs` | PASS, 64 of 64 | Adds: no Anthropic key anywhere in the repo; `prompt.ts` current with `prompts/journal.md` (fails when stale, checked); key read only from `TB_ANTHROPIC_API_KEY`; no service key in the function; model `claude-sonnet-5-5`, `max_tokens` 1500, 40-turn cap. `CACHE_VERSION` 4 equals `APP_VERSION` 4. |
| `checks/headless/fn.test.cjs` | PASS, 25 of 25 | The real `index.ts` under Deno 2.9.4 against local fakes of PostgREST and the Anthropic API. Request to Claude: model `claude-sonnet-5-5`, `max_tokens` 1500, thinking `between_tools`, effort low, key from `TB_ANTHROPIC_API_KEY`; system prompt is `prompts/journal.md` then the day and its live captures with local times and coordinates, deleted captures and other days left out. Retry of an answered turn: stored reply, no second API call. Anthropic 401 gives `anthropic_auth` with a message naming the secret, the turn kept and no reply stored. Refusal, missing secret, bad JWT, bad body. Two failed turns join into one user message when the next goes through. A 51-message thread is capped to 40. Also `deno check` clean. |
| `checks/headless/m2.test.cjs` | PASS, 62 of 62 | Below. |
| `checks/headless/m1.test.cjs` on v4 | PASS, 103 of 103 | M1 capture unchanged by M2. |
| v5 Share, 23/10/26 | PASS | `m2.test.cjs` K15: the share sheet gets the day's title, both captures with times and kinds, and the conversation in thread order; with no share sheet the same text goes to the clipboard with a toast; Share hidden on the day list. `m2.test.cjs` 67 of 67 (five runs; one test race in K8 fixed by waiting for the outcome), `m1.test.cjs` 103 of 103, `static.cjs` 64 of 64. No server or function change. Deployed: `main` at `6f42871`, live `sw.js` reads `const CACHE_VERSION = 5;` (Last-Modified 23/10/26 2207 hrs SGT). |
| Deploy | PASS | `main` at `8cb1891`. Live `sw.js` reads `const CACHE_VERSION = 4;` (Last-Modified 10/10/26 1557 hrs SGT), fetched through Apify because this sandbox cannot reach github.io. |
| `tb-journal` deployed | Version 1, `verify_jwt` on | Deployed source read back and matches the repo. Not yet called with a real key: device step 2 is the key check. |

Headless M2 groups (`m2.test.cjs`, phone in Asia/Bangkok on a fake clock unless noted):
- Shell: v4; IndexedDB version 2 with `journal` and `jdays`; opens on Captures; Journal tab swaps the day bar for the journal bar, title "Mon 09/11/26", bottom button reads Write.
- Composer and drafts: focused, Send, no kind toggle; draft `journal:2026-11-09` written on input; a reload mid-typing reopens it on the Journal tab; Close keeps it ("draft kept" on Write, not on Capture); Android back closes it.
- Send (acceptance 1 shape): one call with `local_date`, `message_id`, `content`, `created_at`; the reply stored once, linked by `reply_to`; Claude saw both of the day's captures because captures are pushed first; the journal capture shows inline as a quote before the turn; second turn sends user, assistant, user.
- Airplane mode (acceptance 2): the turn saves as pending, pill "offline, 1 queued", nothing sent; on reconnect it goes once and gets exactly one reply.
- Lost response (acceptance 3): the function stored a reply but the phone never heard; the next sync resends and gets the stored reply with no second Claude call.
- Errors: a function error shows "not sent", the server's message and Retry; not counted as queued; never resent automatically; Retry works. With two queued turns the first failing stops the pass; after Retry both go in order and Claude sees turn one and its reply before turn two.
- Days and titles: day list newest first with message and capture counts; a captures-only day opens with a hint naming its capture; the title suffix shows, reaches the server and clears its dirty flag; Cancel changes nothing; Write on an older day writes into that day; Today returns.
- 0400 rule: at 0130 the journal's today is still the previous day and a turn belongs to it; at 0430 it rolls.
- Second device in Asia/Singapore: pulls every row, replied turns as sent, a server turn with no reply as "not sent" with Retry, the suffix, and the same order as the server; unchanged days are not fetched again; Retry on the orphan gets a reply, which the first phone then pulls.
- IndexedDB upgrade from an M1 v1 database keeps the capture, the draft and meta; the queued M1 capture still syncs.
- No session: a turn saves as pending, pill "sign in, 1 queued". A 401 from the function leaves the turn pending and the pill asks to sign in.

Run from the repo root after `npm install` in `checks/headless/` and `npx playwright install chromium`: `node checks/headless/m1.test.cjs`, `node checks/headless/m2.test.cjs`, and with Deno on PATH (or `DENO=/path/to/deno`) `node checks/headless/fn.test.cjs`.

Model settings: thinking is off (`between_tools`, Sonnet 5.5's lowest setting) and effort is low, so the 1500-token cap goes to the reply and replies stay conversational. Server-side refusal fallback is not enabled: it only retries cyber and frontier-AI declines, which a travel journal will not trigger, and it needs a beta header. A refusal shows as "not sent" with Retry.

### Acceptance status

| # | Item | Status |
|---|---|---|
| 1 | One real evening conversation in which Claude refers to at least two of that day's captures by content | PASS 23/10/26 (Pixel step 7, Gary agreed to close on it): in the 2200 hrs reply Claude named both of the day's captures by content |
| 2 | A message sent in airplane mode queues, sends on reconnect, and produces exactly one reply | PASS 10/10/26 (Pixel step 3) |
| 3 | Retrying a message that already has a reply returns the stored reply without a second API call (token rows) | PASS 10/10/26 (Pixel step 4: two function calls, one Claude call, one reply row) |
| 4 | The Anthropic key appears nowhere in the repo or client | PASS 10/10/26. `static.cjs` scans every file for `sk-ant-` keys; the key is read only from `TB_ANTHROPIC_API_KEY` inside the function, and no response carries it. |
| 5 | Spend limit set on the `travelboard` workspace (USD 30, auto-reload off), and the key in `TB_ANTHROPIC_API_KEY` belongs to it | PASS 10/10/26 (Gary, Console: limit USD 30, auto-reload off, email at USD 20; key created in that workspace and set as the secret). Device step 2 confirms the key works. |

### Device steps (Pixel, Chrome), v4

Report back the step number and what you saw for any step that does not match. Claude checks the server side through the Supabase connector.

1. **Update.** Open `https://jeuron-hue.github.io/travelboard/sw.js` in Chrome: it should read `const CACHE_VERSION = 4;`. Open travelboard from the home-screen icon. Tap "Update ready, tap to reload" when it appears (or swipe the app away and reopen). Tap the status pill: Version v4. Close. The header now has two tabs, Captures and Journal. On Captures, step back a day or two: your M1 captures should all still be there.
2. **First call, the key check.** Make sure you have signal. Tap Journal. The bar reads today's date, the bottom button reads Write. Tap Write, type `Key check. Reply in one sentence.`, tap Send. Your message appears with "sending" and "Claude is replying" below it; a reply should follow within about 15 s. If instead it shows "not sent" with a message, stop and send Claude the exact message. A message containing "(401)" means Anthropic rejected the key.
3. **Airplane mode (item 2).** Turn airplane mode on and check the pill reads "offline". In Journal, Write `Airplane test`, Send. It shows "queued" and the pill reads "offline, 1 queued". Turn airplane mode off. Within about 35 s it should change to a reply, with no tap from you. Note the time.
4. **Lost reply (item 3).** With signal, Write `Retry test, reply in one sentence`, Send, and as soon as "Claude is replying" shows, turn airplane mode on. Wait 30 s, then turn airplane mode off. The reply should appear once. Note the time. Claude checks: one stored reply for that message and one set of token counts, though the function ran twice.
5. **Day title.** Tap the date in the journal bar, type `Singapore test`, Save. The bar reads "Sat 10/10/26 Singapore test" (with that day's date). Tap Days: the list shows today with its message and capture counts. Tap another day that has captures: its thread opens, showing any journal captures as quotes, or a hint naming how many captures it has. Tap Days, then Today.
6. **Capture still works.** Tap Captures, make a capture `M2 regression` in airplane mode, turn airplane mode off, and check it syncs as in M1.
7. **A real evening (item 1).** On a normal day, make at least three captures as you go (one switched to journal). In the evening, open Journal and have a real conversation of a few turns, by voice or typing. Claude's replies should pick up at least two of the day's captures by what they say, without being asked. Tell Claude the date; Claude reads the thread and checks which captures it used. Use the Retry button if anything shows "not sent", and report it.
8. **Share (v5).** Open `https://jeuron-hue.github.io/travelboard/sw.js`: it should read `const CACHE_VERSION = 5;`. Update the app as in step 1; Version v5. In Journal, open a day with messages and tap Share at the right of the journal bar. The Android share sheet opens: pick Claude (or Copy). The text starts "travelboard journal" with the day, lists every capture of the day with its time, then the conversation. Paste it into your desktop journalling project and check it reads well there.

Notes for the device run:
- Journalling works online only; a turn written offline waits as "queued" and goes on reconnect. Captures stay offline-first as before.
- Cost: each reply is one Sonnet 5.5 call capped at 1500 output tokens. Token counts per reply are in `travel.journal_messages`; Claude can total them for any period.

### Device results, v4 (Pixel, Gary), 10/10/26

Checked against `travel.journal_messages`, `travel.journal_days` and the Edge Function logs through the Supabase connector. Times SGT.

| Step | Result |
|---|---|
| 1 | PASS. v4 running; M1 captures kept through the IndexedDB upgrade. |
| 2 | PASS. Key check: turn stored 1611:37, reply 1611:40 from `claude-sonnet-5-5` (2101 input, 127 output tokens). The key in `TB_ANTHROPIC_API_KEY` works; no 401. |
| 3 | PASS. "Airplane test" written 1613:49 in airplane mode, landed 1614:07 on reconnect, one reply 1614:11 (2237 in, 208 out). |
| 4 | PASS. "Retry test" sent 1615:33. Wi-Fi came back during the step (Gary). Function log: POST at 1615:36 with the Claude call (2462 in, 38 out), then a second POST at 1615:43 with no Claude call (the stored reply returned). One reply row for that turn. |
| 5 | PASS. Suffix "Singapore test" on 2026-10-10 reached the server 1619:06. Day list and other days checked by Gary. |
| 6 | PASS. Capture in airplane mode synced as in M1 (Gary). |
| 7 | PASS 23/10/26. Thread for 2026-10-23: captures at 2153 ("Tt") and 2158 (a note that pictures cannot be attached). Three turns, at 2153 and 2200 hrs, each with one reply. The 2200 reply named both captures by content without being asked. A test evening rather than a full real one; Gary agreed to close M2 on it, as real journalling gets used in the shakedown. Findings: no way to attach pictures (Photos is in SPEC 9, later); Gary wants a day out of travelboard into his desktop Claude journalling project, hence Share in v5. |
| 8 | PASS 23/10/26. Share from the 23/10/26 thread went through the Android share sheet into the Claude app's Daily Journaling project at 2212 hrs: title, the local-day line, both captures with time, kind and coordinates, then the conversation (Gary's screenshot). Gary kept Share on the Journal tab only. |

---

## M1 Capture (SPEC.md 7.3)

**Status 10/10/26: all nine acceptance items PASS on the Pixel. `checks/static.cjs` and `checks/smoke.sql` pass. M1 done.** Device results and findings are at the end of this section.

### Automated results, 04/10/26

| Check | Result | Evidence |
|---|---|---|
| Deploy | PASS | `main` at `254ccde`. Live `sw.js` reads `const CACHE_VERSION = 3;` (Last-Modified 04/10/26 2041 hrs SGT), fetched through Apify because this sandbox's egress policy blocks github.io. |
| Migration needed? | No | Live `tb_capture_upsert` checked against 7.2: updates only when the stored `updated_at` is strictly older, copies every field including `deleted_at` (so Undo back to null propagates), and `tb_captures_since` returns soft-deleted rows. Edit, soft delete, Undo and GPS updates need no server change. No catalogue diff, as nothing was applied. |
| `checks/static.cjs` | PASS, 53 of 53 | `node checks/static.cjs`. Includes `CACHE_VERSION` 3 equal to `APP_VERSION` 3. |
| `checks/smoke.sql` | PASS, 24 of 24 | Run through the Supabase connector, rolled back. |
| Headless Chromium against the RPC mock | PASS, 103 of 103 (two consecutive runs; rerun 10/10/26 from `checks/headless/`, 103 of 103) | Mock mirrors migration 0002 (strict last-write-wins, microsecond `server_ts` shared per batch, keyset pull). Phone zone set to Asia/Bangkok, clock frozen with Playwright's fake clock. Groups below. |

Headless groups. Committed 10/10/26 as `checks/headless/m1.test.cjs` with `harness.cjs`. Run from the repo root with `node checks/headless/m1.test.cjs` after `npm install` in `checks/headless/` and `npx playwright install chromium`.
- Shell: M0 button and hint gone; viewport has `interactive-widget=resizes-content`; v3; empty today reads "Nothing captured today yet."; "draft kept", toast and capture layer hidden when they should be; signed-in settings hide the sign-in form.
- Capture screen and drafts: opens focused; history entry pushed; Save disabled for empty and whitespace-only bodies; every input writes the `new` draft with `open` true; a reload mid-typing reopens it; Close keeps it with `open` false and the button reads "draft kept"; a closed draft does not auto-reopen; Capture restores it; Android back (`history.back()`) closes the screen and stays in the app.
- 0400 rule, fake clock in Asia/Bangkok: capture at 0030 gets `local_date` 2026-10-03 and the home label reads "Sat 03/10/26"; at 0330 (0430 in Singapore) still 2026-10-03, so the rule uses Bangkok time; at 0400 it gets 2026-10-04 and the label rolls to "Sun 04/10/26". Boundary checks: 0359 and 0400, month end, year end, end of February.
- Date switcher: back arrow skips to the day with captures (0330 above 0030, newest first), back disabled at the earliest day, forward returns to today, tapping the label returns to today.
- Rows: "0030 hrs" with no city when the zone matches the phone; with the phone in Asia/Singapore a pulled Bangkok row reads "0030 hrs Bangkok" on Sat 03/10/26 and a Singapore row has no suffix; kind chip, GPS dot, sync chip; line two is the first line of the body.
- Airplane mode (acceptance 1): 20 captures, mixed note and journal, bodies with Thai script, quotes, backslashes and newlines, some before 0400. The pill reads "offline, 23 queued", nothing reaches the server; on reconnect all 20 arrive intact with the right kind and `local_date`, pill "synced".
- Edit (acceptance 3): body and kind change, `updated_at` bumped, `captured_at`, `tz` and `local_date` unchanged, propagates after sync. Offline edit wins over the older server copy. A newer server edit and a server-side delete come down through the pull; an older server copy does not overwrite the local row.
- Strictly increasing `updated_at`: on a frozen clock two edits give +1 ms each and the server applies both; with the clock moved back an hour the next value is still previous + 1 ms.
- Delete (acceptance 4): row hidden, Undo toast, row kept locally with `deleted_at` = `updated_at`; server gets `deleted_at`; Undo restores it locally and the server's `deleted_at` returns to null; without Undo the toast goes after 5 s and the delete stands.
- Edit drafts: a reload mid-edit reopens the edit screen with the typed text; Close discards the edit draft and leaves the row unchanged.
- GPS: requested once per new capture with `enableHighAccuracy` true, `timeout` 5000, `maximumAge` 60000. Denied (acceptance 5): null coordinates, no error. A fix that arrives after an edit keeps the edit and adds coordinates; both reach the server; the row shows the GPS dot.
- Share target (acceptance 7, simulated): `title` "Jay Fai", `text` "Jay Fai + link", `url` link gives "Jay Fai" and the link once each; the URL is cleaned; the draft is written at once; a second share appends to the kept draft; a draft plus share over 20000 characters is cut to 20000 (the server limit).
- `?new=1` (acceptance 8, simulated): opens straight into capture, focused, URL cleaned; back stays in the app.
- Export offline (acceptance 9): filename `travelboard-captures-061026-0907.json` at 0907 on 06/10/26 Bangkok device time; holds every IndexedDB row, the deleted one flagged; `synced` and `server_ts` on every row.
- Service worker: cache `tb-shell-v3` with 10 files; offline reload renders v3; offline capture with no session saves and queues; `?new=1` opens capture offline.

Found and fixed during the build: `.primary small { display: block }` overrode the `hidden` attribute, so "draft kept" always showed. The M0 sign-in form had the same fault (`form.signin { display: grid }`), so it showed even when signed in. A global `[hidden] { display: none !important; }` fixes both. The headless checks now test computed visibility, not the attribute.

### Acceptance status

| # | Item | Status |
|---|---|---|
| 1 | 20 airplane-mode captures, mixed, all arrive intact with correct `local_date` | PASS 10/10/26 (Pixel step 4; 19 made in airplane mode, AP06 with signal) |
| 2 | Force-closed mid-typing: draft restored on reopen | PASS 10/10/26 (Pixel step 3) |
| 3 | Edit after sync propagates; offline edit wins over the older server copy | PASS 10/10/26 (Pixel step 6; offline edit is AP04) |
| 4 | Delete hides locally, sets `deleted_at` on the server; Undo within 5 s restores | PASS 10/10/26 (Pixel step 7; AP03 deleted, AP05 undone) |
| 5 | Location denied: saves with null coordinates and no error | PASS 04/10/26 (Pixel step 2) |
| 6 | Asia/Bangkok: 0030 gets the previous Bangkok date and shows "0030 hrs" with "Bangkok"; 0400 or later gets the same day | PASS 10/10/26 (Pixel step 9) |
| 7 | Share a Google Maps link into travelboard: prefilled capture opens | PASS 10/10/26 (Pixel step 8) |
| 8 | Home-screen shortcut opens straight into capture | PASS 10/10/26 (Pixel step 5; keyboard needs one tap, see findings) |
| 9 | Export produces a valid JSON file offline containing every capture | PASS 10/10/26 (Pixel step 10; file matches the server row for row) |

### Device steps (Pixel, Chrome), v3

Report back the step number and what you saw for any step that does not match. Note the times asked for; Claude checks them in `travel.captures`.

1. **Update.** Open `https://jeuron-hue.github.io/travelboard/sw.js` in Chrome: it should read `const CACHE_VERSION = 3;` (if it still shows 2, wait a few minutes and reload). Then open travelboard from the home-screen icon. If an "Update ready, tap to reload" bar appears, tap it; if not, swipe the app away and reopen. Tap the status pill: Version should read v3. Report whether you saw the bar. Close settings. The home screen should show today's date ("Sun 04/10/26" style) between two arrows, and an orange Capture button. The "Add test record" button is gone. Tap the left arrow: your M0 test records should be on their day.
2. **Location denied (item 5).** Tap Capture. The keyboard should come up with the cursor in the text area. Type `loc test denied`, tap Save. When Chrome asks for location, choose "Don't allow". The row appears with a yellow "queued" or green "synced" chip, no green GPS dot, and no error. Then allow location: Chrome, three dots, Settings, Site settings, Location, `jeuron-hue.github.io`, Allow. In travelboard, capture `loc test allowed`; within about 5 s the row should show a small green GPS dot. Tap the row: the bottom bar should read "Captured dd/mm/yy hhmm hrs, GPS n m". Close.
3. **Draft survives a force-close (item 2).** Tap Capture, type `draft test` and do not save. Swipe travelboard away from recents. Reopen it from the icon: the capture screen should reopen with `draft test`. Tap Close: the home screen's Capture button should now read "draft kept" under it. Swipe the app away and reopen: it should open on the home screen, not the capture screen. Tap Capture: `draft test` is there. Change it to `draft test saved` and Save; "draft kept" disappears.
4. **20 airplane-mode captures (item 1).** Turn airplane mode on (Wi-Fi off). Make 20 captures named `AP01` to `AP20`, each with a few words of your own; switch every third one (AP03, AP06 and so on) to journal before saving. Use Gboard voice for at least two. The pill should end at "offline, 20 queued" (more if anything else is queued). Turn airplane mode off. Within about 35 s the pill should read "synced" and every chip "synced". Tell Claude the time you made AP01 and AP20.
5. **Home-screen shortcut (item 8).** Swipe the app away. Long-press the travelboard icon and tap "New capture". It should open straight into the capture screen. Report whether the keyboard came up on its own or needed a tap in the text area (with no tap, Android may not raise it; that is what this step checks). Type `shortcut test`, Save. Then open Capture again and press Android back: it should close the capture screen and stay in travelboard; a second back leaves the app.
6. **Edit (item 3).** With signal, tap AP01, change the text to `AP01 edited online`, switch it to journal, Save. The chip goes yellow then green. Turn airplane mode on. Tap AP02, change it to `AP02 edited offline`, Save; its chip stays yellow. Turn airplane mode off and wait for "synced". Tell Claude when done.
7. **Delete and Undo (item 4).** Tap AP03, tap Delete. The row disappears and a bar reads "Capture deleted" with Undo. Tap Undo within 5 s: AP03 returns. Then tap AP04, Delete, and leave the bar alone until it goes (5 s). AP04 stays gone. Wait for "synced". Claude checks: AP04 has `deleted_at` set on the server, AP03 has it null.
8. **Share a Google Maps link (item 7).** In Google Maps, open any place, tap Share, and choose travelboard from the share sheet (it may be under "More"). travelboard should open on the capture screen with the place name and a `maps.app.goo.gl` link filled in, each once. Save. If travelboard is not in the share sheet at all, report that; Chrome may need to refresh the installed app.
9. **Bangkok time and the 0400 rollover (item 6).** Turn airplane mode on first, so nothing tries to sync while the clock is wrong. Android Settings, System, Date and time: turn off "Set time automatically" and "Set time zone automatically" (on some versions "Use network-provided time" and "Use location to set time zone"). Set the time zone to Bangkok (Thailand, GMT+07:00) and set the time to 0030. Note the date the phone shows. Swipe travelboard away and reopen it so it picks up the new zone. The home label should show the day before the phone's date. Capture `BKK 0030`. The row reads "0030 hrs" with no city, because the phone itself is now on Bangkok time. Now set the time to 0400 or later on the same date, swipe the app away and reopen: the label should now show the phone's date and the `BKK 0030` row should be one day back. Capture `BKK 0400`. Then turn automatic time and time zone back on, turn airplane mode off, swipe the app away, reopen, and wait for "synced". Step back to the day before the date you noted: `BKK 0030` should read "0030 hrs Bangkok". `BKK 0400` should read "0400 hrs Bangkok" on the date you noted. Tell Claude the date you noted; Claude checks both rows have `tz` Asia/Bangkok and the two `local_date` values.
10. **Export offline (item 9).** Turn airplane mode on. Tap the status pill, then Export. A file named `travelboard-captures-ddmmyy-hhmm.json` (today's date and the current time) should download, and a bar reads "Exported n captures". Note n. Find the file in Files, Downloads. Upload it to Claude in chat, or report n; Claude checks it holds every capture, AP04 flagged `"deleted": true`. Turn airplane mode off.

### Device results, v3 (Pixel, Gary), 04/10/26 and 10/10/26

Checked against `travel.captures` through the Supabase connector after each step. Times SGT unless marked.

| Step | Result |
|---|---|
| 1 | PASS 04/10/26. Live `sw.js` at `CACHE_VERSION = 3`. The "Update ready, tap to reload" bar appeared on the device (closes the M0 open item); Version v3. M0 records listed on 04/10. |
| 2 | PASS 04/10/26. Location denied: "loc test denied" 2116:07, null coordinates, `updated_at` never bumped, no error. Allowed: "Love test allowed" 2118:11 with a fix (21.071 m), `updated_at` bumped by the GPS merge, synced. The permission prompt appeared over an already saved row, so save did not wait on GPS. |
| 3 | PASS 10/10/26. Draft reopened after a force-close; Close kept it ("draft kept"); a relaunch went to home; Capture restored it; Save cleared it ("Draft test save" 1156:18). |
| 4 | PASS 10/10/26. 20 captures AP01 to AP20, 16 note and 4 journal, all intact on the server with `local_date` 2026-10-10 and a GPS fix. AP01 to AP05 made in airplane mode 1201:48 to 1203:50, landed together 1204:35. AP06 1248:23 made with signal. 14 more in airplane mode 1357:05 to 1401:11, landed together 1401:26. AP13 and AP17 dictated offline with Gboard. |
| 5 | PASS 10/10/26. Long-press "New capture" opens straight into the capture screen. The keyboard did not come up on its own; one tap on the text area raised it. Back: first press closes the keyboard (Android), second closes the capture screen and stays in the app, third leaves the app. |
| 6 | PASS 10/10/26. AP01 edited online and switched to journal, landed at once (1411:38). AP04 edited offline at 1412:42, held, landed 1413:00 on reconnect. AP02 was meant as the offline edit but Wi-Fi came back on by itself before Save, so it synced at once; Gary repeated it as AP04. |
| 7 | PASS 10/10/26. AP03 deleted and left: `deleted_at` 1413:22 on the server. AP05 deleted and undone within 5 s: `deleted_at` null, `updated_at` bumped 1413:42. |
| 8 | PASS 10/10/26. Shared Tampines Mall from Google Maps: body "Tampines Mall" plus the `maps.app.goo.gl` link, each once (1421:01). |
| 9 | PASS 10/10/26. Phone on Asia/Bangkok, automatic time off, airplane mode. "Bkk 0030" captured 10/10 0031 Bangkok time: `local_date` 2026-10-09, shown on Fri 09/10. "Bkk0400" captured 10/10 0415 Bangkok time: `local_date` 2026-10-10. Both `tz` Asia/Bangkok, landed 1429:38 after the clock was restored. Back on Singapore time they read "0031 hrs Bangkok" and "0415 hrs Bangkok". Wi-Fi switched itself back on when the app was reopened with the clock changed; Gary turned it off and continued. |
| 10 | PASS 10/10/26. Made in airplane mode (confirmed by Gary). `travelboard-captures-101026-1433.json`, `exported_at` 0633Z (1433 SGT, matching the name). 30 captures, 1 flagged deleted (AP03), all `synced` true, each with `server_ts`. A digest over id, body, kind, `local_date`, `tz`, `updated_at`, deleted and `lat` matches `travel.captures` exactly (30 rows, md5 `ec9f33c3...`). |

Findings from the device run:
- **Voice offline (Bangkok readiness).** Microsoft SwiftKey's voice input needs a connection ("Language not available offline") even with the on-device English packs installed. Gboard's mic uses those packs and worked in airplane mode. Use Gboard for dictation. SPEC D10 and section 10 updated.
- **Wi-Fi turning itself back on.** Twice Android re-enabled Wi-Fi during airplane-mode steps (after a Save in step 6, and on reopening the app with the clock changed in step 9), once with "Turn on Wi-Fi automatically" off. A web app cannot switch Wi-Fi, so this is the phone. When an offline step matters, check the pill reads "offline" before saving.
- **Shortcut and keyboard.** Android does not raise the keyboard for a page launched with no tap. The textarea is focused and fills the screen, so one tap anywhere brings the keyboard. Accepted as a platform limit.
- **Device clock** runs about 1 s ahead of the server, so `updated_at` can read later than `server_ts` on the same write. Harmless: conflicts compare `updated_at` with `updated_at`, and pulls use `server_ts` only.

---

## M0 Foundation (SPEC.md 6.7)

**Status 04/10/26: all seven acceptance items PASS. M0 done.** Open for the next release: see the "update ready" bar on the device (headless A7 passed; on the Pixel v2 took over while the app was closed, so the bar never appeared).

### Automated results, 04/10/26

| Check | Result | Evidence |
|---|---|---|
| `checks/static.cjs` | PASS, 53 of 53 | `node checks/static.cjs`. Also confirmed it fails on six faults planted in a scratch copy (em dash, broken inline script, version mismatch, missing precache file, unlisted vendor file, `service_role` string). |
| `checks/smoke.sql` | PASS, 24 of 24 | Run through the Supabase connector. One transaction, rolled back; `travel.captures` held 0 rows afterwards. |
| Catalogue diff, migration 0001 | PASS | Only new objects: schema `travel`, table `travel.captures` (RLS on, no grants, no policies), its pkey, 2 indexes, 4 constraints. OIDs 19046 to 19065, no other object in that range. Other changes seen in the same window were the weatherboard retention work (`cold_*`, 3 cron jobs, `cold-archive`), confirmed as Gary's. |
| Catalogue diff, migration 0002 | PASS | Only new objects: the 4 `public.tb_*` functions, all written by one transaction (xid 169862) that touched nothing else. Each is `SECURITY DEFINER`, `search_path=travel, public`, ACL `postgres, authenticated, service_role` (no `anon`, no `PUBLIC`). |
| Headless Chromium, app shell | PASS, 17 of 17 | Service worker controls the page; offline reload renders from `tb-shell-v1` (10 files); offline save queues; `?new=1` and share-target URLs open offline; Plex font loads offline; publishing v2 shows the update bar with no automatic reload, and a tap reloads into v2 and removes the v1 cache. |
| Headless Chromium, sync engine against a mock of the RPCs | PASS, 11 of 11 | No session: nothing sent, "sign in, n queued". After sign in, queued rows land and the dot turns synced. Pull across a 500-row page with one shared `server_ts` gets every row. A newer server edit replaces the local copy. A lost upsert response, retried, leaves one server row and clears dirty. A 401 sets "sign in" and keeps the row queued. The mock mirrors migration 0002; the real Supabase round trip is item 3 below. |

### Acceptance status

| # | Item | Status |
|---|---|---|
| 1 | Installs from Chrome on the Pixel, opens standalone with its own icon | PASS 04/10/26 (Pixel) |
| 2 | Airplane mode on, the installed app opens and renders | PASS 04/10/26 (Pixel, v1 and v2; pill correct in v2) |
| 3 | Dummy record in airplane mode shows queued; on reconnect it lands in `travel.captures` and the dot turns synced | PASS 04/10/26 (Pixel, v2: row at 1954 hrs shown "offline, 1 queued", landed 1955:07, dot synced without a tap) |
| 4 | Same `id` twice gives one row; older `updated_at` does not overwrite newer | PASS 04/10/26, smoke tests 9 to 12 and 18 |
| 5 | Anonymous calls to every `tb_` function fail; direct REST access to `travel.captures` fails | PASS 04/10/26. SQL level: smoke tests 1 to 7. REST level: device step 9 (42501 on the RPC, PGRST106 on the table) |
| 6 | `checks/static.cjs` passes; `checks/smoke.sql` passes | PASS 04/10/26 |
| 7 | Nothing outside `travel`, `public.tb_*` and `tb-*` created or altered | PASS 04/10/26, catalogue diffs above |

### Before the device test (Gary, dashboard)

A. Supabase self-signup off. Done (Gary, set when the user was created; confirmed 04/10/26).
B. GitHub Pages on, deploying from `main`, root. Done (Gary, 04/10/26).

### Device steps (Pixel, Chrome)

Report back the step number and what you saw for any step that does not match.

1. Open `https://jeuron-hue.github.io/travelboard/sw.js` in Chrome. Near the top it should read `const CACHE_VERSION = 1;`. This confirms Pages is serving this release.
2. Open `https://jeuron-hue.github.io/travelboard/trip.html`. You should see "travelboard", a status pill reading "sign in", and an orange "Add test record" button at the bottom.
3. Chrome menu (three dots), "Add to home screen", then "Install". Open travelboard from the home-screen icon (orange pin on dark). It should open with no address bar. Long-press the icon: a "New capture" shortcut should be listed (in M0 it just opens the app).
4. In the app, tap the status pill, enter `gary@travelboard.local` and your password, tap "Sign in to sync". The pill should turn green and read "synced". Note the "Storage" line in the same panel (persistent or not persistent). Tap Close.
5. Turn airplane mode on (Wi-Fi off too). Swipe travelboard away from recents, then open it from the home-screen icon. It should open and render, and the pill should read "offline".
6. Still in airplane mode, tap "Add test record". A row should appear at the top with today's date, the time in 24-hour form and a yellow "queued" chip; the pill should read "offline, 1 queued". Note the time shown on the row.
7. Turn airplane mode off. Within a few seconds the pill should turn green and read "synced", and the row's chip should change to "synced". If it does not change within 30 s, tap the pill, then "Sync now", and report what "Last error" shows.
8. Tell Claude the time from step 6. Claude confirms the row in `travel.captures` (body "M0 test record dd/mm/yy hhmm hrs", your `local_date`, `tz` Asia/Singapore).
9. REST check, from any terminal on the rig (needs network; the publishable key is the one already in `trip.html`):
   ```
   curl -s -X POST https://nyjsrnntxdgfykkmihpx.supabase.co/rest/v1/rpc/tb_whoami -H "apikey: sb_publishable_q75DGiJBda-NwE3tdgPtFg_g3Rasmcg" -H "Content-Type: application/json" -d "{}"
   curl -s "https://nyjsrnntxdgfykkmihpx.supabase.co/rest/v1/captures?select=*" -H "apikey: sb_publishable_q75DGiJBda-NwE3tdgPtFg_g3Rasmcg" -H "Accept-Profile: travel"
   ```
   Expected: the first returns an error containing "permission denied for function tb_whoami"; the second returns an error that the schema `travel` is not allowed or invalid. Paste both outputs back.

### Device results

**04/10/26, Pixel, v1 (Gary)**

| Step | Result |
|---|---|
| 1 | PASS. Live `sw.js` served after Pages was switched on (first deploy 0949 hrs, commit `cc3599d`). |
| 2, 3 | PASS. Installed from Chrome, opens standalone with the pin icon. |
| 4 | PASS. Sign in works; Storage reads "persistent". |
| 5 | PASS for rendering: opens and renders in airplane mode. FAIL for the pill: it read "synced" on open. |
| 6 | PASS for the record: row shown at 1912 hrs with a "queued" chip. FAIL for the pill: "queued 1" instead of "offline, 1 queued". |
| 7 | PASS. On reconnect the pill and chip turned "synced". |
| 8 | PASS. Row captured at 1912 hrs landed in `travel.captures` at 1913:39 (confirmed by Gary). |
| 9 | PASS 04/10/26 (Gary, rig). Anonymous `rpc/tb_whoami`: `{"code":"42501",...,"message":"permission denied for function tb_whoami"}`. Direct `captures` with `Accept-Profile: travel`: `{"code":"PGRST106",...,"hint":"Only the following schemas are exposed: public, graphql_public","message":"Invalid schema: travel"}`. |

Defect (steps 5 and 6): the pill code already put `navigator.onLine === false` first, so the readings mean Chrome reported online in airplane mode. A VPN was active (key icon in the status bar), which commonly keeps Chrome on Android reporting online. The pill also showed the "synced" default before the first sync attempt had settled.

Fix in v2 (`trip.html` APP_VERSION 2, `sw.js` CACHE_VERSION 2; SPEC.md 6.6 updated): the pill starts as "checking" (or "offline" when `navigator.onLine` is false at launch) and never shows "synced" until a sync has succeeded. Each sync first makes a 5 s reachability probe to the Supabase host, and any network failure reads as offline. A 30 s retry runs while the app is visible and rows are queued or the pill reads offline, and stops when hidden or when synced with an empty queue. The `online` and `offline` events still drive the pill.

Headless re-test of v2, 04/10/26: 37 of 37 PASS. New cases:
- With `navigator.onLine` true and Supabase unreachable, the pill goes "checking" to "offline" and never shows "synced"; a save then shows "offline, 1 queued", never "queued 1".
- Launching with `navigator.onLine` false shows "offline, 1 queued" from the first paint.
- The network dropping while `navigator.onLine` stays true shows "offline, n queued"; Sync now after it returns lands the rows.
- Retry, on a fake clock: no retry while synced with an empty queue (95 s); the network returning with no `online` event is picked up by the retry and the pill turns synced; the retry stops once synced; no retry while hidden with a queued row; it resumes every 30 s when visible again.

`checks/static.cjs` 53 of 53 PASS.

### v2 device re-test (Pixel, VPN on as before)

1. Open `https://jeuron-hue.github.io/travelboard/sw.js` in Chrome. It should read `const CACHE_VERSION = 2;`. If it still shows 1, wait a few minutes and reload; GitHub's CDN can hold the old copy for up to 10 minutes.
2. Open travelboard from the home-screen icon. An "Update ready, tap to reload" bar should appear above the button within a few seconds (if not, swipe the app away and reopen it). Tap it. The app reloads; tap the pill and check Version reads v2. Your M0 test record from 1912 hrs should still be listed. Close.
3. Turn airplane mode on (Wi-Fi off). Swipe travelboard away from recents and open it from the icon. The pill may read "checking" for up to 5 s, then must read "offline". It must not show "synced" at any point.
4. Still in airplane mode, tap "Add test record". The pill must read "offline, 1 queued"; the new row has a yellow "queued" chip. Note the row's time.
5. Pull down the quick settings and turn airplane mode off without leaving the app. Within about 35 s the pill should turn green "synced" and the chip "synced", with no tap from you. Report roughly how long it took.
6. Optional hidden check: airplane mode on, add a record, press Home so the app is in the background, turn airplane mode off, wait a minute, then reopen the app. The record should sync within a few seconds of reopening (the retry does not run in the background, but reopening triggers a sync).
7. Tell Claude the time from step 4 (and step 6 if run). Claude confirms the rows in `travel.captures`.

**04/10/26, Pixel, v2 re-test (Gary, VPN on)**

| Step | Result |
|---|---|
| 1 | PASS. Live `sw.js` reads `CACHE_VERSION = 2` at 1949 hrs (deploy of `a6b66d2`). |
| 2 | v2 running: the pill showed "checking", which exists only in v2. No "update ready" bar was seen: v2 took over while the app was fully closed, which needs no bar. The bar itself (a new version arriving while the app is open) was not exercised on the device; it passed headless (A7) and will be checked on the next release. The 1912 hrs record was still listed. |
| 3 | PASS. Airplane mode: pill read "offline", never "synced". |
| 4 | PASS. Record at 1954 hrs: pill "offline, 1 queued", chip "queued". |
| 5 | PASS. Airplane mode off without leaving the app: at 1955 hrs the pill still read "offline, 1 queued" on 5G, then turned "synced" with no tap. The retry picked up the reconnect. |
| 6 | Not run (optional). |
| 7 | PASS. `travel.captures`: 1954 hrs record captured 1954:05, landed 1955:07 (`tz` Asia/Singapore, `local_date` 2026-10-04). Also present: 1912 hrs (landed 1913:39) and 1952 hrs (saved online, landed 0.17 s after capture). |
