# travelboard: tests

Manual and automated test records, newest first. Device steps run by Gary on the Pixel.
Acceptance lists are in `SPEC.md`; this file holds how each item is tested and the dated result.

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
