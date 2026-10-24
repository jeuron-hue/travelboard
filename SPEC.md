# travelboard: specification

Owner: Gary Chan. Repo: `jeuron-hue/travelboard` (public). Written 04/10/26.
Status: M0 Foundation done 04/10/26. M1 Capture done 10/10/26. M2 Journal done 23/10/26. Move to own project (6.8) done 24/10/26. M1.1 Photo capture done 24/10/26. M1.2 Two travellers built 24/10/26; its two-phone test waits for M1.3. M1.3 Look and place (7C) from 24/10/26. Both pass on the phones by 05/11/26; freeze 06/11/26.

This file is the source of record for what travelboard is and how it is built. M0, M1 and M2 are specified in full because they ship before Bangkok (09/11/26). M3 to M8 are skeletons, to be expanded one at a time after Bangkok using the friction log from that trip.

If anything here turns out to be wrong during a build, correct this file in the same session. Do not build around a known error.

---

## 1. The problem

Standing on a busy foreign street for 15 minutes trying to google a place. Most of that time is retrieval, not discovery: re-finding a place already chosen, or answering one narrow question about it (is it open today, which branch is the real one, how far, what did I note about it). Google is slow at this because it knows everything except the trip.

Second problem, from the Penang 07/08/26 to 10/08/26 planning: the itinerary lived in a chat and was regenerated at least four times. No single source of truth. Opening hours broke the plan twice (Siam Road CKT and Him Heang both scheduled on days they were closed), addresses drifted three times, and a prepaid couples massage was nearly lost between regenerations.

Third: capture. Notes and journal entries must be one tap away, by voice or typing, and must never fail for lack of signal. Journalling is a conversation with Claude, not a text box.

Wanderlog was used for Switzerland (Jan 2025) and liked, but its AI layer and journaling are weak, and it does not check opening hours against the day an item is scheduled on.

## 2. Fixed decisions

| # | Decision | Date |
|---|---|---|
| D1 | Own app, built module by module, each module usable on its own | 04/10/26 |
| D2 | Two frontends over one backend: `trip.html` (phone, installed PWA, offline) and `planner.html` (rig/laptop browser, online only, from M3) | 04/10/26 |
| D3 | Backend in its own Supabase project `travelboard` (ref `nnnnonspfljdkrxstslw`, org `jeuron`, ap-southeast-1, free plan), created 23/10/26. All travelboard tables in a dedicated `travel` schema. From 04/10/26 to the move it lived inside the `weatherboard` project (ref `nyjsrnntxdgfykkmihpx`); it moved out because that shared database reached 381 MB of the 500 MB cap on 23/10/26 and photos were coming (section 6.8) | 04/10/26, own project 23/10/26 |
| D4 | Tables are never exposed through the API. The client reaches data only through SECURITY DEFINER RPCs in `public` prefixed `tb_`. One exception from M1.1: photo files go through the Storage API to the private bucket `tb-photos`, guarded by RLS policies on `storage.objects` that admit only the owner's own folder | 04/10/26, photos 23/10/26 |
| D5 | Server-side secrets (Anthropic key, later Google key) live in Supabase Edge Functions prefixed `tb-`, as secrets named with a `TB_` prefix | 04/10/26, prefix 10/10/26 |
| D6 | Hosting on GitHub Pages from a public repo. No build step, vanilla JS, libraries vendored into the repo | 04/10/26 |
| D7 | Auth: one synthetic login created from the dashboard, `signInWithPassword`, self-signup off | 04/10/26 |
| D8 | Offline-first on the phone: the UI reads IndexedDB, never Supabase directly. Supabase is the sync target | 04/10/26 |
| D9 | Captures: GPS on by default, editable, soft delete, default kind `note` | 04/10/26 |
| D10 | Voice v1 is Gboard voice typing into a plain textarea, with the on-device English speech pack so it works offline. No in-app speech recognition before Bangkok. (SwiftKey's voice input needs a connection, so it does not qualify; found 10/10/26) | 04/10/26 |
| D11 | Journal with Claude via the Anthropic API from an Edge Function, Sonnet-class model, one thread per local day. Billing: a `travelboard` workspace in the same Console org as weather's `weather` workspace (both draw on the USD 100 monthly subscriber API credit), with its own key and a hard monthly spend limit of USD 30, auto-reload off | 04/10/26, workspace 10/10/26 |
| D12 | Lighter test regime than house standard: static checks, SQL smoke script, written manual test scripts. No mutation testing | 04/10/26 |
| D13 | Map layer is locate-and-reach only: day map, coordinates, copyable address, deep link to Google Maps. No offline vector tiles | 04/10/26 |
| D14 | Apify is a plan-time enrichment tool only, never in a street-time path | 04/10/26 |
| D15 | Photo captures (M1.1): one photo per capture from the in-app camera or gallery, shrunk on the phone, stored offline first, synced to a private Supabase Storage bucket `tb-photos`. Claude sees the day's photos in the journal. Each photo has a "Claude sees this" switch, default on: switched off, the photo is kept, synced and shared like any other but never goes to Claude. At most 30 switched-on photos per day reach Claude (combined across both travellers from M1.2); switched-off photos have no limit (24/10/26). Built before Bangkok with a cut-off of 27/10/26; if it is not passing on the Pixel by then, it ships after Bangkok | 23/10/26, switch 24/10/26 |
| D16 | Two travellers (M1.2): Eric gets his own login on his own Android phone. Separate by default: each sees only his own captures and journals. Each can add the other in the app; the link is live only when both have added, and either can remove it. While linked, each capture has a "Share with" switch, default on; a shared capture, photo included, appears read-only on the other's phone. Journal threads stay private. Each has his own journal prompt; both share the `travelboard` workspace. Built after M1.1 for Bangkok, cut-off 05/11/26 (was 31/10; moved so Eric's first look is the M1.3 design) | 23/10/26, separate by default 24/10/26 |
| D17 | Look and place (M1.3): a field-notebook visual identity for the phone app, designed in full for light and dark; serif headings, Plex Sans body. Captures get an editable place name, offered as one-tap chips from your own named places nearby (offline) and from OpenStreetMap (online); never filled in automatically. Each person can edit his own journal prompt in the app. Built before Bangkok in two sessions after M1.2's build; M1.2 and M1.3 pass on both phones by 05/11/26; freeze 06/11/26 | 24/10/26 |

## 3. Design principles

These bind every module.

1. **Capture never fails.** Write locally first, sync whenever. No network, no session, no GPS: the capture still saves.
2. **No fields at capture time.** Timestamp, timezone, GPS and kind are automatic. Sorting happens afterwards.
3. **Never auto-parse a transcript into structured fields.** Voice text goes in as text and stays as text.
4. **Latency budgets.** Cached lookup on the phone under 2 s, works offline. Live query under 10 s to a usable answer. A feature that cannot meet its budget does not ship in that path.
5. **Plain-language answer on top, detail behind.** Glanceable first, structure underneath, never one instead of the other.
6. **Every fact carries its source and its age.** Places hours, a blog post and a photo of the door sign are not equal. Unverified facts are flagged, not presented as fact.
7. **Store identity, not text.** A place is stored by `place_id` and coordinates from the source at add time, never by a typed address. A capture's `place_name` (M1.3) is a label the user chose, not a place identity: the capture's coordinates stay the record of where it was, and `place_id` stays reserved for M3.
8. **Local day, not Singapore day, and the day ends at 0400.** The day is taken in the zone where the capture was made, and it rolls over at 0400 local, not midnight: a capture at 0030 hrs in Bangkok belongs to that Bangkok evening.
9. **Friction first, then looks.** Two users, Gary and Eric (from M1.2). Taps saved come first; from M1.3 the app should also read like a travel journal (7C), and the look never costs a tap.

## 4. Architecture

```
Phone (Pixel)                         Rig / laptop (from M3)
trip.html  (installed PWA)            planner.html  (browser, online only)
  |  service worker: app shell cache
  |  IndexedDB: captures, journal, meta  <- the UI reads only this
  |  sync engine: dirty rows -> RPC, pull by server cursor
  v                                       v
GitHub Pages  jeuron-hue/travelboard  (static files only)
  |
  v
Supabase project "travelboard" (nnnnonspfljdkrxstslw)
  auth      one user, synthetic login
  public    tb_* SECURITY DEFINER RPCs  (the only client entry point)
  travel    tables (not exposed to the API)
  edge fn   tb-journal  (holds TB_ANTHROPIC_API_KEY)   [M2]
            tb-places   (holds Google key)          [M3]
  |
  v
Anthropic Messages API  [M2]      Google Places API  [M3]
```

### 4.1 Own project, and what is still shared

From 23/10/26 travelboard has its own Supabase project, so it no longer shares a database, Storage quota, auth settings or Edge Function secrets with weatherboard. Before that it lived inside `weatherboard` (section 6.8).

- The `weatherboard` project (ref `nyjsrnntxdgfykkmihpx`) runs Gary's live East Sky Board. travelboard never creates or changes anything there. The one exception is removing everything travelboard left there (6.8 step 7), on Gary's explicit yes, once the move passes on the Pixel.
- travelboard secrets keep the `TB_` prefix (`TB_ANTHROPIC_API_KEY`), and functions keep `tb_` and `tb-`, so the naming stays unambiguous if the projects ever meet again.
- Anthropic billing is still shared: weather's API twin and travelboard's journal draw on the same USD 100 monthly subscriber credit, in separate Console workspaces (`weather` capped at USD 70, `travelboard` at USD 30) so neither can starve the other.
- Keep-alive: a free project pauses after a period without activity, and travelboard has no cron of its own. A scheduled GitHub Actions workflow in this repo keeps it awake (6.8). Confirm the current pause rule at build time.
- Free plan limits for this project alone: 500 MB database, 1 GB file storage, 5 GB egress (supabase.com/pricing, read 23/10/26).

### 4.2 Repo layout

```
travelboard/
  index.html            two-link landing page: trip, planner
  trip.html             phone app (M0 to M2), single file: markup, styles, script
  planner.html          rig app (M3+)
  sw.js                 service worker (must be a separate file)
  manifest.webmanifest  PWA manifest (must be a separate file)
  icons/                icon-192.png, icon-512.png, icon-maskable-512.png
  vendor/               supabase-js pinned build, served locally so it works offline
  prompts/journal.md    Gary's journal system prompt, bundled into tb-journal at deploy
  prompts/journal-eric.md  Eric's (M1.2)
  supabase/
    migrations/         numbered SQL files, one per applied block
    functions/tb-journal/
      index.ts          the function
      context.mjs       system prompt and thread building, shared with the checks
      prompt.ts         generated from prompts/*.md by bundle-prompt.cjs
  .github/workflows/
    keepalive.yml       daily keep-alive request to project travelboard (6.8 step 5)
  checks/
    static.cjs          parse inline scripts, validate manifest, sw cache list matches files
    smoke.sql           RPC and grant smoke tests
    catalogue.sql       catalogue snapshot; catalogue_scoped.sql lists travelboard's objects, the rest as a count and hash
    headless/           Playwright tests of trip.html against an RPC mock (dev only, never shipped):
                        m1, m2, m11, m12 (two phones on one mock), m13 (place names, OSM mock), fn (tb-journal under Deno)
  TESTS.md              manual test scripts, run on the Pixel
  SPEC.md               this file
  CLAUDE.md             standing brief for Claude Code
```

`sw.js` and `manifest.webmanifest` are the one forced break from the single-file house style.

### 4.3 House conventions carried from weatherboard

- IBM Plex Sans. Colour tokens on `:root`, light and dark sets, `data-theme` attribute on `documentElement` with the choice persisted in `localStorage`. Reuse weatherboard's token names (`--ground`, `--surface`, `--ink`, `--muted`, `--line`, `--accent`, `--good`, `--warn`, `--crit` and their `-bg` pairs) with a travelboard accent of its own.
- Each HTML file opens with a comment block: "SOURCE OF RECORD", what the file does, then a dated change log, newest first.
- UI dates dd/mm/yy, times 24-hour, SI units.

---

## 5. Module plan

| Module | Scope | Window | Done when |
|---|---|---|---|
| M0 Foundation | Schema, auth, RPCs, repo, PWA shell, IndexedDB, sync engine | 05/10 to 11/10 | Installs on the Pixel, opens in airplane mode, a record queued offline lands in Supabase on reconnect |
| M1 Capture | One-tap capture, voice via Gboard, GPS, timezone, edit, soft delete, export | 12/10 to 18/10 | 20 airplane-mode captures all arrive intact after reconnect |
| M2 Journal | Thread per local day, Claude via `tb-journal`, day's captures as context | 19/10 to 25/10 | One real evening conversation that references the day's captures |
| Move to own project | travelboard out of `weatherboard` into its own Supabase project (6.8) | 23/10 to 24/10 | 6.8 step 8 passes on the Pixel |
| M1.1 Photo capture | Photo on a capture (camera or gallery), offline first, Storage bucket `tb-photos`, photos in the journal | 24/10 to 27/10 | Section 7A acceptance passes on the Pixel by 27/10, or it moves to after Bangkok |
| M1.2 Two travellers | Eric's login, separate by default, add each other, per-capture share, private journals (7B) | built 24/10; device test with M1.3, by 05/11 | Section 7B acceptance passes on both phones by 05/11, or it moves to after Bangkok |
| M1.3 Look and place | Field-notebook redesign of every screen, place names with chips, editable journal prompt (7C) | 24/10 to 04/11, two sessions | Section 7C acceptance passes on both phones by 05/11 |
| Shakedown | Daily use in Singapore. Fixes only, no features (the move, M1.1, M1.2 and M1.3 are the agreed exceptions) | 26/10 to 06/11 | Freeze on 06/11 |
| Bangkok pilot | Use it for real, keep a friction log | 09/11 to 12/11 | Friction log written |
| M3 Trip model + planner | Trips, days, items, places, hours validation | after Bangkok | skeleton below |
| M4 Phone day view + lookup | Morning pre-fetch, cached lookup, live query | after M3 | skeleton below |
| M5 Map + money | Day map, currency, expense capture | after M4 | skeleton below |
| M6 Bookings + entitlements | Prepaid items, email parsing | after M3 | skeleton below |
| M7 Reminders | Google Calendar as the notification engine | after M3 | skeleton below |
| M8 Enrichment | Apify overnight cross-checks | after M3 | skeleton below |

Order after Bangkok is revisited against the friction log before M3 starts. Each module starts only on Gary's go.

---

## 6. M0 Foundation (full)

### 6.1 Auth

- Gary creates one user in the Supabase dashboard: synthetic, non-routable email (for example `gary@travelboard.local`), auto-confirmed, strong password. Credentials are never committed.
- Auth settings: self-signup off. Email confirmations irrelevant (no email channel).
- Client: `createClient(url, publishableKey)` from the vendored supabase-js, `signInWithPassword`, session persisted by the library.
- An expired or missing session never blocks the app. The UI keeps working from IndexedDB; sync pauses and shows a "sign in to sync" state. Re-auth happens when online.
- The publishable key sits in client source. `service_role` never appears in any static file.

### 6.2 Schema (migration 0001)

```sql
begin;

create schema if not exists travel;
revoke all on schema travel from public, anon, authenticated;

create table travel.captures (
  id           uuid primary key,                 -- generated on the phone
  owner        uuid not null references auth.users(id),
  body         text not null default '' check (char_length(body) <= 20000),
  kind         text not null default 'note' check (kind in ('note','journal')),
  captured_at  timestamptz not null,             -- device clock, UTC
  tz           text not null,                    -- IANA zone at capture, e.g. Asia/Bangkok
  local_date   date not null,                    -- local day in tz at capture, rolling over at 0400 (principle 8)
  lat          double precision,
  lng          double precision,
  accuracy_m   real,
  trip_id      uuid,                             -- reserved for M3, no FK yet
  place_id     text,                             -- reserved for M3
  updated_at   timestamptz not null,             -- device clock, drives last-write-wins
  deleted_at   timestamptz,                      -- soft delete
  server_ts    timestamptz not null default now()-- set by server on every write, pull cursor
);

alter table travel.captures enable row level security;

create index captures_owner_day on travel.captures (owner, local_date);
create index captures_owner_server_ts on travel.captures (owner, server_ts);

commit;
```

Notes:
- `server_ts` exists because device clocks are unreliable for pull cursors. `updated_at` (device) decides conflicts; `server_ts` (server) decides what to pull.
- `local_date` is computed on the phone at capture time from `tz` and stored, so grouping never depends on where the server or the viewer is. It is the calendar date in `tz`, minus one day when the local time is before 0400 (principle 8). The same rule decides "today" in the UI and, in M2, the journal thread a message belongs to.
- RLS is enabled on the table as defence in depth even though no role has table grants.

### 6.3 RPCs (migration 0002)

All `SECURITY DEFINER`, `set search_path = travel, public`, `revoke all ... from public, anon`, `grant execute ... to authenticated`. Each raises if `auth.uid()` is null.

| Function | Input | Behaviour | Returns |
|---|---|---|---|
| `tb_whoami()` | none | Gate check for the client | `{uid, email}` |
| `tb_capture_upsert(p jsonb)` | one capture as JSON | Insert, or on conflict `id` update only if incoming `updated_at` is newer (last-write-wins). Validates `kind`, body length, `tz` non-empty. Sets `owner = auth.uid()`, `server_ts = now()`. Rejects rows whose existing `owner` differs | `{id, applied: bool, server_ts}` |
| `tb_captures_upsert(p jsonb)` | JSON array | Batch wrapper over the single upsert, one transaction | array of the above |
| `tb_captures_since(p_since_ts timestamptz, p_since_id uuid)` | keyset cursor; both null means from the start | Rows for `auth.uid()` with `(server_ts, id) > (p_since_ts, p_since_id)`, including soft-deleted rows so deletes propagate, ordered by `server_ts, id`, limit 500 | `{rows, next_cursor: {server_ts, id}}` from the last row; echoes the input cursor when there are no rows |

Idempotency: retrying the same capture any number of times produces one row. That is the property the whole offline design rests on.

Pull cursor: `server_ts` is `now()`, the transaction start time, so every row in one batch shares it. The cursor is therefore the pair `(server_ts, id)`, which is unique, so a page boundary inside a batch never skips rows.

### 6.4 PWA shell

**manifest.webmanifest**
- `name` "travelboard", `short_name` "travelboard", `start_url` "./trip.html", `scope` "./", `display` "standalone", `orientation` "portrait", theme and background colours from the dark token set.
- Icons 192, 512 and a maskable 512.
- `shortcuts`: "New capture" pointing to `./trip.html?new=1`. Long-press on the home-screen icon gives a one-tap route straight into capture.
- `share_target` (M1 uses it): GET to `./trip.html` with `title`, `text`, `url` params, so text or a Google Maps link shared from another app opens a prefilled capture.

**sw.js**
- Precache the shell: `trip.html`, `manifest.webmanifest`, icons, `vendor/*`. Cache name `tb-shell-v<N>`; bump N on every release, and `checks/static.cjs` verifies the precache list matches files on disk.
- Shell requests: cache-first. Supabase and Edge Function requests: network-only, never cached.
- New version: install in the background, then show an "update ready, tap to reload" bar. Never `skipWaiting` automatically, so an update never interrupts a capture in progress.

**Storage durability**
- On first run call `navigator.storage.persist()` so Chrome does not evict IndexedDB under storage pressure, and call it again on later launches while `navigator.storage.persisted()` is still false (Chrome may grant it only once the app is installed; it never prompts). Show the result in a settings line.

### 6.5 IndexedDB

Database `travelboard`, version 1. A small hand-written promise wrapper, no library.

| Store | keyPath | Indexes | Purpose |
|---|---|---|---|
| `captures` | `id` | `local_date`, `dirty` | Full mirror of captures plus a `dirty` flag (1 = not yet confirmed by server) |
| `drafts` | `id` | none | Text being typed, saved on every input event, cleared on save |
| `meta` | `key` | none | `pull_cursor`, `last_sync_ok`, `last_sync_error`, schema version |

### 6.6 Sync engine

- Triggers: app open, `visibilitychange` to visible, the `online` event, after every local save, and a 30 s retry. The retry runs only while the app is visible and rows are queued or the pill reads offline; it stops when the app is hidden, or when synced with an empty queue. One sync at a time (a simple in-memory lock).
- Reachability: `navigator.onLine` is not trusted alone (Chrome on Android can report online in airplane mode, for example with a VPN active). Before each sync, one request to the Supabase host with a 5 s timeout; if it fails, or any request in the sync fails at the network level (including a timeout), the state is offline.
- Push: read all `dirty = 1` captures, send in batches of 50 to `tb_captures_upsert`, mark each `dirty = 0` only on a confirming response. Any failure leaves rows dirty for the next trigger.
- Pull: `tb_captures_since(pull_cursor.server_ts, pull_cursor.id)`, merge by last-write-wins on `updated_at`, advance `pull_cursor` to `next_cursor`, repeat until a page comes back empty. `pull_cursor` is the `{server_ts, id}` pair, starting as nulls. Keep `server_ts` as the exact string the server returned: it has microsecond precision, and converting it to a JS `Date` truncates to milliseconds, which moves the cursor backwards and re-pulls the same page forever.
- No session or no network: skip silently, record `last_sync_error`, show a small status dot (checking / synced / queued n / sign in / offline). "checking" is the state at launch, and after an `online` event, until a sync attempt settles; the dot never shows synced before a sync has succeeded in the current session. At launch with `navigator.onLine` false it starts as offline.
- Only a row's owner can change it (M1.2 keeps that), so last-write-wins on the owner's devices is the whole conflict policy.

### 6.7 M0 acceptance

1. `trip.html` installs from Chrome on the Pixel and opens standalone with its own icon.
2. With airplane mode on, the installed app opens and renders.
3. A dummy record written in airplane mode shows as queued; on reconnect it lands in `travel.captures` and the dot turns to synced.
4. Calling `tb_capture_upsert` twice with the same `id` yields one row; an older `updated_at` does not overwrite a newer one.
5. Anonymous calls to every `tb_` function fail. Direct REST access to `travel.captures` fails.
6. `checks/static.cjs` passes; `checks/smoke.sql` passes.
7. Nothing outside `travel`, `public.tb_*` and `tb-*` was created or altered (verify with a catalogue query before and after). This held while travelboard lived in `weatherboard`; in its own project the catalogue diff still checks that each migration did only what it says.

### 6.8 Move to its own project (23/10/26)

Done before M1.1, so the photo bucket is built once, in the right place.

1. **Gary, dashboard:** in project `travelboard`, Auth: self-signup off; user `gary@travelboard.local`, auto-confirmed, new strong password. Console, workspace Travelboard: a new key (the old key's value is gone), set as Edge Function secret `TB_ANTHROPIC_API_KEY` in project `travelboard`; then revoke the old key.
2. **Schema:** apply migrations 0001 to 0004 unchanged to `travelboard`, one at a time, with a catalogue snapshot before and after each. Run `checks/smoke.sql` there.
3. **Data:** copy `travel.captures`, `travel.journal_messages` and `travel.journal_days` from `weatherboard` with their ids, timestamps and soft deletes intact, `owner` remapped to the new user's uid, `server_ts` set fresh. Row counts and an id-by-id comparison must match before and after.
4. **Edge Function:** deploy `tb-journal` to `travelboard`, `verify_jwt` on. One test call as Gary from the Pixel after step 6.
5. **Keep-alive:** a GitHub Actions workflow in this repo on a schedule well inside the pause window, making one cheap request with the publishable key. Model it on weatherboard's keep-alive. No secret beyond the publishable key. Built 23/10/26 as `.github/workflows/keepalive.yml`: daily at 0243 UTC, an anonymous `POST rpc/tb_whoami`. travelboard grants anon nothing (rule 3), so the run passes only on Postgres's own denial (HTTP 401 or 403 with code 42501), which proves the request reached the database; a paused project (540), a 5xx or no answer fails it. Like weatherboard's, it commits a `.keepalive` stamp so GitHub does not switch the schedule off after 60 days without a commit. Pause rule read 23/10/26: a free project with low database activity over 7 days is paused, after a warning email.
6. **Client v6:** `SUPABASE_URL` and the publishable key point at `travelboard` (fetch the key with the connector). `meta.project_ref` is stored; when it differs from the running build's ref, the client clears `pull_cursor` and the stored session, marks every local capture and journal row dirty, and shows "sign in". Pushes are idempotent, so the phone's own copy also fills any gap left by step 3. Nothing local is ever deleted. Detail at build (23/10/26): "every journal row dirty" means every sent user turn goes back to pending and is resent through `tb-journal` once signed in; for a turn the copy already holds, the function returns the stored reply with no Claude call, so no reply is duplicated. A turn already marked "not sent" stays that way (never resent automatically, 8.5). Day titles are re-sent and every day is re-fetched. The stored session is removed from storage directly rather than through `signOut`, which would send the old project's token to the new project. A fresh install with no earlier data only records `project_ref`.
7. **Weatherboard clean-up:** everything travelboard comes out of `weatherboard` (Gary, 23/10/26), as soon as step 8 passes on the Pixel, on his explicit yes at that moment. Inventory taken 23/10/26:
   - schema `travel`: tables `captures` (33 rows), `journal_messages` (12), `journal_days` (1), and their 7 indexes
   - 9 functions: `public.tb_whoami`, `tb_capture_upsert`, `tb_captures_upsert`, `tb_captures_since`, `tb_journal_day`, `tb_journal_days`, `tb_journal_day_suffix`, `tb_journal_turn`, `tb_journal_reply`
   - 4 migration history rows in `supabase_migrations.schema_migrations`: `tb_0001_travel_schema_captures`, `tb_0002_rpcs`, `tb_0003_journal_tables`, `tb_0004_journal_rpcs`
   - Edge Function `tb-journal` (v1) and secret `TB_ANTHROPIC_API_KEY`
   - auth user `gary@travelboard.local` (the project's only auth user)

   Claude Code drops the schema, the functions and the history rows in one transaction, with a catalogue diff and a check that weatherboard's tables, functions, cron jobs, Edge Functions and the `radar` bucket are unchanged. Gary deletes `tb-journal`, the secret and the auth user in the dashboard. Self-signup stays off in `weatherboard` (it uses no auth). A final query confirms nothing named `travel`, `tb_` or `tb-` remains there.
8. **Acceptance:** the Pixel signs in to `travelboard`; every capture and journal day from before the move is there; a new capture syncs; a journal message gets a reply; the keep-alive workflow has run once green; `checks/static.cjs`, `checks/smoke.sql` and the M1 and M2 headless suites pass against v6.

---

## 7. M1 Capture (full)

### 7.1 Screens

**Home (today):** a large Capture button in thumb reach at the bottom; above it, today's captures for the device's current local date, newest first. Each row: time (24 h), first line of the body, kind chip, a GPS dot if a fix was recorded, sync state. A date header switcher to step back through earlier days.
- Rows are two lines. Line one: the time in the row's own `tz`, with the city appended when that zone differs from the phone's (for example "0030 hrs Bangkok"), then the kind chip, GPS dot and sync chip. Line two: the first line of the body, cut off with an ellipsis.
- Switcher label "Sun 04/10/26". The arrows step to the nearest day that has captures, skipping empty days; today is always reachable, even when empty. Tapping the label returns to today.
- The Capture button reads "draft kept" under its label while a closed new-capture draft exists.

**Capture:** opens full-screen with the textarea focused so the keyboard is already up and the Gboard mic is one tap away. Exception: on a launch with no tap (home-screen shortcut) Android does not raise the keyboard; the textarea fills the screen, so one tap anywhere brings it up. Save top-right. A kind toggle (note / journal), default note. Nothing else on the screen except Close, top-left. Save is disabled while the trimmed body is empty. The viewport sets `interactive-widget=resizes-content` so the screen shrinks above the keyboard. Opening it pushes a history entry, so Android back closes it instead of leaving the app.

**Edit:** tapping a row opens the same screen with the text, kind toggle and a Delete action. Delete sits in a bottom bar with the capture's date, time, zone and GPS accuracy. The keyboard is not raised on open.

**Settings line:** sync status, last sync time, storage persistence result, theme toggle, Export, sign in / out.

### 7.2 Behaviour

- **Entry routes:** in-app button; home-screen shortcut `?new=1`; share target prefill (`title`, `text`, `url` joined into the body, one per line, dropping any part already contained in another). A prefill is appended to an existing `new` draft, written to the draft at once, and the URL is then cleaned with `replaceState`.
- **Drafts:** every input event writes to `drafts`. If the app is killed mid-typing, reopening restores the draft. Key `new` for a new capture, the capture id for an edit, each with an `open` flag set while the screen is up. Close on a new capture keeps its draft with `open` false; Close on an edit discards its draft. At boot only a draft with `open` true is reopened automatically (the app was killed mid-typing).
- **updated_at:** strictly increases on every local change: max(now, previous + 1 ms). The server applies only a strictly newer value, so two changes in one millisecond, or after the clock moves back, still propagate.
- **On save:** generate uuid (`crypto.randomUUID()`), set `captured_at` and `updated_at` to now, `tz` from `Intl.DateTimeFormat().resolvedOptions().timeZone`, compute `local_date` in that zone with the 0400 rollover, write to IndexedDB with `dirty = 1`, close the screen, then trigger sync. The save never waits on GPS or network.
- **GPS:** fired at save with `enableHighAccuracy: true`, `timeout: 5000`, `maximumAge: 60000`. New captures only, never awaited. If it resolves, update the row's `lat`, `lng`, `accuracy_m`, bump `updated_at`, mark dirty, as a read-modify-write so an edit or push confirmation in between is never overwritten. If it fails or is denied, the capture stays with nulls. Location permission is requested once on first save.
- **Edit:** changes body or kind, bumps `updated_at`, marks dirty. `captured_at`, `tz` and `local_date` never change on edit.
- **Delete:** sets `deleted_at`, bumps `updated_at`, marks dirty, hides the row, shows an Undo toast for 5 s. No hard delete anywhere in the client.
- **Export:** downloads every capture in IndexedDB, deleted ones included and flagged, as one JSON file named `travelboard-captures-ddmmyy-hhmm.json` (device time). Each capture carries its server fields plus `deleted`, `synced` and `server_ts`. Works offline.

### 7.3 M1 acceptance

1. 20 captures made in airplane mode, mixed note and journal, all arrive intact in Supabase after reconnect, with correct `local_date`.
2. App force-closed mid-typing: the draft is restored on reopen.
3. Edit after sync propagates; an edit made offline wins over the older server copy.
4. Delete hides the row locally and sets `deleted_at` on the server; Undo within 5 s restores it.
5. Location denied: captures save with null coordinates and no error.
6. Phone timezone set to Asia/Bangkok: a capture at 0030 hrs local gets the previous Bangkok date (that evening's), and its time shows as 0030 hrs with "Bangkok"; a capture at 0400 hrs or later gets the same day's date. The rule must use Bangkok time, not Singapore time.
7. Share a Google Maps link from Maps into travelboard: a prefilled capture opens.
8. Home-screen shortcut opens straight into capture.
9. Export produces a valid JSON file offline containing every capture.

---

## 7A. M1.1 Photo capture (full)

Added 23/10/26 on Gary's decision (D15). A photo is part of a capture, not a separate object: same row, same kinds, same day rule, same sync.

### 7A.1 Schema and storage (migrations 0005, 0006, then 0007)

- 0005, `travel` and `public.tb_*` only: `alter table travel.captures add photo_path text, add photo_w int, add photo_h int, add photo_bytes int`. `photo_path` is `<owner uuid>/<capture id>.jpg`, null when there is no photo or it has not uploaded yet. Replace `tb_capture_upsert` so it carries the four fields and accepts only the caller's own `<uid>/<id>.jpg` as `photo_path`; `tb_captures_since` already returns whole rows, so it carries them unchanged; everything else in 6.3 is unchanged. Also `alter table travel.journal_messages add cache_write_tokens int, add cache_read_tokens int` for 7A.4, and replace the two function RPCs of 8.2: `tb_journal_turn` returns each capture's `photo_path`, so `tb-journal` can load the day's photos, and `tb_journal_reply` stores the two cache counts.
- 0006, Storage: create bucket `tb-photos`, private, file size limit 2 MB, allowed type `image/jpeg`. Policies on `storage.objects` for role `authenticated` only, each with `bucket_id = 'tb-photos' and (storage.foldername(name))[1] = auth.uid()::text`: `tb_photos_select`, `tb_photos_insert`, `tb_photos_update` (so a retried upload can overwrite its own file). No delete policy: photos are never deleted (no hard delete). The catalogue snapshot before and after must show only the bucket, these three policies and the 0005 changes. Built in project `travelboard`, after 6.8.
- 0007 (added 24/10/26, after 0005 and 0006 were applied), `travel` and `public.tb_*` only: `alter table travel.captures add photo_to_claude boolean not null default true`. Replace `tb_capture_upsert` so it carries the field. Replace `tb_journal_turn` so it returns `photo_path` only where `photo_to_claude` is true (null otherwise), so a switched-off photo never reaches `tb-journal` at all. `tb_captures_since` returns whole rows, so it carries the field unchanged. Catalogue snapshot before and after.

### 7A.2 Client

- **Capture screen:** a Photo button next to the kind toggle opens a small sheet with Camera, Gallery and Cancel. Camera opens the rear camera (`<input type="file" accept="image/*" capture="environment">`); Gallery opens the Android photo picker (`<input type="file" accept="image/*">`). On the edit screen the same button reads Replace and opens the same sheet. One photo per capture. The photo shows as a preview above the textarea with a Remove control and a "Claude sees this" switch, default on. The switch shows only when a photo is attached. Save is enabled when the trimmed body is non-empty or a photo is attached, so a photo-only capture is fine.
- **Shrink on the phone:** decode with `createImageBitmap(file, { imageOrientation: 'from-image' })`, draw to a canvas at 1280 px on the long edge (smaller images kept as they are), `toBlob('image/jpeg', 0.82)`. Target about 200 to 300 KB. Re-encoding drops EXIF, which is intended: place comes from the capture's own GPS.
- **Time and place:** the capture's `captured_at`, `tz`, `local_date` and GPS are those of attaching, as for any capture. A gallery photo taken earlier gets the attaching time. Reading the photo's own taken-at time and place is deferred (section 9).
- **IndexedDB v3:** new store `photos`, keyPath `id` (the capture id), value `{ id, blob, w, h, bytes, uploaded }`. Captures carry `photo_to_claude` (true when absent). The draft keeps its photo and the switch too (draft id `new` or the capture id), so a force-close after attaching restores the photo with the text.
- **Rows:** a small square thumbnail on the capture row when a photo exists, from the local blob. Tapping the row opens the edit screen with the full preview. If a pulled row has `photo_path` but no local blob (reinstall), download it once when online, as the user, and keep it in `photos`.
- **Edit:** a photo can be added, replaced or removed, and its switch turned on or off; a change to the switch bumps `updated_at` and marks the capture dirty like any edit. A turn already sent has seen the photo or not; the switch applies from the next turn. Remove sets the four photo fields null and bumps `updated_at`; the file stays in Storage. Replace uploads to the same path.
- **Export:** unchanged JSON, now with the four photo fields and `photo_to_claude`. Photos are not embedded.

### 7A.3 Sync

- Before pushing a capture, upload its photo if `uploaded = 0`: `storage.from('tb-photos').upload(path, blob, { upsert: true, contentType: 'image/jpeg' })`. On success set `uploaded = 1`, fill `photo_path`, `photo_w`, `photo_h`, `photo_bytes` on the capture, bump `updated_at`, mark dirty. A capture never carries a `photo_path` the server cannot serve.
- A failed upload leaves the photo queued while the capture row is still pushed without `photo_path`, so text and GPS are never held back by a photo. The pill counts queued photos with queued captures.
- Uploads go one at a time, smallest first, each with the 20 s fetch timeout. Same triggers, lock and retry as 6.6.

### 7A.4 Journal (`tb-journal` changes to 8.3 steps 4 to 6)

- Load the day's non-deleted captures with a `photo_path` and `photo_to_claude` true, most recent 30 (changed from 20 on 24/10/26). Download each as the user (the function already acts as the user through the JWT) and send it as a base64 image block, labelled with its capture's local time, kind and text.
- Place the captures context and the images in a block before the thread, with a prompt-caching breakpoint after the last image, so later turns that evening read the images from cache. The breakpoint keeps for 1 h, not the default 5 min, because turns in an evening are often more than 5 min apart; the first write costs about 2x a normal read of the same tokens instead of 1.25x. The system prompt is `prompts/journal.md` alone.
- More than 30 switched-on photos in a day: the rest are listed as text ("photo at 1421 hrs, not shown") so Claude knows they exist.
- A switched-off photo is not sent, not listed and not mentioned. Its capture's time, kind, text and place go to Claude as for any capture, with no sign that it had a photo.
- A photo that fails to download is listed as text ("photo at 1421 hrs, could not be loaded") and the call still goes ahead.
- Store `cache_write_tokens` and `cache_read_tokens` per reply.

### 7A.5 Cost

Sonnet 5.5 reads images at high resolution: a 1280 x 960 photo is ceil(1280/28) x ceil(960/28) = 46 x 35 = 1,610 tokens. At USD 2 per million input tokens that is about USD 0.003 per photo per call uncached; cache reads are USD 0.10 per million. An evening with 15 photos over 10 turns is roughly USD 0.10 with caching, against about USD 0.50 without. The USD 30 cap is unchanged. (Docs read 23/10/26.) At the 30-photo cap the image block is about 48,000 tokens: the first turn of an evening writes it to the 1 h cache for about USD 0.19, each later turn reads it for under USD 0.01. Changing a switch or adding a photo mid-evening rewrites the cache once.

### 7A.6 M1.1 acceptance

1. Airplane mode: a camera photo attached to a capture saves at once and shows its thumbnail. On reconnect the file lands at `tb-photos/<uid>/<id>.jpg`, at most 1280 px on the long edge and under 500 KB, and the row has `photo_path` and the size fields.
2. A gallery photo works the same way.
3. A photo-only capture (no text) saves and syncs.
4. Force-close after attaching a photo, before Save: reopening restores the draft with the photo.
5. A capture whose photo upload fails still syncs its text and GPS, and the photo follows on a later sync (headless test; on the Pixel, observed if it happens).
6. Journal: asked about a photo, Claude describes something visible in it that the capture text does not say.
7. Second journal turn the same evening: `cache_read_tokens` above zero on the stored reply.
8. Anonymous access to a `tb-photos` object fails, and so does access to another user's folder (smoke test with a second synthetic uid inside a rolled-back transaction, plus a REST check).
9. Catalogue diffs for 0005, 0006 and 0007 in project `travelboard` touch only `travel.*`, `public.tb_*`, the bucket `tb-photos` and the three `tb_photos_*` policies.
10. `checks/static.cjs`, `checks/smoke.sql` and the M1 and M2 headless suites pass; a new M1.1 headless suite passes.
11. A photo with "Claude sees this" off never reaches Claude: `tb_journal_turn` returns no `photo_path` for it (smoke test) and `tb-journal` sends no image or mention of it (`fn.test.cjs`). With 31 switched-on photos in a day, 30 are sent as images and one is listed as text; switched-off photos on the same day do not count (`fn.test.cjs`). On the Pixel, the switch survives Save, edit and sync.

---

## 7B. M1.2 Two travellers (full)

Added 23/10/26 on Gary's decision (D16); sharing model rewritten 24/10/26. Eric, Gary's travel companion, gets his own login on his own Android phone. Separate by default: each sees only his own captures and journals. Each can add the other in the app; the link is live only when both have added, and either can remove it. While linked, each capture carries a "Share with Eric" (or "Share with Gary") switch, default on; a shared capture, photo included, appears on the other's phone, labelled and read-only. Journal threads stay private to their owner. Built after M1.1 passes. Cut-off 05/11/26 (was 31/10/26): the two-phone test runs on the M1.3 design, so Eric's first look is the final one. If it is not passing on both phones by then, Gary pilots Bangkok alone and M1.2 follows the trip.

### 7B.1 Accounts (Gary, dashboard)

- In project `travelboard`, Auth: add `eric@travelboard.local`, auto-confirmed, strong password. Gary hands it to Eric in person; it never goes into a chat or a file.
- Eric installs travelboard from the same link on his Android phone and sets up Gboard voice the same way (D10).

### 7B.2 Schema (migration 0008, after M1.1's 0005 to 0007)

- `travel.people (uid uuid primary key references auth.users(id), display_name text not null, journal_prompt text not null)`. Rows: Gary (`journal`), Eric (`journal-eric`).
- `travel.partner_adds (adder uuid references auth.users(id), added uuid references auth.users(id), added_at timestamptz not null default now(), removed_at timestamptz, primary key (adder, added), check (adder <> added))`. One row per direction. The link between two people is live when both directions exist with `removed_at` null. Removing sets `removed_at`; adding again clears it.
- `alter table travel.captures add shared boolean not null default false`. Every existing row stays unshared.
- `public.tb_linked(p_other uuid) returns boolean`: true when the link between `auth.uid()` and `p_other` is live. `SECURITY DEFINER`, same guardrails as the other RPCs, executable by `authenticated`.
- `tb_partner_add(p_uid uuid)` and `tb_partner_remove(p_uid uuid)`: set or clear the caller's own direction only; `p_uid` must be a row in `people` other than the caller.
- `tb_whoami` also returns the caller's `display_name`, the other people (uid, name) and, for each, the link state: none, added by me, added me, or live.
- Own rows: `tb_captures_since` returns the caller's own rows as now, each with `owner` and the new `shared`. `tb_capture_upsert` and `tb_captures_upsert` carry `shared`; a row whose existing `owner` differs from the caller is still rejected, so nobody can edit or delete the other's captures.
- Partner rows: `tb_partner_captures()` returns every capture currently visible to the caller from others: `shared` true, not deleted, and owner linked live. Each with `owner_name`. Full set, no cursor: a trip's shared rows are a few hundred text rows, and a full set makes unsharing, unlinking and relinking need no special handling. Photo files are fetched once by path, so the set stays cheap.
- `tb_journal_turn` returns the day's non-deleted captures of the caller plus those visible to the caller from a live partner, each with `owner_name`. `photo_path` only where the owner's `photo_to_claude` is true (7A.1). Journal rows themselves stay owner-only; no RPC returns another person's thread.
- Storage: replace `tb_photos_select` so it admits the caller's own folder, or `public.tb_can_read_photo(name)`: a definer function, true when `name` is the `photo_path` of a capture that is shared, not deleted, and whose owner is linked live to the caller. An unshared photo in a partner's folder stays unreadable. Insert and update stay own folder only.
- Catalogue snapshot before and after, as for every migration.

### 7B.3 Client (the release after M1.1's last)

- **Partner panel** (in the pill panel): lists the other people from `tb_whoami` with Add or Remove, and the state in words: "You added Eric. Waiting for Eric to add you", "Eric added you. Add him to link", "Linked with Eric". Add and Remove need a connection; they are not queued.
- **Share switch:** on the capture and edit screens, "Share with Eric" (or Gary), shown only while linked. Default on for a new capture made while linked; captures made while not linked are saved with `shared` false and stay unshared unless switched on later in edit. Changing it bumps `updated_at` and marks the capture dirty like any edit. The draft keeps it.
- **Partner rows:** IndexedDB keeps partner captures as read-only mirrors with `owner` and `owner_name`; only the device user's own rows can be dirty. Each sync, after pulling own rows, call `tb_partner_captures()` and replace the mirror with the result; a partner row no longer in the set is removed from the phone along with its cached photo. Partner photos are downloaded when online and kept locally like own photos (7A.2), so they show offline.
- **Day view:** own and partner captures together, newest first. Partner rows carry a small name label. Tapping one opens a read-only view (text, photo, time, place); no Edit, no Delete, no switches.
- The pill and queue counts cover own rows only.
- Export: own captures plus partner captures on the phone, with `owner_name` and `shared`.
- Journal tab is unchanged in shape: the device user's own threads only.
- **Change password** (in the pill panel, both users; added 24/10/26): the new password typed twice, at least 10 characters, set with `supabase.auth.updateUser({ password })` as the signed-in user. Needs a connection; not queued. Shows success or the server's own error. No server, migration or RPC change. If the project's "secure password change" setting makes the server ask for reauthentication, the error is shown and nothing works round it. A forgotten password stays a reset by Gary in the dashboard (no email: the addresses are synthetic).

### 7B.4 Journal

- `tb-journal` picks the system prompt from `travel.people.journal_prompt`: `prompts/journal.md` for Gary, `prompts/journal-eric.md` for Eric. The Eric file starts as the Gary file with everything specific to Gary taken out and his name in its place; Eric tunes it later.
- The context block lists the day's own captures and those shared with the caller by a live partner, each labelled with whose it is, and includes switched-on photos from both (most recent 30 in total, 7A.4). A capture its owner has not shared reaches neither the partner's phone nor the partner's journal. The owner's "Claude sees this" switch holds in both threads.
- Same model, limits and caching as M2 and 7A. Both people draw on the one `travelboard` workspace (USD 30 a month). Token counts stay per reply, so usage splits by person with one query.

### 7B.5 M1.2 acceptance

1. Not linked: Eric signs in on his Android phone and sees only his own captures; Gary sees only his. `tb_partner_captures()` returns nothing (smoke test).
2. Linking: Gary adds Eric; nothing is shared and Gary's panel reads "Waiting for Eric to add you". Eric adds Gary; both panels read "Linked".
3. While linked, a new capture has "Share with" on by default. It appears on the other phone after his next sync, labelled and read-only, photo included, and shows offline after one online sync.
4. A capture with "Share with" switched off never appears on the other phone. Switching an already shared capture off removes it, and its photo, from the other phone at his next sync.
5. Captures made before linking stay unshared unless switched on in edit.
6. Neither can edit or delete the other's capture: no controls in the app, and the RPC rejects it (smoke test).
7. Storage (smoke test with synthetic uids in a rolled-back transaction, plus a REST check): a linked partner can read a shared photo; cannot read an unshared photo in the same folder; cannot write the other's folder; a third uid reads nothing; after the link is removed, the shared photo is refused too.
8. Removing the link from either side: the other's captures disappear from both phones at their next sync. Adding again shows the captures that are still shared.
9. Neither can read the other's journal thread (smoke test on the RPCs, and nothing in either app).
10. Eric's journal uses his prompt, and on a day with captures from both, his reply can refer to one Gary shared by content. A capture Gary did not share is absent from the request to Claude (`fn.test.cjs`).
11. An airplane-mode capture on Eric's phone syncs on reconnect and, shared, appears on Gary's phone after his next sync.
12. `checks/static.cjs`, `checks/smoke.sql` and the M1, M1.1 and M2 headless suites pass; a new M1.2 headless suite passes.
13. Change password: Eric changes his password on his phone, signs out, and signs back in with the new one; the old one is refused.

## 7C. M1.3 Look and place (full)

Added 24/10/26 on Gary's decision (D17). The phone app gets its own visual identity, a field notebook, on every screen, plus two small features that the new layout needs: a place name on each capture, and an editable journal prompt per person. Built in two sessions after M1.2's build (7C.6). M1.2's two-phone test runs on the result.

### 7C.1 Identity

- **Mood: field notebook.** Warm paper ground, ink-dark type, faint ruled lines, stamp-style labels for kind and time. Dark mode is a night page (deep ink-blue paper, not black) and is designed in full, not derived.
- **Type:** a serif for screen and day titles and other headings, Plex Sans for body and UI. The serif is OFL-licensed, Latin subset, vendored as woff2 like Plex (rule 5). Weights limited to what the mockup uses.
- **Colour:** stamp-ink red-terracotta as the accent and ink blue as the second colour, replacing the orange. Status colours (synced, queued, sign in, offline, error) stay distinct from the accent. Contrast at least WCAG AA for text in both themes.
- **Hierarchy:** three levels on every screen: what the screen is, what each item is, its detail. Size, weight and colour carry it, not boxes.
- **Exact tokens** (colours, type scale, spacing, radii) are taken from the mockup Gary approves (7C.8) and written into `trip.html`'s `:root` sets under weatherboard's token names where they exist.

### 7C.2 Screens

- **Header and pill:** serif app or day title; the sync pill restyled as a stamp, same states and wording.
- **Day view:** the day title in the serif with its date. Each row leads with time (stamp-style, 24-hour) and place (7C.4), then the text, then the photo as a small framed print. No kind label (7C.2a). A thin timeline spine joins the day's rows. Partner rows (7B.3) keep their name label and read-only view. Ruled hairlines separate rows; no cards.
- **Capture and edit:** a paper sheet with no Note/Journal toggle (7C.2a). Place field with its chips (7C.4) under the time; ruled textarea; photo attached as a print with Remove; the switches ("Claude sees this", "Share with") grouped together at the foot. Save stays in thumb reach.
- **Journal:** the day's thread as a notebook page, holding only the person's turns and Claude's replies. Turns and replies are told apart by a margin rule and type face (replies in the serif), not chat bubbles. Day list in the serif. The Write button and its separate composer go: a text field sits at the foot of the screen with Send beside it; tapping it opens the keyboard (and Gboard voice), the field grows with the text, and the draft is kept per day as now. Share unchanged.

### 7C.2a Capture kinds retired (24/10/26)

- Every capture is just a capture. The Note/Journal toggle and the kind label on rows go. New captures save `kind = 'note'`; the column and its check stay, and existing `journal` rows are kept as they are and shown like any other capture. No migration.
- The journal thread no longer quotes journal-kind captures inline. What Claude sees is unchanged: every non-deleted capture of the day, own and shared with you, with photos as switched (7A.4, 7B.4). `tb-journal` stops labelling captures by kind.
- Share text and export keep `kind` for old rows; the client stops showing it.
- **Panels:** the pill panel, partner panel, Change password and the prompt editor (7C.5) in the same paper style.

### 7C.3 Rules for the redesign

- No behaviour changes beyond 7C.2 (inline journal field), 7C.2a, 7C.4 and 7C.5. Tests that check the removed Write composer, the kind toggle or inline journal captures are rewritten to the new behaviour, as deliberate changes. Sync, drafts, queues, switches and the 0400 day rule are untouched.
- The M1, M1.1, M2 and M1.2 headless suites stay the regression guard. Keep their hooks (ids, data attributes, roles). Where a suite asserts on copy or structure that the design changes, update the assertion and keep the behaviour it checks; never weaken a check to pass.
- Tap targets at least 44 px. One-handed: primary actions at the bottom.
- UI copy: dates dd/mm/yy, times 24-hour (0901 hrs), SI units, no em dashes.
- Bump the service worker version on each release (rule 9).

### 7C.4 Place names (migration 0009)

- 0009, `travel` and `public.tb_*` only: `alter table travel.captures add place_name text check (place_name is null or char_length(place_name) between 1 and 120)`. Replace `tb_capture_upsert` and `tb_captures_upsert` so they carry it. `tb_captures_since` and `tb_partner_captures` return whole rows, so they carry it unchanged. Replace `tb_journal_turn` so each capture carries `place_name`. Catalogue snapshot before and after.
- **Display:** a row shows `place_name` if set, otherwise the coordinates to 4 decimals (`13.7380, 100.5601`), otherwise "no GPS". Partner rows show the owner's name.
- **Editing:** tap the place on the capture or edit screen to type a name; clearing it returns to coordinates. Works offline; bumps `updated_at` and marks the capture dirty like any edit. Only the owner can name his capture.
- **Chips, never auto-filled.** With GPS, the place field offers up to three one-tap chips, own names first:
  1. **Your names:** distinct `place_name`s on your own captures within 75 m, nearest first, from IndexedDB. Works offline.
  2. **Map suggestion:** when online, the nearest named place from OpenStreetMap Nominatim's reverse endpoint (`format=jsonv2`, `zoom=18`, `accept-language=en`), called from the phone. At most one request per second; cached in IndexedDB by position rounded to about 50 m, so a place is looked up once. Network only, never cached by the service worker. A small "© OpenStreetMap contributors" credit shows under the chip. If the lookup fails or returns nothing, no chip.
  - A capture saved offline gets its map chip when opened later with signal. Accepting a chip sets `place_name` to its text; nothing else is stored from OSM.
- **Journal:** `tb-journal` labels each capture with its place name when set, and coordinates otherwise.
- **Export:** includes `place_name`.

### 7C.5 Editable journal prompt (migration 0009)

- Same migration: `alter table travel.people add journal_prompt_custom text check (journal_prompt_custom is null or char_length(journal_prompt_custom) between 1 and 4000)`.
- `tb_prompt_get()` returns the caller's `journal_prompt` key and `journal_prompt_custom`. `tb_prompt_set(p_text text)` sets the caller's own custom text; null resets to default. Same guardrails as every RPC (rule 3); the caller's own row only.
- `tb-journal` uses the caller's `journal_prompt_custom` when set, otherwise the bundled `prompts/<journal_prompt>.md`. The day's captures and photos stay in the separate context block, so an edit cannot remove them.
- **Client:** "My journal prompt" in the pill panel. Opens the current text: the custom text, or the default fetched from `prompts/<key>.md` on the live site. Save, Cancel, and Reset to default. Character count against 4,000. Needs a connection; not queued. Takes effect from the next journal turn.
- Editing the prompt breaks that evening's prompt cache once; no other cost.

### 7C.6 Sessions

| Session | Builds | Ends when |
|---|---|---|
| A | Migration 0009 (7C.4 and 7C.5 schema and RPCs), `tb-journal` place names and custom prompt, tokens and type (7C.1), header, day view, capture and edit (7C.2), place field and chips | Deployed, automated checks pass, Gary's Pixel steps for A written |
| B | Journal, pill and partner panels, Change password, prompt editor (7C.2, 7C.5 client); rewrite M1.2's device steps in TESTS.md for the new UI | Deployed, automated checks pass, the combined M1.2 and M1.3 steps for both phones written |

Run one after the other: both change `trip.html`.

### 7C.7 M1.3 acceptance

1. Every screen matches the approved mockup in light and dark, on the Pixel and on Eric's phone.
2. A capture with GPS shows coordinates until named; naming it offline syncs on reconnect and shows on the partner's phone when shared.
3. Near a place you have named before, a new capture offers that name as a chip, offline.
4. Online at a named place (for example Tampines Mall), the map chip offers its name with the OSM credit; tapping it fills the field; nothing is filled without a tap.
5. A second capture at the same spot uses the cached lookup (no second Nominatim request, headless test).
6. Journal: Claude refers to a capture by its place name.
6a. The capture screen has no kind toggle; the journal thread shows no quoted captures; a turn typed in the inline field at the foot sends with one tap and gets one reply, and an unsent draft survives a force-close.
7. Each of you edits his prompt, the next reply follows it, and Reset to default restores the file text. Neither can read or set the other's prompt (smoke test).
8. Catalogue diff for 0009 touches only `travel.*` and `public.tb_*`.
9. `checks/static.cjs`, `checks/smoke.sql`, `fn.test.cjs` and the M1, M1.1, M2 and M1.2 headless suites pass; a new M1.3 headless suite covers 7C.4 and 7C.5.

### 7C.8 Approved mockup and tokens (24/10/26)

Approved by Gary 24/10/26: the Design canvas "travelboard field notebook" (claude.ai, private to Gary), source copied to `design/m1.3/` in this repo. Session A works from those files and these values.

**Colour tokens** (light, then dark):

| Token | Light | Dark | Use |
|---|---|---|---|
| `--ground` | `#F4EEE2` | `#141C26` | Page (paper / night page) |
| `--surface` (sheet) | `#FBF8F1` | `#1B2531` | Capture sheet, Settings sheet, inputs |
| `--ink` | `#1F2A36` | `#ECE6DA` | Text |
| `--muted` | `#5E6670` | `#A3ACB6` | Secondary text, coordinates, labels |
| `--line` (rule) | `#D9CFBD` | `#2C3846` | Hairlines, spine, borders |
| `--ruled` | `#E4DBCB` | `#28333F` | Ruled lines in the capture textarea, every 32 px |
| `--accent` | `#B4472A` | `#E07A55` | Stamp terracotta: times, primary buttons, own turns, Claude-sees switch |
| `--accent-bg` | `#F3DDD2` | `#3A2620` | Accent tint |
| `--on-accent` | `#FFF8EE` | `#141C26` | Text on accent |
| `--blue` | `#2F5577` | `#8DB4D9` | Ink blue: Claude's replies, partner label and dot, own-name chips, Share switch |
| `--blue-bg` | `#DCE6EF` | `#1F3247` | Blue tint |
| `--good` / `--good-bg` | `#2E6B4A` / `#DDEBDF` | `#6FC596` / `#173025` | Synced stamp |
| `--warn` | `#8A5A00` | `#E2B355` | Queued |
| `--crit` | keep current | keep current | Error (must stay distinct from accent) |
| `--photo`, `--print` | `#C2B08F`, `#FFFDF8` | `#4A5566`, `#2E3946` | Photo placeholder and print border |

Text pairs pass WCAG AA in both themes (checked 24/10/26). Theme choice Light, Dark or Auto (Auto follows the phone).

**Type:** Newsreader (OFL; vendor 500, 600 and italic 500, Latin subset, woff2) for the wordmark (italic 500, 20 px), screen titles (600, 28 px), day titles (600, 34 px, tracking -0.01em), tab labels (18 px) and Claude's replies (17.5 px, line height 1.5). IBM Plex Sans 400, 500, 600 for everything else: place 17 px 600 (coordinates 500, muted, tabular figures), body 15 px, inputs 16 to 17 px, time stamp 16 px 600 tabular with "hrs" 11 px caps below, section labels 11 px 600 caps with 0.12em tracking.

**App icon (option B, chosen 24/10/26):** a ruled notebook page (`#F4EEE2`, lines `#D9CFBD`, faint accent margin line) tilted -6deg on an ink ground `#1F2A36`, with a terracotta `#B4472A` map pin and a paper-coloured hole, as drawn in `design/m1.3/Icons.dc.html` (100-unit grid). Everything sits inside Android's maskable safe circle (radius 40% of the canvas), so the maskable file is the same art on a full-bleed ground. Built in session B: `icons/icon-192.png`, `icon-512.png`, `icon-maskable-512.png` and the shortcut icon regenerated from it; manifest paths unchanged.

**Shapes and sizes:** side gutter 20 px (footer 16 px); sync pill as a stamp (1.5 px border, radius 4 px, rotated -2deg, caps 12 px); primary buttons 54 px high, radius 10 px; chips 36 px high, radius 18 px (own names solid blue, map suggestion dashed accent); photo prints with a 4 to 5 px `--print` border, a small shadow and a 1.5 to 2 deg tilt; Settings as a bottom sheet with a grabber, radius 14 px; rows separated by hairlines, no cards; day rows: 52 px time column, 26 px spine column with a 9 px dot (accent own, blue partner).

---

## 8. M2 Journal with Claude (full)

### 8.1 Shape

One thread per local day, mirroring Gary's date-titled journal chats. The journal works online only; offline, a message queues and sends on reconnect rather than failing. Street capture (M1) is offline; evening journalling at the hotel is online. Different times, different network needs, one app.

The edge over journalling in the Claude app is that this Claude has the trip loaded: the day's captures go into every call. Without that context the feature has no reason to exist.

### 8.2 Schema (migration 0003)

```sql
create table travel.journal_messages (
  id            uuid primary key,                -- generated on the phone for user turns, server for replies
  owner         uuid not null references auth.users(id),
  local_date    date not null,
  role          text not null check (role in ('user','assistant')),
  content       text not null,
  reply_to      uuid,                            -- assistant row -> the user row it answers
  model         text,
  input_tokens  int,
  output_tokens int,
  created_at    timestamptz not null,
  server_ts     timestamptz not null default now()
);
create unique index journal_one_reply on travel.journal_messages (reply_to) where role = 'assistant';
create index journal_owner_day on travel.journal_messages (owner, local_date, created_at);
```

Day titles: an optional free-text suffix per day lives in `travel.journal_days (owner, local_date, suffix)`, primary key `(owner, local_date)`.

Both tables get RLS enabled and no grants, like `travel.captures` (6.2). Migration 0003 is wrapped in a transaction.

Thread order: each user turn by `(created_at, id)`, its assistant reply straight after it. The server, the function and the client all use this order, so a reply written later never lands after a newer user turn.

Client RPCs (migration 0004): `tb_journal_day(p_local_date date)` returns the thread; `tb_journal_days(p_limit int)` lists days with message counts and the latest `server_ts`, so the client re-fetches only days that changed; `tb_journal_day_suffix(p_local_date, p_suffix)` sets the title suffix.

Function RPCs (migration 0004, Gary's decision 10/10/26): `tb-journal` reaches the database as the signed-in user, never with a service key. It forwards the caller's JWT and calls two more `tb_` RPCs with the same guardrails as the rest (rule 3 of `CLAUDE.md`): `tb_journal_turn(p jsonb)` does steps 2 to 4 of 8.3 in one call (upsert the user turn, return any stored reply, else the thread up to that turn and the day's non-deleted captures); `tb_journal_reply(p jsonb)` does step 7 (store the reply once per user turn; a second insert for the same turn returns the stored one). The client being able to call them too is accepted: they act only as the caller, and from M1.2 only on the caller's own thread.

### 8.3 Edge Function `tb-journal`

- `verify_jwt` on. Secret `TB_ANTHROPIC_API_KEY` set by Gary in the dashboard, holding a key from the Console workspace `travelboard`.
- Request: `{ local_date, message_id, content, created_at }`.
- Steps:
  1. Resolve the user from the JWT.
  2. Upsert the user message by `message_id` (idempotent).
  3. If an assistant reply with `reply_to = message_id` already exists, return it without calling the API. Retries are free and never duplicate.
  4. Load that day's thread and that day's non-deleted captures (by `local_date`). From M1.1, also the day's photos (7A.4).
  5. Build the system prompt: `prompts/journal.md`, then a context block listing the day's captures with local time, kind, body and coordinates when present.
  6. Call the Anthropic Messages API: model `claude-sonnet-5-5` (verify the current string at docs.claude.com when building), `max_tokens` 1500, the full thread as messages, capped to the most recent 40 turns.
  7. Store the reply with `model`, token counts, `reply_to`.
  8. Return the reply.
- Errors return a clear message; the client keeps the user turn and offers Retry.

### 8.4 System prompt (`prompts/journal.md`, first draft to be tuned by Gary)

Covers: this is Gary's travel journal, its own lane; conversational and writing back, not a form; draws on the day's captures and places by name; one question at a time at most; no mood scales, prompts lists, streaks or guilt about gaps; plain prose, his date and time conventions; never invents what happened, asks instead.

The file is plain text in the repo so Gary edits it without touching code. The two-tier memory pattern (static contract plus a store of validated heuristics) is deferred to a later M2.1.

### 8.5 Client

- Journal tab: list of days (newest first), tap into a day's thread.
- Composer is the same big textarea as capture, so Gboard voice works identically.
- Send: write the user turn to IndexedDB with state `pending`, render it, call `tb-journal` if online. Offline, it stays `pending` and is sent by the sync engine on reconnect.
- The day defaults to today's local date. Captures tagged `journal` appear inline in that day's thread as quoted context.
- Detail agreed at build (10/10/26): Captures and Journal tabs sit in the header; the bottom button reads Capture or Write. A Days button lists every day with messages, captures or a title, plus today, newest first. Tapping the day title sets its suffix. The composer is the capture screen in a journal mode (Send instead of Save, no kind toggle), with a draft per day kept like capture drafts.
- Share (added 23/10/26, Gary's decision): a Share button on the journal bar sends the day on screen as plain text (title, every live capture with time, kind and coordinates, then the conversation in thread order) through the Android share sheet, or copies it where sharing is unavailable. It feeds Gary's daily journalling project in Claude on desktop.
- Sync order: push captures (so the function sees the latest notes), push day suffixes, send pending turns oldest first, pull captures, pull journal days whose message count or latest `server_ts` changed. A network failure or timeout (120 s) leaves a turn pending for the next sync; a 401 leaves it pending and asks to sign in; any other failure the function reports marks the turn "not sent" with its message and a Retry button, and stops that pass so later turns keep their order. A failed turn is never resent automatically.

### 8.6 Cost control

- Before first deploy: Console workspace `travelboard` in the org that holds `weather`, monthly spend limit USD 30, auto-reload off, its own key. Never weather's key.
- `max_tokens` 1500 and the 40-turn cap per call.
- Token counts stored per reply, so monthly usage is a SQL query away.

### 8.7 M2 acceptance

1. One real evening conversation in which Claude refers to at least two of that day's captures by content.
2. A message sent in airplane mode queues, sends on reconnect, and produces exactly one reply.
3. Retrying a message that already has a reply returns the stored reply without a second API call (check token rows).
4. The Anthropic key appears nowhere in the repo or client.
5. Spend limit confirmed set in the console on the `travelboard` workspace (USD 30, auto-reload off), and the key in `TB_ANTHROPIC_API_KEY` belongs to that workspace.

---

## 9. Skeletons: M3 to M8

Each skeleton is expanded to full spec before its module starts.

### M3 Trip model + planner.html
- **Purpose:** single source of truth for a trip, planned on the rig.
- **Data:** `trips`, `trip_days`, `items` (place, booking, entitlement, note, with day and optional time; hotels span check-in to check-out days), `places` cache (`place_id`, name, coordinates, address, per-weekday hours, `source`, `fetched_at`, `confidence`).
- **Key feature:** opening-hours validation against the weekday an item is scheduled on. Flag closed days and before-opening times at plan time. This is the single highest-value feature identified.
- **Also:** Places autocomplete and one-tap add via `tb-places` (Google key server-side; per-API quota caps set in Google Cloud on day one); route optimisation by brute force for 8 stops or fewer; `trip_id` and `place_id` on captures become live.
- **Fixtures:** Penang 07/08/26 to 10/08/26 and Bangkok 09/11/26 to 12/11/26 as seed data.
- **Open:** one-time Wanderlog export as seed data, yes or no.

### M4 Phone day view + lookup
- **Purpose:** kill the 15 minutes on the street.
- Morning pre-fetch of the day's places, hours, coordinates and notes into IndexedDB.
- Cached lookup under 2 s, offline. Plain-language line on top ("open till 1900, 600 m"), detail behind, source and age on every fact.
- Copyable address and coordinates for a Grab pin; deep link to Google Maps for navigation.
- Live query under 10 s: Claude with the trip already loaded, so it never asks which city.

### M5 Map + money
- Leaflet day map with the day's pins and own annotations. No offline tiles.
- Currency via Frankfurter (api.frankfurter.dev, free, no key). Caveats: ECB reference rates, not card or ATM rates; working-day updates around 1600 CET; about 30 currencies, VND and TWD not covered, so a fallback source is needed.
- Per-item expense capture: amount plus currency, converted at that day's rate, running trip total. No budgets or categories.

### M6 Bookings + entitlements
- Entitlement as its own type with used / unused state: breakfast inclusions, complimentary massage, spa discount, cinema seats, booking references.
- Email parsing: forward a confirmation, Claude extracts JSON, item lands in a review queue. Never silently inserted.

### M7 Reminders
- Google Calendar as the notification engine: timed events with alerts, which handles delivery, offline and timezone shifts. Avoids Android background execution entirely.
- **Open:** a dedicated travelboard calendar or the Life Shared calendar used with Eric.

### M8 Enrichment
- Overnight Apify runs over place IDs already chosen, cross-checking hours against Places and flagging disagreements.
- Measured 04/10/26 with `compass/crawler-google-places`: 28 s runtime for 10 restaurants with per-weekday hours, about USD 0.06; a street-level location returned zero results while reporting success; a name search returned the wrong branch (Penang Road Famous Teochew Chendul at Persiaran Bayan Indah, not Lebuh Keng Kwee). Hence plan-time only, by place ID.
- Runs need a per-run charge cap of at least USD 0.50 on this actor.

### Later, unscheduled
- Voice tier 2: in-app mic via Web Speech API with `processLocally: true` (Chrome 139+), feature-detected, language pack installed at first run.
- Voice tier 3: record audio to IndexedDB, transcribe later via a separate speech-to-text vendor (the Anthropic API does not take audio).
- Journal M2.1: two-tier memory (static contract plus validated heuristics).
- Photos: in-app photo captures done in M1.1 (7A). Still later: the photo's own taken-at time and place from EXIF, sharing photos in from Google Photos (POST share target handled by the service worker), more than one photo per capture.

---

## 10. Risks and open items

| Item | Detail | Owner / next step |
|---|---|---|
| Database size (own project) | travelboard's data is small (text rows plus photo paths); photos go to file storage, not the database. weatherboard's growth (381 MB of 500 MB on 23/10/26) no longer affects travelboard | Check sizes at the end of the shakedown |
| File storage | 1 GB free for travelboard alone; photos at about 250 KB each, so about 4,000 photos | Check bucket size after Bangkok |
| Project pausing | A free project with no activity pauses; travelboard has no cron | Keep-alive workflow (6.8 step 5); check it is green before flying |
| Offline is new skill | No prior service worker or IndexedDB work | M0 is deliberately the smallest possible surface for it |
| Gboard on foreign names | Lebuh Keng Kwee, Teluk Bahang and similar will be mangled | Accepted. Transcripts are for Gary; never parsed |
| Offline voice | Voice only works offline with Gboard plus the on-device English pack (Settings, System, Languages, Speech, On-device recognition). SwiftKey's voice needs a connection | Gary: Gboard as the keyboard for the trip; check dictation in airplane mode before flying |
| Offline testing on the Pixel | Android sometimes turns Wi-Fi back on during airplane mode, even with "Turn on Wi-Fi automatically" off | Check the pill reads "offline" before relying on an offline result |
| Google billing | No hard cap by default | Per-API quota caps on day one of M3 |
| M7 calendar choice | Dedicated vs Life Shared | Decide at M7 |
| Wanderlog seed | Export past trips or not | Decide at M3 |
| App icon | Needed for M0 install | Simple generated icon is fine for M0 |

---

## 11. Testing regime

- `checks/static.cjs`: parses every inline script in the HTML files, validates `manifest.webmanifest`, checks the `sw.js` precache list against files on disk, fails on any `service_role` string in static files.
- `checks/smoke.sql`: run through the Supabase connector after each migration. Anonymous calls rejected, idempotent upsert, last-write-wins ordering, pull cursor behaviour.
- `checks/headless/`: `m1.test.cjs` and `m2.test.cjs` drive `trip.html` in headless Chromium against `harness.cjs`, a mock of the `tb_*` RPCs that mirrors migrations 0002 and 0004 and of `tb-journal`. Run both before every release that touches the client or the sync engine. `fn.test.cjs` runs the real `tb-journal` under Deno against local fakes of PostgREST and the Anthropic API; run it before every deploy of the function. Its one dev dependency (Playwright, pinned in its `package.json`) is never committed or shipped (set `TB_CHROMIUM` to an installed Chromium when Playwright's own build is not available); `static.cjs` scans these files for secrets like every other file.
- `TESTS.md`: the acceptance lists above as numbered manual steps, run on the Pixel, results dated.
- A module is done when its acceptance list passes. No mutation testing.

## 12. Change log

- 24/10/26 7C.4, 7C.2, 7C.8, 4.2: details settled at the M1.3 session A build (no change to what Gary decided). 0009 replaces `tb_capture_upsert` and `tb_journal_turn`; `tb_captures_upsert` is not replaced because it passes each item to `tb_capture_upsert` unchanged, so it carries `place_name` as it is (smoke U10). A row pushed without `place_name` (an app before v11) keeps the stored name; a blank name is stored as null. A new capture takes a position at open for its chips only when location is already granted, so the permission prompt still comes at the first Save (7.2); the capture's coordinates still come from the fix at Save. Own-name chips show their distance; names differing only in case count as one; three own names in range mean no map lookup. A failed lookup is not cached; an empty answer is. The "sign in" stamp is ink blue, so no status uses the accent. Rows: a synced row shows no sync label, a queued row keeps a queued stamp; the city of a capture made in another zone follows its place. The day title's line reads the day's main city and its count. The Photo button keeps reading Replace once a photo is attached (7A.2). Newsreader is vendored as the three static files named in 7C.8. IndexedDB version 5 adds store `geocache`. Headless suite `m13.test.cjs`; `checks/catalogue_scoped.sql`.
- 24/10/26 7C.8: app icon option B (notebook page and pin) chosen by Gary; built in session B. Source in `design/m1.3/Icons.dc.html`.
- 24/10/26 7C.8: Gary approved the M1.3 mockup. Tokens, type and sizes pinned; mockup source in `design/m1.3/`.
- 24/10/26 7C.2, new 7C.2a, 7C.3, 7C.7 item 6a: Gary's decisions on the mockups. Capture kinds retired in the UI (no toggle, no label, journal captures no longer quoted in the thread; data kept, no migration). Journal Write button replaced by an inline field with Send at the foot of the screen.
- 24/10/26 Status, D16, new D17, principles 7 and 9, 5, 7B intro, new section 7C: Gary's decisions. M1.3 Look and place before Bangkok: field-notebook redesign of every screen (serif headings, Plex body, terracotta and ink blue, both themes in full), editable `place_name` with own-name chips within 75 m and OpenStreetMap Nominatim chips when online, never auto-filled; editable journal prompt per person. Migration 0009. Two sessions after M1.2's build. M1.2's cut-off moves to 05/11 so its two-phone test runs on the new design; freeze moves from 01/11 to 06/11.
- 24/10/26 7B.2, 7B.4, 4.2, 11: details settled at the M1.2 build (no change to what Gary decided). 0008 adds `tb_link_state(p_other)` (the four link states, used by `tb_whoami`, `tb_partner_add` and `tb_partner_remove`); `tb_can_read_photo` returns false rather than raising without `auth.uid()`, because it runs inside a Storage policy; `tb_photos_select` is changed with `alter policy`, not dropped. `tb_journal_turn` also returns `me` (display name and prompt key) and `own` per capture, so `tb-journal` picks the prompt and labels whose each capture is. `prompt.ts` bundles every `prompts/*.md` by file name. Eric's prompt is Gary's with Eric's name in place of Gary's, conventions line included (Gary, 24/10/26; Eric tunes it later). Client v10: the other person's captures sit in their own IndexedDB stores (`partner`, `pphotos`), so they can never be pushed. Headless: `m12.test.cjs` runs two phones on one mock.
- 24/10/26 7B.3, 7B.5 item 13: Change password in the pill panel for both users (Gary's decision): typed twice, at least 10 characters, `updateUser` as the signed-in user, needs a connection, shows success or the server's error; no server change; a forgotten password stays a dashboard reset by Gary.
- 24/10/26 7A.2: correction agreed with Gary after the v8 Pixel run. A plain `accept="image/*"` input opens the Google Photos picker on the Pixel, which has no camera, so "the Android chooser: camera or gallery" does not hold. Photo now opens a sheet with Camera (`capture="environment"`) and Gallery (the plain input). Client v9.
- 24/10/26 D16, 5, 7B: M1.2 sharing model rewritten on Gary's decision, before the M1.2 build. Separate by default; each adds the other in the app and the link is live only when both have; per-capture "Share with" switch, default on while linked; captures from before linking stay unshared; unsharing or unlinking removes rows and photos from the other phone at the next sync. Schema: `travel.partner_adds` replaces `travel.partners`, `captures.shared`, `tb_partner_captures()` as a full set, `tb_can_read_photo` per capture. Journals private as before.
- 24/10/26 D15, 7A.1, 7A.2, 7A.4, 7A.5, 7A.6 item 9 and new item 11, 7B.2, 7B.3, 7B.4: Gary's decision. Per-photo "Claude sees this" switch, default on, in migration 0007 (0005 and 0006 already applied); `tb_journal_turn` withholds the path of a switched-off photo. Photos to Claude per day raised from 20 to 30, counting switched-on photos only, combined across both travellers in M1.2; switched-off photos have no limit. M1.2's migration becomes 0008 and its client the release after M1.1's last.
- 24/10/26 7A.1, 7A.4: corrections agreed with Gary at the M1.1 build. 0005 also replaces `tb_journal_turn` (returns `photo_path` per capture) and `tb_journal_reply` (stores the cache counts), which 7A.4 needs and 7A.1 did not name; `tb_captures_since` needs no replacement (it returns whole rows). The cache breakpoint keeps for 1 h. The day's captures move from the system prompt into the context block.

- 23/10/26 4.2, 6.8 steps 5 and 6, 11: move built. Keep-alive is an anonymous `rpc/tb_whoami` that must come back as Postgres's 42501 (travelboard has no anon-readable object, unlike weatherboard's `meta`); v6 reset detail (sent turns resent through `tb-journal`, failed turns left alone, session removed from storage directly). `checks/catalogue.sql` works where pg_cron is not installed and lists Storage buckets. Headless suites take `TB_CHROMIUM` to run against an installed Chromium.

- 23/10/26 D16, principle 9, 5, new section 7B, 6.6, 8.3 note: M1.2 Two travellers added for Bangkok on Gary's decision. Eric on his own Android login; all captures and photos shared; journal threads private; own journal prompt each. Built after M1.1, cut-off 31/10/26.
- 23/10/26 D3, 4 diagram, 4.1, 5, new 6.8, 6.7 item 7, 7A.1, 7A.6, 10: travelboard moves to its own Supabase project `travelboard` (ref `nnnnonspfljdkrxstslw`), Gary's decision after the shared `weatherboard` database reached 381 MB of 500 MB. The move comes before M1.1. Everything travelboard is then removed from `weatherboard` (inventory in 6.8 step 7) once the move passes on the Pixel, on Gary's yes.
- 23/10/26 Status, D4, D15, 4.1, 5, new section 7A, 8.3, 9, 10: M1.1 Photo capture added before Bangkok on Gary's decision (camera or gallery in the app, Claude sees the photos, cut-off 27/10). Storage bucket `tb-photos` and its `tb_photos_*` policies join the travelboard objects allowed in the shared project. Database size risk updated: 381 MB of 500 MB on 23/10/26.
- 23/10/26 Status, 8.5: M2 done (acceptance item 1 on the 23/10/26 thread). Share button on the journal bar (Gary's decision, before the shakedown freeze), so a day can go into his desktop Claude journalling project.
- 10/10/26 4.2, 8.5, 11: M2 client details agreed at build (tabs, day list, title suffix, composer mode, sync order and failure handling) written into 8.5; `tb-journal` file layout in 4.2; `m2.test.cjs` and `fn.test.cjs` in 11. No change to the acceptance list.
- 10/10/26 Status, 8.2: M2 started on Gary's go. 8.2 gains RLS on both journal tables, the canonical thread order, the latest `server_ts` per day in `tb_journal_days`, and two function RPCs (`tb_journal_turn`, `tb_journal_reply`) so `tb-journal` works as the signed-in user with no service key (Gary's decision; 8.3 named the steps but not how the function reaches the database).
- 10/10/26 D5, D11, 4 diagram, 4.1, 8.3, 8.6, 8.7: Anthropic billing and key for M2 (Gary's decision before the M2 go). Journal key comes from its own Console workspace `travelboard` (USD 30 monthly limit, auto-reload off) in the org that holds weather's `weather` workspace (USD 70); both share the USD 100 monthly subscriber API credit. Edge Function secret renamed `ANTHROPIC_API_KEY` to `TB_ANTHROPIC_API_KEY`, because secrets are project-wide in weatherboard. Model string `claude-sonnet-5-5` confirmed in the API model list on 10/10/26 (weather project).
- 10/10/26 4.2, 11: headless test harness committed under `checks/headless/` (Gary's decision), dev dependency pinned, no `node_modules` in the repo.
- 10/10/26 Status: M1 done. D10: Gboard with the on-device English pack; SwiftKey voice needs a connection. 7.1 Capture: one tap to raise the keyboard after a shortcut launch. Section 10: offline voice and Wi-Fi auto-on rows. From the M1 Pixel run.
- 04/10/26 7.1, 7.2: M1 design details agreed with Gary at the start of M1 written in (row layout and city suffix, date switcher, Close and Android back on the capture screen, draft keys and `open` flag, strictly increasing `updated_at`, GPS merge, share prefill dedupe and append, export fields). No change to the acceptance list.
- 04/10/26 Principle 8, 6.2, 7.2, 7.3 item 6: the local day rolls over at 0400, not midnight (Gary's decision at the start of M1). Principle 8 already said 0030 belongs to the evening, but 6.2 defined `local_date` as the plain calendar date, and the old acceptance item 6 could not tell Bangkok from Singapore (0030 BKK is 0130 SGT, the same date). No schema change; the column comment changes only.

- 04/10/26 6.6: "checking" status state, a reachability probe before each sync, and a 30 s retry while visible with rows queued or the dot offline. From the M0 Pixel test, where Chrome reported online in airplane mode with a VPN active.
- 04/10/26 6.4: `persist()` is also called on later launches while storage is not yet persistent.
- 04/10/26 Pull cursor changed from `server_ts` alone to the keyset `(server_ts, id)` in 6.3 and 6.6. `server_ts` is shared by every row in a batch transaction, so paging on it alone could skip rows at a page boundary.
- 04/10/26 Migration 0001 SQL in 6.2 now enables RLS on `travel.captures`, matching the 6.2 notes (the line was missing from the block).
- 04/10/26 First version. M0 to M2 full, M3 to M8 skeletons. Backend moved into the existing weatherboard project under a `travel` schema (separate project and separate organisation both considered and dropped). Repo name travelboard.
