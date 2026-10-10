# travelboard: tests

Manual and automated test records, newest first. Device steps run by Gary on the Pixel.
Acceptance lists are in `SPEC.md`; this file holds how each item is tested and the dated result.

---

## M2 Journal (SPEC.md 8.7)

**Status 10/10/26: built and deployed; automated checks pass; device steps below are for Gary.** Items 4 and 5 pass; items 1 to 3 need the Pixel.

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
| 1 | One real evening conversation in which Claude refers to at least two of that day's captures by content | Open: device step 7 |
| 2 | A message sent in airplane mode queues, sends on reconnect, and produces exactly one reply | Open: device step 3 (headless K5 PASS) |
| 3 | Retrying a message that already has a reply returns the stored reply without a second API call (token rows) | Open: device step 4 (headless K6, smoke J6 and J7, fn F5 PASS) |
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

Notes for the device run:
- Journalling works online only; a turn written offline waits as "queued" and goes on reconnect. Captures stay offline-first as before.
- Cost: each reply is one Sonnet 5.5 call capped at 1500 output tokens. Token counts per reply are in `travel.journal_messages`; Claude can total them for any period.

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
