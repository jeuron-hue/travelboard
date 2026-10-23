# travelboard: specification

Owner: Gary Chan. Repo: `jeuron-hue/travelboard` (public). Written 04/10/26.
Status: M0 Foundation done 04/10/26. M1 Capture done 10/10/26. M2 Journal done 23/10/26. M1.1 Photo capture in build from 23/10/26, cut-off 27/10/26.

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
| D3 | Backend in the existing Supabase project `weatherboard` (ref `nyjsrnntxdgfykkmihpx`, org `jeuron`, ap-southeast-1). All travelboard tables in a dedicated `travel` schema | 04/10/26 |
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
| D15 | Photo captures (M1.1): one photo per capture from the in-app camera or gallery, shrunk on the phone, stored offline first, synced to a private Supabase Storage bucket `tb-photos`. Claude sees the day's photos in the journal. Built before Bangkok with a cut-off of 27/10/26; if it is not passing on the Pixel by then, it ships after Bangkok | 23/10/26 |

## 3. Design principles

These bind every module.

1. **Capture never fails.** Write locally first, sync whenever. No network, no session, no GPS: the capture still saves.
2. **No fields at capture time.** Timestamp, timezone, GPS and kind are automatic. Sorting happens afterwards.
3. **Never auto-parse a transcript into structured fields.** Voice text goes in as text and stays as text.
4. **Latency budgets.** Cached lookup on the phone under 2 s, works offline. Live query under 10 s to a usable answer. A feature that cannot meet its budget does not ship in that path.
5. **Plain-language answer on top, detail behind.** Glanceable first, structure underneath, never one instead of the other.
6. **Every fact carries its source and its age.** Places hours, a blog post and a photo of the door sign are not equal. Unverified facts are flagged, not presented as fact.
7. **Store identity, not text.** A place is stored by `place_id` and coordinates from the source at add time, never by a typed address.
8. **Local day, not Singapore day, and the day ends at 0400.** The day is taken in the zone where the capture was made, and it rolls over at 0400 local, not midnight: a capture at 0030 hrs in Bangkok belongs to that Bangkok evening.
9. **Ugly is fine. Friction is not.** One user. Spend effort on taps saved, not polish.

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
Supabase project "weatherboard" (nyjsrnntxdgfykkmihpx)
  auth      one user, synthetic login
  public    tb_* SECURITY DEFINER RPCs  (the only client entry point)
  travel    tables (not exposed to the API)
  edge fn   tb-journal  (holds TB_ANTHROPIC_API_KEY)   [M2]
            tb-places   (holds Google key)          [M3]
  |
  v
Anthropic Messages API  [M2]      Google Places API  [M3]
```

### 4.1 Shared-project guardrails

The `weatherboard` project already runs the East Sky Board: 20 tables in `public`, a `prices` schema, five Edge Functions (`radar-archive`, `station-archive`, `frame-features`, `feeds-archive`, `frame-motion`), nine pg_cron jobs firing every 5 to 10 minutes, and a GitHub Actions keep-alive. It has no auth users. travelboard must never touch any of it.

- travelboard objects: schema `travel`, functions `public.tb_*`, Edge Functions `tb-*`, and from M1.1 the Storage bucket `tb-photos` with policies on `storage.objects` named `tb_photos_*` and scoped to `bucket_id = 'tb-photos'`. Nothing else.
- Storage is shared too: weatherboard already has a public bucket `radar` (14,013 objects, 57 MB on 23/10/26) with policy `radar_public_read`. travelboard never touches either. The free plan's 1 GB of file storage covers both buckets.
- Turning self-signup off in Auth settings is project-wide. Safe, because weatherboard uses no auth.
- Edge Function secrets are project-wide, so weatherboard's functions can read travelboard's secrets and the reverse. Accepted: both are Gary's. travelboard secrets carry a `TB_` prefix (`TB_ANTHROPIC_API_KEY`) so they can never collide with a weatherboard secret, for example if weather later moves its own Anthropic key into Supabase.
- Anthropic billing is shared too: weather's API twin and travelboard's journal draw on the same USD 100 monthly subscriber credit, in separate Console workspaces (`weather` capped at USD 70, `travelboard` at USD 30) so neither can starve the other.
- Keep-alive: weatherboard's cron activity keeps the project from pausing. Nothing extra needed.
- **Storage risk (see section 10):** the database was 237 MB of the 500 MB free cap on 04/10/26, mostly `public.station_obs` (142 MB) and `public.frame_cells` (43 MB), growing every 5 minutes.

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
  prompts/journal.md    journal system prompt, bundled into tb-journal at deploy
  supabase/
    migrations/         numbered SQL files, one per applied block
    functions/tb-journal/
      index.ts          the function
      context.mjs       system prompt and thread building, shared with the checks
      prompt.ts         generated from prompts/journal.md by bundle-prompt.cjs
  checks/
    static.cjs          parse inline scripts, validate manifest, sw cache list matches files
    smoke.sql           RPC and grant smoke tests
    headless/           Playwright tests of trip.html against an RPC mock (dev only, never shipped)
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
| M1.1 Photo capture | Photo on a capture (camera or gallery), offline first, Storage bucket `tb-photos`, photos in the journal | 24/10 to 27/10 | Section 7A acceptance passes on the Pixel by 27/10, or it moves to after Bangkok |
| Shakedown | Daily use in Singapore. Fixes only, no features (M1.1 is the one agreed exception, 23/10) | 26/10 to 01/11 | Freeze on 01/11 |
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
- Single user, so last-write-wins is the whole conflict policy.

### 6.7 M0 acceptance

1. `trip.html` installs from Chrome on the Pixel and opens standalone with its own icon.
2. With airplane mode on, the installed app opens and renders.
3. A dummy record written in airplane mode shows as queued; on reconnect it lands in `travel.captures` and the dot turns to synced.
4. Calling `tb_capture_upsert` twice with the same `id` yields one row; an older `updated_at` does not overwrite a newer one.
5. Anonymous calls to every `tb_` function fail. Direct REST access to `travel.captures` fails.
6. `checks/static.cjs` passes; `checks/smoke.sql` passes.
7. Nothing outside `travel`, `public.tb_*` and `tb-*` was created or altered (verify with a catalogue query before and after).

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

### 7A.1 Schema and storage (migration 0005, then 0006)

- 0005, `travel` and `public.tb_*` only: `alter table travel.captures add photo_path text, add photo_w int, add photo_h int, add photo_bytes int`. `photo_path` is `<owner uuid>/<capture id>.jpg`, null when there is no photo or it has not uploaded yet. Replace `tb_capture_upsert` and `tb_captures_since` so they carry the four fields; everything else in 6.3 is unchanged. Also `alter table travel.journal_messages add cache_write_tokens int, add cache_read_tokens int` for 7A.5.
- 0006, Storage: create bucket `tb-photos`, private, file size limit 2 MB, allowed type `image/jpeg`. Policies on `storage.objects` for role `authenticated` only, each with `bucket_id = 'tb-photos' and (storage.foldername(name))[1] = auth.uid()::text`: `tb_photos_select`, `tb_photos_insert`, `tb_photos_update` (so a retried upload can overwrite its own file). No delete policy: photos are never deleted (no hard delete). The catalogue snapshot before and after must show only the bucket, these three policies and the 0005 changes; `radar` and `radar_public_read` unchanged.

### 7A.2 Client

- **Capture screen:** a Photo button next to the kind toggle opens the Android chooser (`<input type="file" accept="image/*">`: camera or gallery). One photo per capture. The photo shows as a preview above the textarea with a Remove control. Save is enabled when the trimmed body is non-empty or a photo is attached, so a photo-only capture is fine.
- **Shrink on the phone:** decode with `createImageBitmap(file, { imageOrientation: 'from-image' })`, draw to a canvas at 1280 px on the long edge (smaller images kept as they are), `toBlob('image/jpeg', 0.82)`. Target about 200 to 300 KB. Re-encoding drops EXIF, which is intended: place comes from the capture's own GPS.
- **Time and place:** the capture's `captured_at`, `tz`, `local_date` and GPS are those of attaching, as for any capture. A gallery photo taken earlier gets the attaching time. Reading the photo's own taken-at time and place is deferred (section 9).
- **IndexedDB v3:** new store `photos`, keyPath `id` (the capture id), value `{ id, blob, w, h, bytes, uploaded }`. The draft keeps its photo too (draft id `new` or the capture id), so a force-close after attaching restores the photo with the text.
- **Rows:** a small square thumbnail on the capture row when a photo exists, from the local blob. Tapping the row opens the edit screen with the full preview. If a pulled row has `photo_path` but no local blob (reinstall), download it once when online, as the user, and keep it in `photos`.
- **Edit:** a photo can be added, replaced or removed. Remove sets the four photo fields null and bumps `updated_at`; the file stays in Storage. Replace uploads to the same path.
- **Export:** unchanged JSON, now with the four photo fields. Photos are not embedded.

### 7A.3 Sync

- Before pushing a capture, upload its photo if `uploaded = 0`: `storage.from('tb-photos').upload(path, blob, { upsert: true, contentType: 'image/jpeg' })`. On success set `uploaded = 1`, fill `photo_path`, `photo_w`, `photo_h`, `photo_bytes` on the capture, bump `updated_at`, mark dirty. A capture never carries a `photo_path` the server cannot serve.
- A failed upload leaves the photo queued while the capture row is still pushed without `photo_path`, so text and GPS are never held back by a photo. The pill counts queued photos with queued captures.
- Uploads go one at a time, smallest first, each with the 20 s fetch timeout. Same triggers, lock and retry as 6.6.

### 7A.4 Journal (`tb-journal` changes to 8.3 steps 4 to 6)

- Load the day's non-deleted captures with a `photo_path`, most recent 20. Download each as the user (the function already acts as the user through the JWT) and send it as a base64 image block, labelled with its capture's local time, kind and text.
- Place the captures context and the images in a block before the thread, with a prompt-caching breakpoint after the last image, so later turns that evening read the images from cache.
- More than 20 photos in a day: the rest are listed as text ("photo at 1421 hrs, not shown") so Claude knows they exist.
- A photo that fails to download is listed as text ("photo at 1421 hrs, could not be loaded") and the call still goes ahead.
- Store `cache_write_tokens` and `cache_read_tokens` per reply.

### 7A.5 Cost

Sonnet 5.5 reads images at high resolution: a 1280 x 960 photo is ceil(1280/28) x ceil(960/28) = 46 x 35 = 1,610 tokens. At USD 2 per million input tokens that is about USD 0.003 per photo per call uncached; cache reads are USD 0.10 per million. An evening with 15 photos over 10 turns is roughly USD 0.10 with caching, against about USD 0.50 without. The USD 30 cap is unchanged. (Docs read 23/10/26.)

### 7A.6 M1.1 acceptance

1. Airplane mode: a camera photo attached to a capture saves at once and shows its thumbnail. On reconnect the file lands at `tb-photos/<uid>/<id>.jpg`, at most 1280 px on the long edge and under 500 KB, and the row has `photo_path` and the size fields.
2. A gallery photo works the same way.
3. A photo-only capture (no text) saves and syncs.
4. Force-close after attaching a photo, before Save: reopening restores the draft with the photo.
5. A capture whose photo upload fails still syncs its text and GPS, and the photo follows on a later sync (headless test; on the Pixel, observed if it happens).
6. Journal: asked about a photo, Claude describes something visible in it that the capture text does not say.
7. Second journal turn the same evening: `cache_read_tokens` above zero on the stored reply.
8. Anonymous access to a `tb-photos` object fails, and so does access to another user's folder (smoke test with a second synthetic uid inside a rolled-back transaction, plus a REST check).
9. Catalogue diffs for 0005 and 0006 touch only `travel.*`, `public.tb_*`, the bucket `tb-photos` and the three `tb_photos_*` policies.
10. `checks/static.cjs`, `checks/smoke.sql` and the M1 and M2 headless suites pass; a new M1.1 headless suite passes.

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

Function RPCs (migration 0004, Gary's decision 10/10/26): `tb-journal` reaches the database as the signed-in user, never with a service key. It forwards the caller's JWT and calls two more `tb_` RPCs with the same guardrails as the rest (rule 3 of `CLAUDE.md`): `tb_journal_turn(p jsonb)` does steps 2 to 4 of 8.3 in one call (upsert the user turn, return any stored reply, else the thread up to that turn and the day's non-deleted captures); `tb_journal_reply(p jsonb)` does step 7 (store the reply once per user turn; a second insert for the same turn returns the stored one). Single user, so the client being able to call them too is accepted.

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
| Shared database size | 237 MB of 500 MB on 04/10/26, mostly weatherboard's `station_obs` (142 MB) growing every 5 min. Reaching the free cap would stop writes for travelboard too. Captures stay safe locally, but sync would stop | Gary: decide a retention policy for `station_obs` on the weatherboard side before Bangkok |
| Shared database size, 23/10/26 | The weatherboard database read 381 MB of the 500 MB cap on 23/10/26, up from 197 MB on 04/10/26 after the retention fix. At that rate it reaches the cap before or during Bangkok, which would stop travelboard sync | Gary: check weatherboard retention in the Weather Prediction project before 01/11 |
| Shared file storage | Free plan 1 GB shared with weatherboard's `radar` bucket (57 MB on 23/10/26). travelboard photos at about 250 KB each | Check bucket sizes at the end of the shakedown and after Bangkok |
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
- `checks/headless/`: `m1.test.cjs` and `m2.test.cjs` drive `trip.html` in headless Chromium against `harness.cjs`, a mock of the `tb_*` RPCs that mirrors migrations 0002 and 0004 and of `tb-journal`. Run both before every release that touches the client or the sync engine. `fn.test.cjs` runs the real `tb-journal` under Deno against local fakes of PostgREST and the Anthropic API; run it before every deploy of the function. Its one dev dependency (Playwright, pinned in its `package.json`) is never committed or shipped; `static.cjs` scans these files for secrets like every other file.
- `TESTS.md`: the acceptance lists above as numbered manual steps, run on the Pixel, results dated.
- A module is done when its acceptance list passes. No mutation testing.

## 12. Change log

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
