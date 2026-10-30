# travelboard: change history

What changed in each version, newest first. Each heading gives the version, the date and time it was released (Singapore time, 24-hour) and what changed. Versions before 0.13.0 were numbered v1 to v13 (SPEC.md 6.4). The reasons and Gary's decisions are in SPEC.md, its own change log included; the Pixel runs are in TESTS.md.

## v0.16.1, 30/10/26 0253 hrs
- The place-you-are-in chip comes from Nominatim search, not Overpass (overpass-api.de answers the phone's Chrome with 406, so 0.16.0's chip never showed). For the position, one search per kind (mall, station, hotel; Gary's scope 30/10/26) bounded to about 150 m each side; a result counts only if its kind matches and its bounding box holds the point; the smallest box wins. Reverse and search share one line: one request at a time, a second apart. Cached by the same 50 m cell under "p:"; a failure is not cached. The Overpass code is gone. Chip order and limits unchanged.

## v0.16.0, 27/10/26 1517 hrs
- Place chips inside buildings, and Locate (SPEC.md 7.2, 7C.4; Gary's decisions 27/10/26 after step 9 inside Tampines 1 offered the shop "Atrix"). A chip for the place the phone is in: the smallest named mall, building, station, park, market, hotel or attraction, or retail area containing it, from Overpass is_in on overpass-api.de (POST), cached in geocache under "e:" by the same 50 m cell, one request at a time, 10 s timeout, failures not cached. Chips: own names, then the place you are in, then the nearest name, at most three, no two alike. Locate on a new capture: a fresh high-accuracy fix (maximumAge 0, 15 s), shown with its accuracy, chips reloaded, kept in the draft and saved as the capture's coordinates instead of the fix at Save; denied or timed out, one line says so. Not on the edit screen.

## v0.15.0, 27/10/26 0005 hrs
- M1.4 Capture days (SPEC.md 7D, Gary's decision 26/10/26). A Days link beside the arrows on the Captures day bar shows the day list in place of the records and reads Today; Today returns to today's day view. The list: every local day with a live capture on the phone (own and partner rows, as the day view) plus today, newest first, in the journal day list's look; each row "N captures, M photos" (photos left out when none), then the first one or two distinct place names a person set, in time order, never coordinates. A tap opens that day and stops following today, as the arrows do. Built from IndexedDB in renderCaptures, so it works offline and is redrawn after every sync. Saving a new capture from the list returns to today's day view. A day render overtaken by a newer one no longer writes the day bar. No migration, no RPC change.

## v0.14.3, 26/10/26 2238 hrs
- Fixes from the two-phone run (Gary's approval 26/10/26). Idle sync every 60 s while visible, whatever the queue, so link changes and shared captures arrive without Sync now (SPEC.md 6.6); opening Settings syncs too and the sheet re-renders when it ends (7B.3). Keyboard: the capture and edit sheet is sized to the visual viewport, the footer is lifted by what the keyboard covers, the ruled area shrinks first and a focused field scrolls into view, so Share with, Photo and Save stay in view or a scroll away (7C). Sign-in and sign-out clear the password notices (7B.3).

## v0.14.2, 24/10/26 1540 hrs
- Dark --crit from #e5534b to #EC5F86, a crimson (Gary's decision), apart from the dark accent #E07A55; still AA on the night page, the sheet and the error tint. No other change.

## v0.14.1, 24/10/26 1527 hrs
- Light --crit from #b42318 to #8A1538, a deep crimson (Gary's decision), so the error stamp, Delete and error text stand apart from the terracotta accent. No other change.

## v0.14.0, 24/10/26 1501 hrs
- M1.3 session B (SPEC.md 7C.2, 7C.2a Panels, 7C.5, 7C.8). Journal: the Write button and its full-screen composer are gone; the Journal tab's foot holds the tabs, then a text field and Send. The field grows with the text up to 40% of the screen, keeps the draft of the day on screen (drafts journal:<date>, open while typing, so a force-close comes back to it), is never switched to another day while in use, and one tap on Send stores the turn as pending for the sync engine as before. The thread is a notebook page: a margin rule, a caps label (name and time), own turns in Plex with the accent rule, Claude's replies in Newsreader 17.5 px with the blue rule, no bubbles; sending, queued and not sent with Retry as before. The day title is the serif heading with its title suffix under it (tap either to edit); Days and Share as links; the day list in the serif on hairlines. renderJournal builds off-screen and only the newest render writes, as renderCaptures since v11. Share text names the phone's own person (Eric's turns were labelled Gary). Settings to the approved panel: a bottom sheet with a grabber and an X; the status block with its own stamp and Sync now, then Sync, Last sync, Last error, Storage, Version; Travelling with (one row per person, state in words, Add or Remove); Journal (My journal prompt, Export); Account (email and Sign out, Password and Change, or the sign-in form when signed out); Theme as Light, Dark and Auto. Auto stores nothing and now follows the phone live. Prompt editor: tb_prompt_get, the custom text or the default from prompts/<key>.md, a count against 4,000, Save (text equal to the default stores none), Cancel, Reset to default; needs a connection, not queued. Remove and Reset ask in the app's own confirm sheet; every alert became the same sheet with OK; no browser dialog is left. Photo, partner view and day title sheets in the same style. New app icon, option B (notebook page and pin), regenerated from design/m1.3/icon-b.svg.

## v0.13.0, 24/10/26 1402 hrs
- Version numbers become 0.<minor>.<patch> (Gary's decision): APP_VERSION and the service worker's CACHE_VERSION are '0.13.0', the panel shows 0.13.0, the cache is tb-shell-v0.13.0, and the export's app_version is the string. Same behaviour as v13.

## v13, 24/10/26 1357 hrs
- Map chip falls back to the address (house number and street) where OpenStreetMap has no name for the spot (SPEC.md 7C.4, Gary's decision after the v11 Pixel run at his HDB block). geocache keys gain an "a:" prefix, so v11 and v12's cached empty answers are asked again once.

## v12, 24/10/26 1353 hrs
- Chips with no fresh fix at open (Pixel run of v11): indoors in airplane mode a first satellite fix takes longer than 5 s, so a new capture got no position and no chips. The open-time request now waits up to 30 s and accepts a fix up to 5 min old; the last fix the app saw (meta last_fix, from any Save or opening) stands in at once when under 5 min old, for own-name chips only (no OpenStreetMap lookup until a fresh fix). A Save still takes its own fix with the 5 s limit, as before.

## v11, 24/10/26 1321 hrs
- M1.3 session A (SPEC.md 7C.1, 7C.2, 7C.2a, 7C.4, 7C.8). Vendored Newsreader 500, 600 and italic 500 and Plex Sans 500; the 7C.8 colour tokens in both themes; header with the italic wordmark and the sync pill as a stamp (sign in in ink blue, not the accent); Captures and Journal tabs move to the foot above the main button. Day view: serif day title with a line for the city and count, rows on a timeline spine with the time stamp, place (place_name, else coordinates to 4 decimals, else "no GPS"), text, photo as a small tilted print; queued rows keep a queued stamp; partner rows keep the name label and a blue dot. No kind label anywhere; the Note/Journal toggle is gone, new captures save kind note and old journal-kind rows keep theirs. The journal thread no longer quotes journal-kind captures. Capture and edit: a sheet with the time, a Place field and its chips, the photo as a print with Remove, the ruled textarea, the switches together at the foot, Photo and Save in the bottom bar. Place: own names within 75 m first (IndexedDB), then, online, one OpenStreetMap Nominatim reverse lookup (jsonv2, zoom 18, English), cached by position rounded to about 50 m in the new geocache store, at most one request a second, with the OpenStreetMap credit; up to three chips; a tap fills the field, nothing is filled without one. A new capture asks for a position at open only when location is already granted, so the first permission prompt still comes at the first Save. place_name is kept in drafts, pushed with the capture (null when cleared), shown in the partner view, exported, and in the journal Share text. IndexedDB version 5 adds store geocache.

## v10, 24/10/26 1038 hrs
- M1.2 Two travellers. IndexedDB version 4 adds stores partner (the other person's shared captures, replaced as a whole from tb_partner_captures on every sync) and pphotos (their photos, downloaded when online). Captures carry shared (false when absent), pushed with them; the Share with switch shows on the capture and edit screens only while the link is live, defaults on for a new capture, and is kept in the draft. tb_whoami is stored as meta me (name, people, link states) on every sync. Pill panel: partner panel (Add, Remove, state in words; needs a connection, not queued) and Change password (typed twice, at least 10 characters, supabase.auth.updateUser as the signed-in user; needs a connection; shows success or the server's error). Day view merges own and partner rows, partner rows with a name chip and no sync chip, opening a read-only view. Export adds partner captures with owner_name and shared. Pill and queue counts stay own rows only.

## v9, 24/10/26 0949 hrs
- Photo (and Replace) opens a small sheet: Camera or Gallery (SPEC.md 7A.2, corrected 24/10/26). On the Pixel a plain image file input goes straight to the Google Photos picker, which has no camera, so Camera is its own input with capture="environment" and Gallery keeps the plain one. Both lead to the same shrink and attach as before.

## v8, 24/10/26 0023 hrs
- "Claude sees this" switch per photo (SPEC.md D15, 7A.2), default on, shown with the photo on the capture and edit screens. Kept in the draft, on the capture (photo_to_claude, true when absent), pushed with it and in the export. Changing it in an edit bumps updated_at and queues the capture. Removing the photo resets it to on. Share leaves out "with a photo" for a photo switched off.

## v7, 23/10/26 2338 hrs
- M1.1 Photo capture. Photo button on the capture screen (Android chooser: camera or gallery; replaced in v9), preview with Remove; shrunk to 1280 px on the long edge, JPEG 0.82; Save works with a photo and no text. IndexedDB version 3 adds store photos { id, blob, w, h, bytes, uploaded, at }; drafts keep their photo. Rows show a thumbnail. Edit can add, replace or remove a photo (remove clears the four photo fields; the file stays in Storage). Sync uploads queued photos one at a time, smallest first, to tb-photos/<uid>/<id>.jpg, then fills photo_path and the size fields; a failed upload never holds back the capture's text and GPS. Pulled rows with a photo not on this phone are downloaded. The pill counts queued photos. Export carries the photo fields.

## v6, 23/10/26 2319 hrs
- Backend moved to its own Supabase project travelboard (SPEC.md 6.8): SUPABASE_URL and the publishable key point at it. meta.project_ref records the project the local data was synced with; when it differs from this build's, the pull cursor and the stored session are cleared, every capture is queued again, every sent journal turn is queued again (the server returns its stored reply, so no new Claude call), day titles are re-sent and every day is re-fetched, and the pill asks to sign in. Nothing local is deleted. A fresh install just records the project.

## v5, 23/10/26 2206 hrs
- Journal bar gains Share: the day's title, every live capture and the conversation as plain text, through the Android share sheet (Claude app, Copy and so on), or copied to the clipboard where sharing is not available. For pasting into Gary's daily journalling project in Claude on desktop.

## v4, 10/10/26 1556 hrs
- M2 Journal. Captures and Journal tabs in the header. IndexedDB version 2 adds stores journal and jdays. Sync order: push captures, push day suffixes, send queued journal turns oldest first (stops at the first failure, which shows Retry), pull captures, pull journal days whose message count or latest server_ts changed. The status pill counts queued journal turns with queued captures.

## v3, 04/10/26 2040 hrs
- M1 Capture. Capture and edit screen, drafts, 0400 local-day rule, date switcher, row layout (time in the row's zone with a city suffix, kind chip, GPS dot, sync chip), GPS merge, soft delete with Undo, ?new=1 and share target, Export. updated_at strictly increases on every local change. Removed the M0 "Add test record" button and hint. [hidden] now always hides: a display rule was overriding it (the sign-in form showed while signed in).

## v2, 04/10/26 1918 hrs
- Status pill fix from the Pixel test: starts as "checking" (or "offline" when navigator.onLine is false) instead of "synced"; a 5 s reachability probe runs before each sync, because navigator.onLine stayed true in airplane mode with a VPN active; a 30 s retry runs while visible with rows queued or the pill offline.

## v1, 04/10/26 1731 hrs
- M0 Foundation first build.
- index.html: first version (M0). Planner shown as not built yet.

## Brief, 04/10/26 1647 hrs
- SPEC.md and CLAUDE.md: M0 to M2 full spec, M3 to M8 skeletons.
