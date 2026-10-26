# travelboard: tests

Manual and automated test records, newest first. Device steps run by Gary on the Pixel.
Acceptance lists are in `SPEC.md`; this file holds how each item is tested and the dated result.

---

## M1.3 Look and place (SPEC.md 7C)

**Status 26/10/26: the combined two-phone run on 0.14.2 passed (26/10/26, Gary and Eric): 7C.7 items 1 to 3, 6a and 7 on the phones, items 5, 8 and 9 automated; items 4 and 6 wait on step 9 (named place, 27/10/26). Three fixes from the run are built and live as 0.14.3. Left before the 05/11/26 cut-off: step 9, and the 0.14.3 re-checks on both phones ("Re-run steps, 0.14.3" below).** Migration 0009 applied, `tb-journal` v6 deployed (unchanged since).

### Automated results, 26/10/26 (0.14.3)

| Check | Result | Evidence |
|---|---|---|
| `checks/static.cjs` | PASS, 118 of 118 | Adds 4: 60 s idle sync stopped when hidden; Settings syncs on open; sign-in and sign-out clear the password notices; capture sheet and footer follow the visual viewport. |
| `checks/smoke.sql` | PASS, 165 of 165 | Live project `travelboard` (ref checked first), one rolled-back transaction. Regression run; no migration. |
| `fn.test.cjs` | PASS, 62 of 62 | `tb-journal` unchanged. |
| `m1`, `m2`, `m11` | PASS, 107, 80, 59 of each, two runs | Unchanged. The harness turns the idle sync off (`window.__tbIdleSyncMs = 0`) so request counts stay exact. |
| `m12.test.cjs` | PASS, 64 of 64, two runs | New P7: Sign out clears "Password changed" and the error line; a notice still on the sheet goes at the next sign-in. New Q1 to Q6: opening Settings starts a sync and shows the server's link state; the other side's link changed on the server, Sync now with the sheet open updates the row in place (the sheet stays open); the idle sync is 60 s; with it on (shortened to 0.7 s) the other side's change reaches Gary's open sheet, and a capture Eric shares reaches Gary's day view, with no Sync now; hidden stops it, visible starts it. |
| `m13.test.cjs` | PASS, 113 of 113, two runs | New N25, light and dark: a viewport cut from 860 to 420 px stands in for the keyboard when Chrome resizes the page; the new and edit sheets fit the 420 px, Save and Photo in view, Share with reached by scrolling inside the sheet, the ruled area shrinks first; the journal field and Send stay above it. A fake visual viewport of 420 px stands in for the other case (only the visible part shrinks): the sheet is sized to it, the footer is lifted by 440 px, field and Send above the keyboard; when it goes the layout returns. |
| Server reads 26/10/26 | Consistent with the run | Ref `nnnnonspfljdkrxstslw` (travelboard). Captures, links, prompts and journal as Gary's check (below). Storage: 10 objects in `tb-photos`; the run's one photo (2205, Gary's folder, 152,167 bytes) belongs to the now-unshared capture, and as Eric `tb_can_read_photo` gives false and the select policy shows him nothing in Gary's folder (7B.5 item 7, live). Catalogue (scoped): OUTSIDE 518, `493804029b51`, unchanged since 0009; travelboard's own objects 61 rows, hash `940b912f7a18` (new baseline for the next migration). |
| Gary's `auth.users.updated_at` 26/10 2158:53 | Token refresh | The same second a refresh token was issued for Gary and his session row was updated; `last_sign_in_at` is still 23/10 2340; no email, phone, recovery or reauthentication change; the auth audit log holds no entries for the evening. Not a password change. |
| Deploy 0.14.3 | PASS | `main` at `8c2440e`; Pages build succeeded. Live `sw.js` reads `const CACHE_VERSION = '0.14.3';` (Last-Modified 26/10/26 2239 hrs SGT), fetched through Apify. |

How the fixes were made:
- Idle sync: its own 60 s interval beside the 30 s retry, started at boot and on becoming visible, stopped when hidden; `sync()` keeps one run at a time.
- Settings: the stamp's click also calls `sync()`; the sheet already re-renders from `sync()`'s `finally`. Headless, Sync now with the sheet open did update the row before the change (checked against 0.14.2 first), so the phone's stale "Waiting" was the absence of any sync while the queue was empty, which the idle sync and the sync on open now cover.
- Keyboard: a `visualViewport` listener, kept beside `interactive-widget=resizes-content`. The meta works only where Chrome honours it; the listener sizes the capture sheet to what is visible and lifts the footer by what the keyboard covers in either case, so the fix does not depend on how the installed app treats the meta. With the keyboard up the ruled area's minimum drops from 160 to 96 px, and a focused field in the sheet is scrolled into view.
- Password notice: cleared on Sign out and on `SIGNED_IN` or `SIGNED_OUT` from `onAuthStateChange`.

### Device results, 0.14.2 (both phones), 26/10/26

From Gary's report (26/10/26 2232 hrs) and the server rows. Times SGT.

| Step | Time | Result |
|---|---|---|
| 10 | | PASS. Eric installed from the link and opened from the icon. His Gboard voice typing would not start (mic flashes, nothing happens): a phone and Gboard setting, not travelboard; no app change. |
| 11 to 13 (7B item 1) | 2159 | PASS. Eric signed in; `Eric before linking` and `Gary before linking` at 2159, each on its own phone only, both unshared then. |
| 14 (7B item 2) | 2201 | PASS with a finding. Links correctly (Gary to Eric 2201), but each phone showed the other's add only after Sync now or a restart; Gary's open Settings kept "You added Eric. Waiting for Eric to add you" until a restart. Fixed in 0.14.3 (idle sync, sync on opening Settings). |
| 15 (7B item 3) | 2203, 2205 | PASS with findings. Share with Eric on by default; the shared capture reached Eric only after he tapped Sync now (fixed by the idle sync). On both phones the keyboard covered the Share with switch (fixed in 0.14.3). Test texts: the photo capture is `Share with Eric` (2205, photo); a second `Share with Eric` at 2203 has no photo and stays shared. |
| 16 (7B items 3, 11) | 2208 | PASS. `Eric airplane` saved offline, synced, shown on Gary's phone; shared. |
| 17 (7C item 2) | 2210 | PASS. Fields swapped by an input slip, not a defect: text `Stall 12`, place `Named offline`; named offline, synced, shown on Eric's phone with the place; shared. |
| 18 (7B item 4) | 2212 | PASS. `Not for Eric` never shared; the 2205 photo capture switched off and gone from Eric's phone (server: shared false). |
| 19 (7B item 5) | | PASS. `Gary before linking` switched on in edit (server: shared true). |
| 20 (7B item 6) | | PASS. Read-only sheets both ways. |
| 21 (7B items 9, 10; 7C 6a) | 2214, 2215 | PASS. Threads private; Eric's 2215 reply cites only Gary's shared captures. Gary's 2217 reply treats `Eric airplane` as Eric's shared capture. |
| 22 (7C item 7, Eric) | 2216, 2217 | PASS. Eric's first test turn came in as `Prompt teat` (2216); its reply ended "Teh". His prompt was reset before `Prompt test` (2217), whose reply has no "Teh". Both `journal_prompt_custom` null afterwards. |
| 23, 24 (7B item 8) | 2220 | PASS. Remove asked in the app's sheet; unlinked, cleared; relinked (Eric to Gary 2220); both directions live. |
| 25 (7B item 13; covers step 8) | 2222 | PASS with a finding. Eric changed his password and signed in with the new one (auth updated and signed in 2222). "Password changed. Use the new one next time you sign in." stayed on the sheet after Sign out and the new sign-in: fixed in 0.14.3. Step 8 (Gary's Change password) counts as passed with it (Gary's decision 24/10/26). |
| 26 | | PASS. No browser dialogs. |
| 27 (7C item 1) | | PASS. Both phones, light and dark. |

**Acceptance after the run:** SPEC 7B.5 items 1 to 11 and 13 pass on both phones; item 12 automated. SPEC 7C.7 items 1 to 3, 6a and 7 pass on the phones; 5, 8 and 9 automated; 4 and 6 wait on step 9.

### Re-run steps, 0.14.3 (both phones)

Short re-checks of the three fixes. 0.14.3 must be live first (Deploy row above). Do not tap Sync now unless a step says so.

1. **Update both phones.** Each: open travelboard, tap "Update ready, tap to reload". Stamp: Version reads 0.14.3.
2. **Link changes arrive by themselves (step 14).** **Eric:** Settings, Remove, then Remove in the sheet. Gary: open Settings at once (no Sync now): within a few seconds it reads "You added Eric. Waiting for Eric to add you". Leave Gary's sheet open. **Eric:** Add Gary. Gary: without touching anything, within 60 s the open sheet changes to "Linked with Eric". Note how long it took.
3. **Share with and the keyboard (step 15).** Gary: Capture, tap in the text so the keyboard is up. Without closing the keyboard: Photo and Save show above it; scroll inside the sheet (not the keyboard) and "Share with Eric" comes into view. Type `Keyboard share`, Save. **Eric:** without Sync now, within 60 s `Keyboard share` appears, labelled GARY. Repeat the keyboard check on Eric's phone with a capture of his, and on an edit sheet (tap an older capture of your own, tap its text). Then Settings, Dark, and look at the same sheet with the keyboard up. Journal tab: tap the field; it and the arrow sit above the keyboard.
4. **The password line clears (step 25).** Either phone: Settings, Password, Change; type `aaaaaaaaaa` and `bbbbbbbbbb`, Save password: "The two passwords differ." in red. Sign out: the red line is gone. Sign in again: no password line. (A real change shows "Password changed" instead and clears the same way; there is no need to change a password for this.)

Report the times and anything that looks wrong.

### Automated results, 24/10/26 (session B, 0.14.0)

| Check | Result | Evidence |
|---|---|---|
| `checks/static.cjs` | PASS, 114 of 114 | Adds 6: no `alert`, `confirm` or `prompt` call in `trip.html`; the app's own confirm and notice sheet; inline journal field and Send with a draft per day, no journal mode left on the capture screen; prompt editor on `tb_prompt_get` and `tb_prompt_set`, 4,000 count, default from `prompts/<key>.md`, Reset to default; Theme Light, Dark and Auto; icon source in paths only. Manifest icons still 192 and 512 PNGs at the same paths; precache covers the regenerated icons. |
| `checks/smoke.sql` | PASS, 165 of 165 | Live project `travelboard`, one rolled-back transaction, through the connector (no migration in session B; regression run). |
| `fn.test.cjs` | PASS, 62 of 62 | Deno 2.9.4. `tb-journal` unchanged. |
| `m1.test.cjs` | PASS, 107 of 107, two runs | Unchanged apart from one wait (below). |
| `m2.test.cjs` | PASS, 80 of 80, two runs | Composer checks rewritten to the inline field (7C.3), as deliberate changes. K1: the foot holds the field and Send, no Write or Capture button, placeholder "Tell Claude about today". K2: the field opens no screen and pushes no history entry, Send off when empty; draft `journal:<date>` written on input with `open` true; a reload mid-typing returns to the Journal tab, that day, the text, the field focused; leaving the field keeps the draft closed; the Captures tab shows Capture and no field; back on Journal the draft is there; the field grows from 54 px, stops at 40% of the screen and scrolls; emptying it drops the draft and shrinks it. K3: Send empties the field and clears the draft in one tap; own turn in Plex with the accent rule labelled "Gary, 2105 hrs", Claude's in Newsreader 17.5 px with the blue rule, no bubbles. K9: no field on the day list; the title suffix shows under the date (`#j-sub`); the field on an older day writes that day's draft. Every other K and L check unchanged and passing (send, queue, lost response, Retry, order, 0400, second device, upgrades, v6 move, Share). |
| `m11.test.cjs` | PASS, 59 of 59, two runs | P16 and P20 moved from the composer to the field. |
| `m12.test.cjs` | PASS, 56 of 56, two runs | Any browser dialog now fails the run. New M16: Remove opens the app's own sheet ("Remove Gary?", what leaves which phone, Cancel and Remove); Cancel sends nothing and keeps the link. M8 and M15 go through the sheet. M9, M10 send through the field. Hooks kept. |
| `m13.test.cjs` | PASS, 104 of 104, three runs | Session A's 64 (N15 now checks the field opens no capture screen) plus 40 below (**items 6a, 7, 9**). Any browser dialog fails the run. |
| Visual | Checked | Headless screenshots at 390 x 844, light and dark: journal page, the field growing, day list, Settings (signed in, signed out), prompt editor, confirm sheet, Change password, against `design/m1.3/Journal.dc.html` and `Panel.dc.html` (not committed). |
| Deploy 0.14.0 | PASS | `main` at `2d53f04`; Pages build succeeded. Live `sw.js` reads `const CACHE_VERSION = '0.14.0';` (Last-Modified 24/10/26 1503 hrs SGT), fetched through Apify. |
| 0.14.1 (24/10/26) | PASS | Light `--crit` `#8A1538` (Gary). static 114 (token table updated), m1 107, m2 80, m11 59, m12 56, m13 104. `main` at `a95b37e`; live `sw.js` reads `const CACHE_VERSION = '0.14.1';` (Last-Modified 1528 hrs SGT), fetched through Apify. |
| 0.14.2 (24/10/26) | PASS | Dark `--crit` `#EC5F86` (Gary). static 114, m1 107, m2 80, m11 59, m12 56, m13 104. `main` at `8b62698`; live `sw.js` reads `const CACHE_VERSION = '0.14.2';` (Last-Modified 1540 hrs SGT), fetched through Apify. |
| Icons | Checked | `icons/icon-192.png`, `icon-512.png` (rounded ink ground, clear corners) and `icon-maskable-512.png` (full bleed) rendered from `design/m1.3/icon-b.svg` by `design/m1.3/make-icons.cjs`; every mark within 36 of the 40-unit safe radius (184 px of 205 px on the 512). |

Headless session B groups (`m13.test.cjs`):

| Group | What it checks |
|---|---|
| N19 | Settings sheet: grabber, radius 14 px, paper surface, Newsreader 28 px title, X; the status block's stamp matches the pill in text and colour, Sync now, then Sync, Last sync, Last error, Storage, Version; groups Travelling with (Eric, Remove), Journal (My journal prompt, Edit; Export), Account (email, Sign out; Password, Change), no sign-in form; linked state in ink blue, Remove in the accent; every button at least 44 px |
| N20 | Theme as a radio group Light, Dark, Auto; Auto stores nothing and follows the phone, and follows a change at once with the app open (theme colour too); Dark stays dark on a light phone and holds through a reload; the dark sheet is the night surface |
| N21 (**item 7**) | Edit opens the default from `prompts/journal.md`; the count against 4,000; Reset off while the default is in force; 4,001 characters red and Save off, 4,000 (as code points) allowed, blank refused; Cancel keeps nothing; Save stores Gary's text only and says when it applies; the next turn's whole system prompt is his text, captures still in the context block; reopened shows it; Reset asks in the app's sheet, Cancel there changes nothing, Reset restores the file text and the next turn uses the file; saving the default unchanged stores nothing; offline Edit says "Needs a connection" and asks nothing; a signal lost before Save keeps the text and saves nothing; Eric's editor opens `journal-eric.md`, his Save sets only his row, his next turn follows it, Gary never sees it |
| N22 (**item 6a**) | One tap on Send stores one turn, one tb-journal call, one reply, the field empties; the thread shows the turn and reply and quotes nothing; a draft survives a reload (force-close) |
| N23 | A file that is not a photo gives the app's notice sheet with OK only; OK closes it and leaves the capture screen; `trip.html` calls no `alert`, `confirm` or `prompt` |
| N24 | Maskable 512 full-bleed ink with the terracotta pin, every mark inside the safe circle; 512 and 192 with clear corners and the same art; manifest icon paths and the shortcut icon unchanged |

Found and fixed while porting (24/10/26):
- Typing straight after switching to the Journal tab could be overwritten when the day's draft finished loading. The field is now read-only from the start of the render that changes its day until that day's draft is in it.
- Send now starts the sync before re-rendering, so the pill never reads idle between the two.
- Journal Share labelled every turn "Gary", Eric's included; it now uses the phone owner's name (7B.3).
- Test harness: Playwright 1.56's `waitForFunction` does not await an async condition (a Promise is truthy, so the wait returned at once). Every such wait in m1, m2, m11, m12 and m13, older ones included, now uses `until()` in `harness.cjs`, which polls for real. All suites pass with the stricter waits.


### Device results, 0.14.2 (Pixel, Gary), 24/10/26

From Gary's report and screenshot and the server rows (checked 1600 hrs).

| Step | Time | Result |
|---|---|---|
| 1 to 5 | before 1548 | PASS (Gary). Updated; journal page, field, Settings sheet and themes as described. Icon change not yet reported. |
| 3 (item 6a) | 1548 | PASS. `Where am I today` sent with one tap; one reply stored (claude-sonnet-5-5, prompt cache written, 10,136 tokens). |
| 6 (item 7, Gary) | 1551 to 1552 | PASS. Own text: `Prompt test one` reply ends "kopi"; the changed prompt wrote a new cache (10,150 tokens). After Reset to default: `Prompt test two` reply has no "kopi" and **read** the 1548 cache (10,136 tokens), so the restored text is byte for byte the file. `journal_prompt_custom` null for both people afterwards. Claude's second reply also remarked on its own earlier "kopi": it sees the day's thread, including replies written under the old prompt. Expected, not a defect. |
| 7 | before 1553 | PASS (Gary). Offline Edit refused; screenshot at 1553 shows the OFFLINE stamp. |
| Type (item 1) | 1553 | Accepted by Gary 24/10/26, no change. Thread as the mockup: labels Plex caps in terracotta and blue, his text Plex 16 px ink, Claude's Newsreader 17.5 px ink. The serif renders a little heavier than the mockup (static Newsreader 500 for replies, no optical sizing); Gary chose to keep it. |
| 8 | | Merged into step 25 (Gary 24/10/26): if Eric's password change passes, the same form and call pass for Gary. |
| 9 (items 4, 6) | | Not run yet: needs a named place with signal. |

### Device steps (both phones), 0.14.0: M1.2 and M1.3 in one run

One run for SPEC 7B.5 (items 1 to 11 and 13) and 7C.7 (items 1 to 4, 6, 6a, 7). Item 12 of 7B.5 and items 5, 8 and 9 of 7C.7 are automated (results above). Gary on the Pixel, Eric on his Android phone. Steps marked **Eric** are his to do on his own phone, with Gary beside him reading out the step; everything else is Gary on the Pixel. Both phones on Asia/Singapore time. "Sync" means: tap the stamp at the top right, Sync now, then the X. Note the time of each step, and anything that looks wrong; screenshots help.

Part A, Gary alone, any time before Eric is there (steps 1 to 9).

1. **Update the Pixel.** Open travelboard; tap "Update ready, tap to reload" when it shows. Tap the stamp: the Settings sheet slides up from the bottom; Version reads 0.14.2. Close it with the X. Captures, photos and journal days are all still there. The home-screen icon becomes the notebook page with the terracotta pin on a dark ground; Chrome can take up to a day to change it, and may ask first. Report when it changes.
2. **Journal page (7C item 1).** Journal tab. The date in the large serif, "Add a title" (or the day's title) under it, Days and Share on the right. Your messages have a terracotta line down the left and "GARY, 2105 HRS" above them; Claude's replies are in the serif with a blue line and "CLAUDE, ...". No bubbles, no quoted captures. At the foot: the Captures and Journal tabs, then a text field "Tell Claude about today" with an arrow button. There is no Write button.
3. **Inline field and force-close (7C item 6a).** Tap the field: the keyboard opens on the same screen, no new screen. Check the Gboard mic works. Type four or five lines (`Line one`, Enter, `Line two` and so on): the field grows. Swipe travelboard away from recent apps, reopen it: it opens on the Journal tab with your lines in the field. Delete them all; type `Where am I today?` and tap the arrow once: the field empties at once, "Claude is replying" shows, and one reply comes.
4. **Settings sheet (7C item 1).** Tap the stamp. Check against the approved panel: grabber, "Settings" in the serif, X; a box with the stamp, Sync now, Sync, Last sync, Last error, Storage, Version; TRAVELLING WITH (Eric, with "Not linked with Eric." and Add Eric); JOURNAL (My journal prompt with Edit, Export); ACCOUNT (gary@travelboard.local with Sign out, Password with Change); THEME (Light, Dark, Auto). Tap a free area above the sheet: it closes.
5. **Theme (7C item 1).** Settings, Dark: the night page everywhere, the sheet included. Close and look at the Captures and Journal tabs, then open a capture: all readable. Settings, Auto: then open the Android quick settings and switch the phone's Dark theme on and off: travelboard follows each change at once. Settings, Light. Report anything hard to read in either theme.
6. **Your journal prompt (7C item 7, Gary's half).** Settings, My journal prompt, Edit. The editor shows the default text, starting "You are the other half of Gary's travel journal", with "1,658 of 4,000" under it and Reset to default greyed. At the very end add a new line: `Always end every reply with the word Kopi.` Save. The sheet says "Saved. Claude uses it from your next journal turn." and the row reads "Your own text". Close, Journal, send `Prompt test one`: the reply ends with "Kopi". Settings, Edit again: your text is there; Reset to default, then Reset in the sheet that asks: the default text is back and "Back to the default text" shows. Cancel. Journal, send `Prompt test two`: no "Kopi".
7. **Prompt needs a connection.** Airplane mode on. Settings, My journal prompt, Edit: "Needs a connection. Edit it when you have signal." under the row, no editor. Airplane mode off.
8. **Change password, Cancel only (7B item 13, Gary's half).** Settings, Password, Change: two fields and Save password, Cancel. Cancel: the fields close. (Change it for real only if you want a new password.)
9. **Named place and the journal (7C items 4 and 6; carried from session A step 8).** At a named place with signal (a mall, shop, station or park, for example Tampines Mall): Capture. Within a few seconds a dashed terracotta chip shows the place's name with "Map suggestion © OpenStreetMap contributors" under it; nothing is filled in. Tap the chip: the field fills. Type `M1.3 mall`, Save. Later, Journal: send `Where did I have lunch today?`: the reply names the place by its name.

Part B, both phones side by side (steps 10 to 27). 0.14.2 is live (confirmed 24/10/26 1543 hrs, 0.14.2 row above). Gary hands Eric his password in person; it never goes into a chat or a file.

10. **Eric installs.** **Eric:** in Chrome open `https://jeuron-hue.github.io/travelboard/trip.html`, menu, Install app (or Add to home screen), and open travelboard from the new icon (the notebook page and pin). Gboard as the keyboard with the on-device English pack (Settings, System, Languages, Speech, On-device recognition); in airplane mode, open a capture, tap the mic, check dictation works, close the capture, airplane mode off.
11. **Eric signs in (7B item 1).** **Eric:** tap the stamp ("SIGN IN", in blue). The sheet shows the sign-in form under ACCOUNT. Enter `eric@travelboard.local` and his password, Sign in to sync. The stamp reads SYNCED; Version 0.14.2; the account row reads eric@travelboard.local. His day view is empty.
12. **The look on Eric's phone (7C item 1).** **Eric:** Captures tab, Journal tab, Settings, a capture sheet: the same paper look as the Pixel. Settings, Dark, look again, then Light (or Auto, as he likes).
13. **Separate by default (7B item 1).** **Eric:** Capture, `Eric before linking`, Save. Gary: Capture, `Gary before linking`, Save. Neither capture sheet shows a "Share with" switch. Both Sync. Each phone shows only its own capture. In Settings, Gary's TRAVELLING WITH reads "Not linked with Eric."; **Eric:** his reads "Not linked with Gary."
14. **Link (7B item 2).** Gary: Settings, Add Eric: "You added Eric. Waiting for Eric to add you". **Eric:** Sync, then Settings: "Gary added you. Add him to link"; nothing of Gary's in his day view. **Eric:** Add Gary: "Linked with Gary", in blue. Gary: Sync, Settings: "Linked with Eric".
15. **Share with, default on (7B item 3).** Gary: Capture. At the foot of the sheet, "Share with Eric" is on. Photo, Camera, take a photo, type `Shared test`, Save. **Eric:** Sync. `Shared test` shows with a blue "GARY" label, a blue dot on the timeline and the photo print. **Eric:** tap it: a sheet with "Gary, <date>", the time, the place, the photo and the text; nothing to edit, no Delete, no switches; Close.
16. **Offline on Eric's phone (7B items 3, 11).** **Eric:** airplane mode on (stamp OFFLINE). Swipe travelboard away and reopen: `Shared test` and its photo still show. Still in airplane mode: Capture; "Share with Gary" is on; type `Eric airplane`, Save: the row shows QUEUED. Airplane mode off; the stamp reads SYNCED within about 30 s. Gary: Sync: `Eric airplane` shows, labelled ERIC.
17. **A place named offline, shared (7C item 2).** Gary: airplane mode on. Capture, type `Named offline`, in Place type `Stall 12`, Save: the row shows `Stall 12` in bold, the stamp "OFFLINE, 1 QUEUED". Airplane mode off; SYNCED within about 30 s. **Eric:** Sync: `Named offline` shows with `Stall 12` as its place.
18. **Not shared, and unsharing (7B item 4).** Gary: Capture, switch "Share with Eric" off, type `Not for Eric`, Save. **Eric:** Sync: `Not for Eric` does not show. Gary: tap `Shared test`, switch "Share with Eric" off, Save. **Eric:** Sync: `Shared test` and its photo are gone.
19. **From before linking (7B item 5).** On Eric's phone `Gary before linking` is not there. Gary: tap it; "Share with Eric" shows off. Switch it on, Save. **Eric:** Sync: it appears, labelled GARY.
20. **No editing the other's (7B item 6).** **Eric:** tap `Gary before linking`: only the read-only sheet opens. Gary: tap `Eric airplane`: the same.
21. **Journals (7B items 9, 10; 7C item 6a on Eric's phone).** Gary: Journal, type `Gary private journal note` in the field, Send; a reply comes. **Eric:** Journal: his page shows none of Gary's messages. **Eric:** type `What did Gary note before we linked up?` in the field and tap Send once: one reply, which should mention Gary's `Gary before linking` capture by its content and not `Not for Eric` or `Shared test`. Gary: Journal: none of Eric's messages.
22. **Eric's prompt (7C item 7, Eric's half).** **Eric:** Settings, My journal prompt, Edit: his default text, starting "You are the other half of Eric's travel journal". Add a last line `Always end every reply with the word Teh.` Save. Journal, send `Prompt test`: the reply ends with "Teh". Gary: Journal, send `Is Eric's prompt mine?`: no "Teh" (and no "Kopi", reset in step 6). **Eric:** Settings, Edit, Reset to default, Reset; or keep his line if he likes it, and say which.
23. **Unlink in the app's own confirm (7B item 8; 7C.2a).** **Eric:** Settings, Remove (in terracotta). A sheet slides up in the app: "Remove Gary?", what leaves which phone, Cancel and Remove; no grey browser box. Cancel: still "Linked with Gary". Remove again, then Remove in the sheet: "Gary added you. Add him to link". Both Sync: Gary's captures are gone from Eric's phone and `Eric airplane` from Gary's. Gary's Settings: "You added Eric. Waiting for Eric to add you".
24. **Relink (7B item 8).** **Eric:** Add Gary. Both Sync: Eric sees `Gary before linking` and `Named offline` again (not `Shared test` or `Not for Eric`); Gary sees `Eric airplane` again.
25. **Eric changes his password (7B item 13).** **Eric:** Settings, Password, Change. He types a new password of at least 10 characters twice, on his own phone only, and taps Save password: "Password changed. Use the new one next time you sign in." Sign out: the sign-in form shows. Sign in with the old password: "Invalid login credentials". Sign in with the new one: SYNCED. If Save password shows an error about reauthentication instead, stop and tell Claude; do not try to work round it.
26. **No browser dialogs.** Over the whole run, did any grey browser box appear (with the site address at the top)? Report yes or no on each phone.
27. **Both phones, final look (7C item 1).** Each phone, light and then dark: day view, a capture sheet, Journal, Settings. Report anything that differs from the approved mockup.

Report the time of each step and anything that looks wrong. Claude then checks the rows, links, place names, Storage reads, prompt rows and journal replies on the server.

### Automated results, 24/10/26 (session A)

| Check | Result | Evidence |
|---|---|---|
| Migration 0009 catalogue diff (**item 8**) | PASS | Scoped form (`checks/catalogue_scoped.sql`): objects outside travelboard 518 before and after, hash `493804029b51` both times. Added: constraints `captures_place_name_check`, `people_journal_prompt_custom_check`; functions `tb_prompt_get()`, `tb_prompt_set(text)`. Changed: `travel.captures` (column `place_name`), `travel.people` (column `journal_prompt_custom`), `tb_capture_upsert`, `tb_journal_turn`. Every other `travel` and `tb_` object, the three `tb_photos_*` policies and bucket `tb-photos` unchanged. Dry run (rolled back) before applying. |
| `checks/smoke.sql` | PASS, 165 of 165 | The 129 earlier tests (T3 now counts 17 `tb_` functions) plus U1 to U14 on synthetic users A, B, C in the rolled-back transaction: anon denied on both new functions (U1); columns and checks, Gary and Eric start with no custom prompt (U2); **item 7**: each reads only his own key and text, B's set leaves A's alone, neither function takes a uid (U3); `tb_journal_turn` gives the caller's own custom text (U4); null and blank reset, 4001 refused, 4000 kept (U5); no people row or no caller refused (U6); `place_name` in through `tb_capture_upsert` trimmed, out through `tb_captures_since` (U7); a row without the field keeps the name (U8); null and blank clear, 121 refused, 120 kept (U9); the batch route carries it (U10); `tb_partner_captures` carries a shared capture's name, never an unshared one (U11); B cannot rename A's capture (U12); `tb_journal_turn` lists names for own and shared captures (U13) with coordinates still there (U14). |
| `checks/static.cjs` | PASS, 107 of 107 | Adds: Newsreader 500, 600, italic 500 and Plex 500 vendored and declared, OFL licence; all 17 colour pairs of 7C.8 in both themes; theme colour and manifest from the dark ground; IndexedDB v5 with `geocache`; no kind toggle, new captures `note`; no kind label or journal quotes; place limits (120 characters, 75 m, 3 chips); Nominatim jsonv2, zoom 18, English, one a second, cached; OSM credit; service worker leaves cross-origin to the network; `tb-journal` labels by place, never kind, and takes the custom prompt; 0009 shape. |
| `fn.test.cjs` | PASS, 62 of 62 | Deno 2.9.4, `deno check` clean. F13, G2, G4 rewritten: labels and capture tags carry no kind. New H1 to H6: a named capture tagged `place="..."` only, an unnamed one keeps `location`, quotes and angle brackets escaped, neither when nothing; photo label "at Tampines Mall"; no `kind=` anywhere (**item 6** on the request side); **item 7**: the custom text is the whole system prompt, the context block with captures and photos is unchanged, Eric's call untouched, null and blank go back to the file, custom text with an unknown key still works. |
| `tb-journal` v6 | Deployed | 24/10/26, `verify_jwt` on, `index.ts`, `context.mjs`, `prompt.ts` from commit `2da27fc`. |
| `m1.test.cjs` | PASS, 107 of 107 | A2 new: no kind toggle. A6, A12, A13 rewritten: every new capture is a note, an edit keeps the kind. Row checks rewritten to the new row (time stamp, place, sync stamp): A6 "no GPS", A18 coordinates to 4 decimals in place of the GPS dot, B1 no kind label on an old journal row and the heading line, new B2 editing an old journal-kind row keeps `journal` on the phone and the server. A21 export carries `place_name`. C1 15 shell files. |
| `m2.test.cjs` | PASS, 80 of 80 | The journal-kind capture is now an old row from the server. K1 rewritten: no quoted capture, the empty hint counts both captures; K3: Claude still sees it, unlabelled; K3, K4, K11 thread order without the quote. K2: no toggle, place or switches in the composer. K0, K12 IndexedDB v5. |
| `m11.test.cjs` | PASS, 59 of 59, three runs | P0 IndexedDB v5. New P18: ten overlapping renders leave exactly one row per capture. Found while porting P17: two renders at once (a sync and a tap) interleaved their rows, doubling them or leaving the list empty for a moment; v10 had the same pattern. The day list is now built off-screen and only the newest render writes it. |
| `m12.test.cjs` | PASS, 54 of 54 | Hooks kept (`#cap-share`, `#partners`, `#pw-*`, `#view-dlg`); only M0 (v11, IndexedDB v5) and M12 (export version) changed. |
| `m13.test.cjs` (new) | PASS, 54 of 54, four runs; 61 of 61 on v12, three runs; 64 of 64 on v13, two runs | Below. v12 adds N17, v13 N18. |
| Visual | Checked | Headless screenshots at 390 x 844 of the day view, capture sheet with chips, edit sheet and journal, light and dark, against `design/m1.3/` (not committed). |
| Deploy v11 | PASS | `main` at `01ff212`; Pages build succeeded. Live `sw.js` reads `const CACHE_VERSION = 11;` with the five new font files in its precache (Last-Modified 24/10/26 1322 hrs SGT), fetched through Apify. |

Headless M1.3 groups (`m13.test.cjs`, Gary's and Eric's phones on one mock, Nominatim mocked):

| Group | What it checks |
|---|---|
| N0 | v11, IndexedDB v5; Newsreader 600, italic 500 and Plex 500 load from `vendor/`; day title Newsreader 600 34 px, wordmark italic 20 px; paper and night-page grounds, accent in both themes; pill as a stamp; tabs at the foot; main button 54 px, radius 10; "sign in" in ink blue |
| N1, N2 | No position asked at open until location is granted; "no GPS", then coordinates to 4 decimals until named (**item 2**) |
| N3, N4 | Named offline: trimmed, `updated_at` bumped, queued, no OSM request; on reconnect on the server; shared, the name shows on Eric's phone in the read-only view; Eric's rename refused (**item 2**) |
| N5, N6 | Clearing returns to coordinates on phone and server; a killed draft keeps the place |
| N7 | Offline: own names within 75 m, nearest first, once each, with distance; not the 200 m one; no map chip, no request; nothing filled until a tap (**item 3**) |
| N8 | Online: one map chip with the OSM name and the credit, dashed; one request with jsonv2, zoom 18, English, the position; typing asks nothing more; a tap fills it; only the name is stored; cached (**item 4**) |
| N9 | A second capture at the same spot: no second request (**item 5**) |
| N10, N11 | Three new places at once: three requests at least a second apart; an empty answer cached; an HTTP or network failure gives no chip and is not cached |
| N12, N13 | Four own names: three chips, no lookup; a capture saved offline gets its map chip when opened later with signal |
| N14 to N16 | Eric's phone never looks up Gary's rows; journal composer has no place field; export and Share text carry the name; heading reads city and count; rows: time, dot, no kind label |
| N18 (v13) | No name but an address: the chip offers "238 Tampines Street 21" with the credit, nothing filled; a name wins; a street alone or a pedestrian street works; a house number with no street gives nothing; v12 cache keys are not read |
| N17 (v12) | No fix at open: the last fix under 5 min old gives own chips at once, offline; the open-time request waits 30 s and takes a fix up to 5 min old; a fresh fix replaces the stand-in; a 10 min old last fix is not used; online, the stand-in never asks OpenStreetMap; a Save's fix becomes the last fix |

### Device results, v11 (Pixel, Gary), 24/10/26

From Gary's screenshots and the server rows.

| Step | Time | Result |
|---|---|---|
| 1 to 3 | 1338 | v11 in light and dark: wordmark, stamp, serif day title with "Singapore, 8 captures", timeline rows with coordinates in grey, prints, tabs at the foot. No kind labels. |
| 4 | 1339 | Capture sheet as designed; the coordinates hint showed (Wi-Fi was on with airplane mode). No chips: nothing named yet, and see the OSM row below. |
| 5 | 1342 to 1343 | `Home test` named offline, row bold, "offline, 1 queued"; on the server at 1343:10 with `place_name` Home test and GPS 19 m. PASS. |
| 6 | 1345 | **Not as designed.** Airplane mode with Wi-Fi off, indoors: no position at open, so no chip. Gary typed `Home test` himself; the Save's own fix arrived (20 m). Cause: a first satellite fix with no network location takes longer than the 5 s the app allowed. Fixed in v12 (below). |
| OSM | 1339 | No map chip at home is correct: Nominatim returns the HDB block, `238, Tampines Street 21`, with an empty `name` (checked 24/10/26 1347 hrs), and 7C.4 offers only a named place. |

v12 (24/10/26): the open-time request waits up to 30 s and accepts a fix up to 5 min old; the last fix the app saw, if under 5 min old, gives own-name chips at once (no OpenStreetMap lookup until a fresh fix). A Save's own fix keeps the 5 s limit.

v13 (24/10/26, Gary's decision): where OpenStreetMap has no name, the map chip offers the address, house number and street. SPEC 7C.4 updated. Old cached empty answers are asked again once.

### Device results, 0.13.0 (Pixel, Gary), 24/10/26

From Gary's screenshots and the server rows (checked 1410 hrs).

| Step | Time | Result |
|---|---|---|
| 1 | before 1401 | Updated to 0.13.0. |
| 6 (item 3) | 1401 | PASS. Airplane mode, Wi-Fi off: blue chip `Home test 2 m` at open, field empty. |
| 7 | 1402 to 1403 | PASS. `M1.3 test two` cleared back to coordinates; `place_name` null on the server (updated 1403:31). |
| 8, home (item 4, address) | 1402 | PASS. Online at home: dashed chip `238 Tampines Street 21` with the OpenStreetMap credit, field empty. Tapped on `M1. 3 named place` (1404): `place_name` 238 Tampines Street 21 on the server. From then on it shows as Gary's own blue chip with distance (1405). |
| 8, named place | | **Not run yet.** Needs a named place with signal, for example Tampines Mall. |
| 9 | 1407 | PASS. `Draft text` saved with place `240 Tampines Street 21` (typed), coordinates kept. |
| 10 | 1405 | PASS. Edit sheet for the 0931 photo capture: own time and date, place hint, chips, print with size and Remove, "Claude sees this photo" switch, info line with Delete, Replace and Save. |
| 11 (items 6, 6a part) | 1407 to 1408 | PASS in substance. No quoted captures in the thread. Asked "Where did I have lunch today", Claude said no capture mentions lunch and placed the later captures "around 238 and 240 Tampines Street 21" by their place names. One reply stored (claude-sonnet-5-5, 555 input tokens). The mall lunch question waits for step 8 at a named place. |

Session A retired 24/10/26. Its step 8 at a named place, with the journal question after it, is step 9 of the combined two-phone run above (Gary's decision, session B).

### Device steps (Pixel, Chrome), 0.13.0: session A

v11 is live (`const CACHE_VERSION = 11;` confirmed 24/10/26 1323 hrs). Gary only; the two-phone steps come with session B. Location is already allowed for travelboard on the Pixel. Note the time of each step.

1. **Update.** Open travelboard; tap "Update ready, tap to reload" when it shows. Pill, Version reads 0.13.0. Close. Captures, photos and journal days are all still there.
2. **The look (item 1, day view).** Paper-coloured page; "travelboard" in italic at the top left; the pill is a small tilted stamp (green "SYNCED"). Day title in the serif with "Singapore, N captures" under it; arrows on the right. Rows: the time in terracotta with "HRS" under it, a thin line with a dot, the place in bold (or coordinates in grey, or "no GPS"), the text, a tilted photo print. No "note" or "journal" labels anywhere, old journal captures included. Captures and Journal tabs sit above the Capture button. Compare with the approved mockup; report anything that differs.
3. **Dark (item 1).** Pill, Theme. Night-blue page, light text, orange-terracotta times and button; everything readable. Theme again back to light. Report anything hard to read in either.
4. **Capture sheet (item 1, 6a).** Capture. "New capture" title with an X; a sheet with the time in terracotta and today's date; PLACE with the coordinates as a grey hint; ruled lines; Photo and Save at the bottom. No Note/Journal toggle. Tap in the text, check the Gboard mic works, type `M1.3 test one`.
5. **Name offline (item 2).** Airplane mode on (pill reads offline). Type `Home test` in Place. Save. The row shows `Home test` in bold; pill "offline, 1 queued". Airplane mode off; within about 30 s the pill reads synced.
6. **Your own name as a chip, offline (item 3).** Same spot, airplane mode on (Wi-Fi off too). Capture: under Place, a blue chip `Home test` with a few metres; the field stays empty. Within 5 min of a Save it shows at once; otherwise it can take up to 30 s while the phone finds the satellites. Tap the chip: the field fills. Type `M1.3 test two`, Save. Airplane mode off.
7. **Clear back to coordinates.** Tap `M1.3 test two`; tap the X at the end of the Place field; the field empties and shows the coordinates as a hint; Save. The row shows the coordinates in grey.
8. **Map chip (items 4, 5).** First at home with signal: Capture; within a few seconds a dashed chip reads `238 Tampines Street 21` (the address, as the block has no name) with the OpenStreetMap credit. Close. Then at a named place with signal (a mall, shop, station or park, for example Tampines Mall): Capture. Within a few seconds a dashed terracotta chip shows the place's name, with "Map suggestion © OpenStreetMap contributors" under it; nothing is filled in. Tap it: the field fills. Type `M1.3 mall`, Save. (Item 5, one lookup per spot, is proven headless.)
9. **Draft keeps the place.** Capture, type `draft place` in Place and `draft text` in the text, swipe travelboard away, reopen: both come back. Close (X).
10. **Edit sheet.** Tap any older capture: "Edit capture", its own time and date, its place, the date line and Delete at the foot of the sheet, the switches together above it. Close.
11. **Journal (items 6, 6a part).** Journal tab: the thread shows only your turns and Claude's replies; no quoted captures, even on a day with old journal captures. (The journal screen keeps its present layout until session B.) Write `Where did I have lunch today?` and Send. The reply should name the mall from step 8 by its name.

Report the times and anything that looks wrong. Claude then checks the names on the server and the journal call.

### Open items (24/10/26, end of session B)

Session A's build list (items 1 to 7) is done in 0.14.0: journal page and inline field, Settings sheet, prompt editor and its tests, panels in the paper style, icon option B, the combined device steps, and `renderJournal` built off-screen.

Untested
1. Done 26/10/26 on 0.14.2 (results above), apart from step 9. The 0.14.3 re-run steps above are still to run on both phones. Cut-off 05/11/26.
2. 7C.7 item 4 at a named place and item 6 asking about it (step 9): on 27/10/26 (Gary).
3. Item 1 passed on both phones 26/10/26 (step 27). The new icon on the home screen: not reported yet.
4. Change password end to end: passed 26/10/26 (Eric, step 25; no reauthentication asked). The notice that outlived the session is fixed in 0.14.3 (re-run step 4).

Decisions for Gary (asked in the session B report; answers to be recorded here)
5. Answered 24/10/26: Gary said yes. SPEC 7C.4 reworded (0009 replaces `tb_capture_upsert` only; `tb_captures_upsert` is a pass-through).
6. Answered 24/10/26: Gary said deepen. Light `--crit` is `#8A1538` from 0.14.1 (crimson; 8.1:1 on the paper, 7.5:1 on its tint). Dark `--crit` `#EC5F86` from 0.14.2 (Gary said deepen it too): a crimson, apart from the dark accent `#E07A55`; 5.4:1 on the night page, 4.8:1 on the sheet and its tint.

Known, by design or minor
7. Newsreader is the three static files 7C.8 names (default optical size, no 400), so titles and Claude's replies render a little heavier than the mockup. Seen on the Pixel 24/10/26; Gary chose no change.
8. A cached map name shows offline too; the geocache never expires; Nominatim is called from the phone with the browser's Referer, no custom User-Agent.
9. The prompt editor counts characters as the server does (code points); an emoji built from several code points counts as several.
10. Saving the default text unchanged stores no custom text, so a later edit of `prompts/<key>.md` reaches that person; once someone saves their own text, file edits no longer reach them until Reset to default.
11. Android's home-screen icon changes when Chrome next checks the manifest, which can take up to a day and may ask first. The manifest paths are unchanged, so nothing else is needed.
12. The journal field is hidden on the day list (nothing to write into there); tap a day or Today to write.
13. Catalogue 26/10/26: outside 518, `493804029b51` (unchanged since 0009); travelboard's own 61 rows, `940b912f7a18`. Live: 2 people, both `journal_prompt_custom` null; links live both ways.
16. Eric's Gboard voice typing does not start (mic flashes): his phone's Gboard settings (on-device English pack, microphone permission for Gboard). Not travelboard; worth fixing before Bangkok.
17. The idle sync costs one small sync a minute while the app is open and visible (a reachability probe and the usual pulls); nothing runs while it is in the background.
14. Running the checks here: as M1.2 item 16 and session A; Deno 2.9.4 from the GitHub release zip; the icon generator needs the headless dev dependency (`npm install` in `checks/headless`).
15. M1.2 open items below: 1, 3 and 4 wait on the combined run; 2, 5 and 11 are closed by session B.

---

## M1.2 Two travellers (SPEC.md 7B)

**Status 26/10/26: every SPEC 7B.5 item passes. Items 1 to 11 and 13 on both phones in the combined run on 0.14.2 (26/10/26, M1.3 section); item 12 automated. Three findings from the run (link changes and shared captures waiting for Sync now, the keyboard over Share with, the password notice outliving the session) are fixed in 0.14.3; their re-checks are in the M1.3 section.** Migration 0008 applied, `tb-journal` v5 deployed, client v10 live. Item 13 (Change password) added on Gary's decision 24/10/26. Build session retired 24/10/26; M1.2 stays as built.

**Gary's decisions 24/10/26:** the two-phone test waits until after the UI redesign, so Eric's first look is the final UI. M1.2 cut-off moves from 31/10/26 to 05/11/26; the freeze from 01/11/26 to 06/11/26. The redesign, place names and editable journal prompts are M1.3 (SPEC 7C, D17, from Gary's planning chat, commit `5efd5d3`), built in two new sessions; SPEC and CLAUDE.md carry the new dates. The build session did not edit either for this.

### Open items for the next session

Untested
1. Done 26/10/26: items 1 to 11 and 13 pass on both phones (M1.3 section).
2. Closed 24/10/26 (M1.3 session B): the steps are rewritten for 0.14.0 and merged with M1.3's into one run (M1.3 section). The hooks were kept; m12 passes 56 of 56.
3. Item 10 on a real call: Eric's reply referring to one of Gary's shared captures by its content. So far shown only in `fn.test.cjs` (G2) and `m12` (M10) against fakes.
4. Item 7 REST part: no check from outside with a partner's JWT. The refusals are proven at the policy level (smoke T8, T12, T13); the admitted read is the Storage download on Eric's phone (device steps 6 and 8).

Waiting on Gary
5. Answered 24/10/26: Gary reports "Secure password change" and "Require current password when updating" both off. Change password needs no reauthentication; Eric's step 25 of the combined run proves it end to end. (Minimum length, requirements and sign-ups not reported; the client enforces 10 characters itself.)

Known behaviour, by design or minor
6. The Share with switch uses the last link state the phone saw (`meta me`). Offline after an unlink, a new capture can still be saved shared. Nobody sees it unless the link is live again, and then it shows like any shared capture.
7. Unsharing or unlinking clears the other phone only at that phone's next sync. Until then, an offline phone keeps showing the rows.
8. A partner photo is downloaded again only when `photo_bytes` changes. A Replace with a file of exactly the same size would keep the old image on the other phone.
9. Journal Share (the text sent to another app) and the Days list count only the phone owner's own captures. Shared captures are not in the Share text (SPEC is silent).
10. `meta me` is not cleared on sign-out. It refreshes at the next sync.
11. Closed 24/10/26 (0.14.0): Remove asks in the app's own confirm sheet; no browser dialog is left in the app (m12 M16, m13 N23, static check).
12. Security advisors: `public.rls_auto_enable()` can be run by `anon`. It is Supabase's own function, not travelboard's, and was left alone under rule 1. The `tb_*` warnings are the intended design (rule 3).

For the next session
13. Catalogue baseline after 0008: objects outside travelboard's scope 518, hash `b4ee4e5e7071` (scoped form of `checks/catalogue.sql`: travel, `public.tb_*`, `tb_photos_*` policies and the `tb-photos` bucket listed; everything else as one count and hash).
14. Live state 24/10/26: 2 auth users, 2 `travel.people` rows (Gary `journal`, Eric `journal-eric`), 0 `partner_adds`, 0 shared captures.
15. `smoke.sql` inserts synthetic users into `auth.users` and `travel.people` inside its rolled-back transaction (T-tests). It never relies on the real link between Gary and Eric.
16. Running the checks here: `npm install` in `checks/headless` (Playwright 1.56.1, `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`), `TB_CHROMIUM=/opt/pw-browsers/chromium`, Deno 2.9.4 as `DENO=`. The sandbox cannot reach supabase.co or github.io directly: SQL goes through the connector, and the live `sw.js` was fetched through Apify.
17. `tb-journal` is deployed from three files: `index.ts`, `context.mjs` and `prompt.ts`. Run `bundle-prompt.cjs` after any prompt edit; `static.cjs` fails while `prompt.ts` is stale. Editable journal prompts (M1.3, SPEC 7C) change where the prompt comes from; check 7C for whether the bundled files stay as defaults.

### Automated results, 24/10/26

| Check | Result | Evidence |
|---|---|---|
| Migration 0008 catalogue diff | PASS | Objects outside travelboard's scope: 518 before and after, hash `b4ee4e5e7071` both times. Added: tables `travel.people`, `travel.partner_adds`, their 2 primary-key indexes and 8 constraints; functions `tb_linked`, `tb_link_state`, `tb_partner_add`, `tb_partner_remove`, `tb_partner_captures`, `tb_can_read_photo`. Changed: `travel.captures` (column `shared`), `tb_whoami`, `tb_capture_upsert`, `tb_captures_since`, `tb_journal_turn`, policy `tb_photos_select`. Unchanged: every other travel and `tb_` object, `tb_photos_insert`, `tb_photos_update`, bucket `tb-photos`. People rows: Gary (`journal`), Eric (`journal-eric`). No capture shared, no link. |
| Security advisors after 0008 | As designed | `tb_*` definer functions callable by `authenticated` (rule 3), RLS on with no policies on the 5 travel tables (no grants by design). Nothing new for anon. |
| `checks/smoke.sql` | PASS, 129 of 129 | Earlier 74 (test 11c now expects `owner` on pulled rows, 0008) plus T1 to T14 with synthetic users A, B, C inserted inside the rolled-back transaction: anon denied on the 6 new functions (T1); no direct reads of the new tables (T2); all 15 `tb_` functions definer, `search_path`, grants (T3); people rows and the `shared` default (T4); **item 1** not linked: no partner rows, own pull only, no photo of the other's (T5); **item 2** one-way add, `added_by_me` and `added_me`, then live (T6); linked: only shared, live captures, with `owner_name` (T7); **item 7** a linked partner reads the shared photo, not the unshared one or a file with no capture, cannot write, overwrite or delete in the other's folder, a third uid and Gary read nothing (T8), after unsharing (T12) and after either side removes the link (T13) the photo is refused; **item 6** edit, delete and batch on the other's capture rejected 42501, row unchanged (T9); **item 9** the partner's `tb_journal_day`, `tb_journal_days`, `tb_journal_turn` on the other's turn and `tb_journal_reply` to it all give nothing or are rejected (T10); item 10 SQL side: the partner's turn has its own prompt key, own capture plus the shared ones labelled, switched-off photo path withheld, unshared and deleted absent (T11); a row without `shared` keeps the stored value (T12); re-adding clears `removed_at` (T13). Afterwards: 2 auth users, 2 people, 0 adds, no test rows. |
| `checks/static.cjs` | PASS, 81 of 81 | Adds: IndexedDB v4 with `partner` and `pphotos`; `shared` pushed, false when absent; partner rows never pushed; Change password via `updateUser`, 10 characters, no reauthentication workaround; 0008 shape; `prompt.ts` matches every `prompts/*.md`, Eric's names no Gary. |
| `checks/headless/fn.test.cjs` | PASS, 49 of 49 | Deno 2.9.4. G1 Eric's call: system is `prompts/journal-eric.md`; not linked, nothing of Gary's fetched or sent. G2 linked: Gary's shared captures `by="Gary"`, his unshared capture absent from the whole request (**item 10**), Gary's shared switched-on photo fetched with Eric's JWT and sent labelled, the switched-off one not; Eric's thread only. G3 Gary's call: his prompt, his own 3 (the unshared one too), not Eric's unshared capture or thread. G4 Eric's shared capture in Gary's call `by="Eric"`. G5 link removed: nothing of Gary's in Eric's call. G6 15 shared and 20 own photos: 30 images, the most recent across both, 5 listed not shown. G7 unknown prompt key: 502 `no_prompt`, no Claude call. `deno check` clean. |
| `checks/headless/m12.test.cjs` (new) | PASS, 54 of 54, three runs | Two phones (separate browser contexts) on one two-user mock. Below. |
| Deploy v10 | PASS | `main` at `83045dc`. Live `sw.js` reads `const CACHE_VERSION = 10;` (Last-Modified 24/10/26 1039 hrs SGT), fetched through Apify. `tb-journal` v4 (verify_jwt on) deployed 24/10/26; v5 the same day with Eric's prompt matching Gary's apart from the name (Gary's call). fn 49 of 49, static 81 of 81 after. |
| `m1`, `m2`, `m11` on v10 | PASS, 103, 80, 58 | K0, K12 and P0 now expect IndexedDB v4. m11 P10 failed about one run in four: the earlier photo-only capture's upload sometimes ran into the failing window and was counted; the test now lets it finish first (5 clean runs after). |

Headless M1.2 groups (`m12.test.cjs`):

| Group | What it checks |
|---|---|
| M0, M1 | v10, IndexedDB v4; not linked: no Share with switch, new captures `shared` false, each phone shows only its own, panel "Not linked with Eric." (item 1) |
| M2 | Gary adds: "You added Eric. Waiting for Eric to add you"; Eric's panel "Gary added you. Add him to link"; nothing shared; Eric adds: "Linked with Gary"; Gary after sync "Linked with Eric" (item 2) |
| M3 | Share with Eric shown and on by default; shared with a photo; on Eric's phone after his sync with a "Gary" label, no sync chip, thumbnail and photo stored; not in his own captures or pill; still shows with the network off after a reload (item 3) |
| M4 | Saved with the switch off: never on Eric's phone, its photo never fetched; switching a shared one off removes the row and photo at Eric's next sync, and a direct download as Eric is refused (item 4) |
| M5 | Capture from before linking absent on Eric's phone, edit shows the switch off, switched on it appears (item 5) |
| M6 | Partner row opens a read-only view (text, photo, name), no capture screen, no Delete, no switches; Eric's RPC edit and delete of Gary's capture rejected, Gary's row unchanged (item 6) |
| M8 | Eric removes: both phones lose the other's captures and photos; panels update; switch gone; adding again brings back only the still-shared; Gary removes: cleared again (item 8) |
| M9, M10 | Each phone holds only its own thread; the server counts only Eric's rows on a day Gary also wrote; Eric's journal call uses `journal-eric` and has Gary's shared capture `by="Gary"`, not the unshared one (items 9, 10) |
| M11 | Eric offline, linked by the last known state: Share with Gary on; saved queued; on reconnect it lands and shows on Gary's phone labelled Eric (item 11) |
| M12 | Export: own and partner captures with `owner_name`, `shared`, partner marked |
| M13 | Killed mid-typing with the switch off: the draft comes back with it off and saves unshared |
| M14, M15 | A failed partner pull keeps the shared rows and shows the error; Remove offline says "Needs a connection" and sends nothing |
| P1 to P6 | Change password: under 10 characters and mismatched refused on the phone; offline "Needs a connection", not queued; a server reauthentication error shown as is, no workaround; success shown and the server holds the new password; signed out, the old password refused, the new one signs in and syncs; the same password again shows the server's error (item 13) |

Item 7's REST part: the photo reads go through the Storage REST API with the user's JWT, on the phones in device steps 5 and 8 (admitted while shared, gone after). The refusals (unshared, other folder, third user, after unlinking) are proven at the policy level by smoke T8, T12 and T13, as M1.1 item 8 was.

### Device steps (both phones), v10 (superseded)

Superseded 24/10/26 by the combined 0.14.0 run in the M1.3 section; kept as the record of what v10 asked. To be run once v10 is live (Claude confirms `const CACHE_VERSION = 10;`). Gary on the Pixel, Eric on his Android phone, side by side. "Sync" means tap the pill, then Sync now, then Close. Both phones on Asia/Singapore time.

1. **Update Gary's Pixel.** Open travelboard; tap "Update ready, tap to reload" when it shows. Pill, Version reads v10. Gary's captures, photos and journal days are all still there.
2. **Install on Eric's phone.** In Chrome open `https://jeuron-hue.github.io/travelboard/trip.html`, menu, Install app (or Add to home screen), open it from the new icon. Gboard as the keyboard, with the on-device English pack (Settings, System, Languages, Speech, On-device recognition); in airplane mode, tap the mic in a capture and check dictation works, then cancel.
3. **Eric signs in (item 1).** Pill, enter `eric@travelboard.local` and his password, Sign in to sync. Pill reads "synced"; Version v10. The day view is empty.
4. **Separate by default (item 1).** Eric: Capture, type `Eric before linking`, Save. Gary: Capture, type `Gary before linking`, Save. Neither capture screen shows a "Share with" line. Both Sync. Each phone shows only its own capture. Each pill panel shows the other person: Gary's reads "Not linked with Eric.", Eric's "Not linked with Gary."
5. **Link (item 2).** Gary: pill, Add Eric. It reads "You added Eric. Waiting for Eric to add you". Eric: Sync, then pill: "Gary added you. Add him to link"; his day view still shows nothing of Gary's. Eric: Add Gary: "Linked with Gary". Gary: Sync, pill: "Linked with Eric".
6. **Share with, default on (item 3).** Gary: Capture. Under the bar a "Share with Eric" line is ticked. Photo, Camera, take a photo, type `Shared test`, Save. Eric: Sync. `Shared test` shows with a green "Gary" label, no queued or synced chip, and the thumbnail. Tap it: a sheet with Gary's name, the time, the photo and the text; nothing to edit, no Delete, no switches. Close.
7. **Offline on Eric's phone (items 3, 11).** Eric: airplane mode on (pill "offline"). Swipe travelboard away and reopen it: `Shared test` and its photo still show. Still in airplane mode: Capture; "Share with Gary" is ticked; type `Eric airplane`, Save: "queued". Airplane mode off; pill "synced" within about 30 s. Gary: Sync: `Eric airplane` shows with an "Eric" label.
8. **Not shared, and unsharing (item 4).** Gary: Capture, untick "Share with Eric", type `Not for Eric`, Save. Eric: Sync: `Not for Eric` does not show. Gary: tap `Shared test`, untick "Share with Eric", Save. Eric: Sync: `Shared test` and its photo are gone.
9. **From before linking (item 5).** On Eric's phone `Gary before linking` is not there. Gary: tap it; "Share with Eric" shows unticked. Tick it, Save. Eric: Sync: it appears, labelled Gary.
10. **No editing the other's (item 6).** Eric: tap `Gary before linking`: only the read-only sheet opens. Gary: tap `Eric airplane`: the same.
11. **Journals (items 9, 10).** Gary: Journal, Write `Gary private journal note`, Send; a reply comes. Eric: Journal: his day shows none of Gary's messages. Eric: Write `What did Gary note before we linked up?`, Send. His reply should mention Gary's `Gary before linking` capture by its content and should not mention `Not for Eric` or `Shared test`. Gary: Journal: none of Eric's messages.
12. **Unlink and relink (item 8).** Eric: pill, Remove, confirm. It reads "Gary added you. Add him to link". Both Sync: Gary's captures are gone from Eric's phone and `Eric airplane` from Gary's. Gary's panel: "You added Eric. Waiting for Eric to add you". Eric: Add Gary. Both Sync: Eric sees `Gary before linking` again (not `Shared test` or `Not for Eric`); Gary sees `Eric airplane` again.
13. **Eric changes his password (item 13).** Eric: pill, Change password. He types a new password of at least 10 characters twice, on his own phone only, and taps Save password: "Password changed". Sign out. Sign in with the old password: "Invalid login credentials". Sign in with the new password: "synced". If Save password shows an error about reauthentication instead, stop here and tell Claude; do not try to work round it.
14. **Gary's Change password.** Gary: pill, Change password, then Cancel: the form closes. (Change it for real only if Gary wants a new password.)

Report the time of each step, and anything that looks wrong. Claude then checks the rows, links, Storage reads and journal replies on the server.

---

## M1.1 Photo capture (SPEC.md 7A)

**Status 24/10/26 1000 hrs: M1.1 done. Every item in SPEC 7A.6 passes: items 2 to 11 on v8 (0927 to 0936 hrs), item 1 and the Camera and Gallery sheet on v9 (0956 to 0958 hrs). `checks/static.cjs` 74 of 74, `checks/smoke.sql` 74 of 74. Three days inside the 27/10/26 cut-off.**

### Device results, v9 (Pixel, Gary), 24/10/26

| Step | Result | Evidence |
|---|---|---|
| 1 Update | PASS | Rows made on v9. |
| 2 Sheet | PASS (Gary) | Camera, Gallery, Cancel. |
| 3 Camera photo offline (item 1) | PASS | `Camera test` captured 0956:16 hrs; file stored 0956:51 hrs, 35 s later (an online save stores within 1 s, as `Gallery test` did), with GPS. 720 x 1280 (the camera's 9:16 frame shrunk to 1280 px), 103 440 B. |
| 4 Gallery | PASS | `Gallery test` 0957:43 hrs, stored 0957:42 hrs (phone clock about 1 s ahead), 1280 x 1072. |
| 5 Replace by camera | PASS | `Camera test` file rewritten at the same path 0958:22 hrs; row updated the same second. |


### Device results, v8 (Pixel, Gary), 24/10/26

Gary used existing photos (screenshots and one street photo) wherever a step said to take one. Server rows, Storage objects and function logs read by Claude at 0944 hrs.

| Step | Result | Evidence |
|---|---|---|
| 2 Camera photo offline (item 1) | NOT RUN | Photo opened the Google Photos picker; no camera. The v8 input has no `capture`, and on current Android Chrome a plain image input goes to the system photo picker. Fixed in v9 (Camera and Gallery). No offline photo capture on record: every object was stored within a second of its capture. |
| 3 Gallery photo (item 2) | PASS | `Photo test 2`, 0927 hrs, synced with `photo_path`; file in `tb-photos`. |
| 4 Photo only (item 3) | PASS | 0928 hrs, empty body, 575 x 1280, 72 761 B, row and file both 0928 hrs. |
| 5 Force-close with a photo (item 4) | PASS (Gary) | `Photo draft` saved 0929 hrs with its photo and the switch off. |
| 6 The switch (item 11) | PASS | `Photo draft` `photo_to_claude` false; `Private photo` false until Gary switched it on at 0935 hrs (Claude did not see it at 0933 hrs). |
| 7 Edit | PASS | Replace on `Photo test 2`: same path, file rewritten 0932 hrs, sizes now 1280 x 1072, 193 916 B. Remove on `Photo test 1 replacement`: the four fields null, its file kept in Storage. |
| 8 Claude sees the photo (items 6, 11) | PASS | 0933 hrs reply described the two switched-on photos, including the police car and ambulance that no text mentions; nothing on `Photo draft` or `Private photo`. Files at most 1280 px, all under 200 KB. |
| 9 Cache (item 7) | PASS | 0935 hrs reply: `cache_read_tokens` 3746, log `photos: 2`. |
| 10 Switch back on | PASS | 0936 hrs reply described three photos including `Private photo` (correctly called a copy of the 0928 screenshot: same file, 72 761 B); log `photos: 3`, `cache_write_tokens` 4751, read 0 as expected. |
| 11 Failed upload (item 5) | PASS headless, nothing stuck on the Pixel | No photo left queued after its text synced. |
| Item 8 anonymous access | PASS | 01:47 UTC, from outside this sandbox (Apify web-fetch, several browsers and retries) for `Private photo`'s path: `/storage/v1/object/public/tb-photos/...` and `/storage/v1/object/tb-photos/...` with only the publishable key. Supabase's edge log shows every request answered 400; nothing served. Other-user access: smoke P9. |

### v9: Camera and Gallery, 24/10/26

| Check | Result | Evidence |
|---|---|---|
| SPEC 7A.2 | Corrected on Gary's choice | Photo opens a sheet: Camera (`capture="environment"`), Gallery (plain input), Cancel. Change-log line 24/10/26. |
| `m11.test.cjs` | PASS, 58 of 58, six runs | P1 now: two inputs (Camera with `capture="environment"`, Gallery without); Photo opens the sheet; Cancel opens no picker; Gallery and Camera each close the sheet and open their own input (Playwright file chooser); acceptance 1 attaches through Camera, acceptance 2 and Replace through Gallery. P10 and P17 waited a fixed time for a re-render and failed about one run in two on v8 as well; they now wait for the render. |
| `m1`, `m2`, `fn.test.cjs`, `static.cjs` | PASS, 103, 80, 37, 74 | No server change. |
| Deploy v9 | PASS | `main` at `aa51a09`. Live `sw.js` reads `const CACHE_VERSION = 9;` (Last-Modified 24/10/26 0950 hrs SGT), fetched through Apify. |

### Device steps (Pixel, Chrome), v9

To be run once v9 is live (Claude confirms `const CACHE_VERSION = 9;`).

1. **Update.** Update the app as before; Version v9.
2. **Sheet.** Tap Capture, then Photo: a sheet slides up with Camera, Gallery and Cancel. Tap Cancel: it closes and nothing else opens.
3. **Camera photo offline (item 1).** Turn airplane mode on (pill "offline"). Capture, Photo, Camera: the rear camera opens. Photograph something with detail. Confirm the shot. Back in travelboard the photo shows with its size (about 1280 x 960) and a ticked "Claude sees this". Type `Camera test`, Save: thumbnail and yellow "queued" chip, the pill counts the capture and the photo. Turn airplane mode off; within about 35 s it reads "synced". Note the time. If travelboard restarts while the camera is open and the photo is lost, report it.
4. **Gallery still works.** Capture, Photo, Gallery: the Google Photos picker opens. Pick a photo, type `Gallery test`, Save. It syncs.
5. **Replace by camera.** Tap `Camera test`, tap Replace, Camera, take another photo, Save. The thumbnail changes.

Claude then checks the `Camera test` file (at most 1280 px, under 500 KB) and both rows.

### Applied and deployed, 24/10/26

| Applied, 24/10/26 | Result | Evidence |
|---|---|---|
| Migration 0005 | Applied, file unchanged | Supabase migration `tb_0005_photo_fields`. Snapshot before = after 0004 (REST 517, `8726dc225828`). Diff: `travel.captures` and `travel.journal_messages` gain their columns, 4 new photo constraints, new bodies for `tb_capture_upsert`, `tb_journal_turn`, `tb_journal_reply` (ACL still `postgres, authenticated`). REST unchanged; rows intact (34 captures, 14 messages). |
| Migration 0006 | Applied, file unchanged | `tb_0006_tb_photos_bucket`. Diff: bucket `tb-photos` (private, 2097152, `{image/jpeg}`) and `tb_photos_select`, `_insert`, `_update` (authenticated, own folder). REST unchanged, the 36 `travel` and `public` objects unchanged. |
| Deploy v7 | PASS | `main` fast-forwarded to `152ce96` on Gary's yes. Live `sw.js` reads `const CACHE_VERSION = 7;` (Last-Modified 23/10/26 2359 hrs SGT), fetched through Apify. |
| `tb-journal` v2 | Deployed, version 2, `verify_jwt` on | Same `index.ts`, `context.mjs`, `prompt.ts` as the repo (`fn.test.cjs` 35 of 35). Works with the v6 client too: same request; a day with no photos sends no images. |
| Migration 0007 | Applied, file unchanged | `tb_0007_photo_to_claude`. Snapshot before = after 0006. Diff: `travel.captures` gains `photo_to_claude` (boolean, not null, default true), new bodies for `tb_capture_upsert` and `tb_journal_turn` (ACL still `postgres, authenticated`). Object count (36), REST, policies and bucket unchanged; all 34 rows switched on. Build detail: a row pushed without the field (an app from before v8) keeps the stored value on update and is true on insert, so an older app never switches a photo back on. |
| `checks/smoke.sql` after 0007 | PASS, 74 of 74 | Adds P11 (default true, false stored and pulled), P12 (`tb_journal_turn` returns `photo_path` for a switched-on photo, none for a switched-off one, both captures listed: item 11), P13 (a row without the field keeps the switch; explicit true turns it back on). |
| `tb-journal` v3 | Deployed, version 3, `verify_jwt` on | At most 30 switched-on photos per day; a switched-off photo is not fetched, sent, listed or mentioned. `fn.test.cjs` 37 of 37: F13 has 31 switched-on photos (30 sent as images, the oldest listed "not shown") and 2 switched-off ones (not fetched, no image, no photo attribute, their text still listed); F15 a missing file listed "could not be loaded". |
| Deploy v8 | PASS | `main` at `c747da5` (Gary: ship as the next version since v7 was live). Live `sw.js` reads `const CACHE_VERSION = 8;` (Last-Modified 24/10/26 0044 hrs SGT), fetched through Apify. |
| Client v8 | Built | Switch on the capture and edit screens, shown only with a photo, default on; kept in the draft, on the capture row, pushed, exported; an edit of the switch bumps `updated_at`; Share omits "with a photo" for a switched-off photo. `m11.test.cjs` 54 of 54 (P18 to P21 for the switch, including a journal turn that sends every switched-on photo and not the switched-off one), `m1` 103 of 103, `m2` 80 of 80, `static.cjs` 74 of 74. |
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

### Device steps (Pixel, Chrome), v8: SPEC.md 7A.6 (run 24/10/26, results above)

To be run once v8 is live (Claude confirms `const CACHE_VERSION = 8;`). Report the step number and what you saw for any step that does not match.

1. **Update.** Open `https://jeuron-hue.github.io/travelboard/sw.js`: it should read `const CACHE_VERSION = 8;`. Update the app as before; Version v8. Nothing else changes on screen until you open Capture.
2. **Camera photo offline (item 1).** Turn airplane mode on and check the pill reads "offline". Tap Capture. Next to note/journal there is now a Photo button. Tap it: Android offers Camera and your gallery apps. Choose Camera and photograph something with visible detail the text will not mention (a sign, a menu, a shelf). Back in travelboard the photo shows above the text, with its size (about 1280 x 960), a ticked "Claude sees this" box and Remove. Type `Photo test 1`, Save. The row shows a small thumbnail and a yellow "queued" chip; the pill counts the capture and the photo. Turn airplane mode off; within about 35 s everything reads "synced". Note the time. Claude checks the file in `tb-photos` (at most 1280 px, under 500 KB) and the row's photo fields.
3. **Gallery photo (item 2).** Capture, Photo, pick an existing photo from Google Photos or Files, type `Photo test 2`, Save. It syncs the same way.
4. **Photo only (item 3).** Capture, Photo, take a photo, and Save with no text. The row reads "(photo)" and syncs.
5. **Force-close with a photo (item 4).** Capture, Photo, take a photo, type `Photo draft`, untick "Claude sees this", and do not Save. Swipe travelboard away from recents. Reopen it: the capture screen comes back with the text, the photo, and the box still unticked. Save. If Android closes travelboard while the camera is open and the photo is lost on return, report it: that is the phone reclaiming memory, and the step is then repeated.
6. **The switch (item 11).** Tap the `Photo draft` row: the box is unticked. Close. Capture again, Photo, photograph something you would recognise (a book cover, a label), type `Private photo`, untick "Claude sees this", Save, and wait for "synced". Tap the row: still unticked. Claude checks both rows have `photo_to_claude` false on the server.
7. **Edit.** Tap the `Photo test 2` row: the full photo shows. Tap Replace, pick another photo, Save. Then open `Photo test 1`, tap Remove, Save: its thumbnail goes, the text stays.
8. **Claude sees the photo (items 6 and 11).** With signal, in Journal, Write: `Describe each photo I took today.` Claude should describe something visible in the switched-on photos that their captures' text does not say, and say nothing about the `Private photo` picture or the `Photo draft` picture (their text may come up, as text). Report what it said. Claude checks in the function log how many photos went in.
9. **Cache (item 7).** Within the hour, send one more journal message the same evening. Claude checks `cache_read_tokens` is above zero on that reply.
10. **Switch back on.** Open `Private photo`, tick "Claude sees this", Save, wait for "synced". Send one more journal message asking about it: this time Claude can describe it. (Changing a switch rewrites the photo cache once, so this reply's `cache_read_tokens` may be zero.)
11. **Failed upload (item 5)** is covered headless; on the Pixel, note it if a photo ever stays "queued" after its text synced, and whether it caught up later.

Item 8 (anonymous and other-user access refused) is checked by Claude: the smoke tests, and an anonymous REST request for one of your photo paths from outside this sandbox.

---

## Move to own project (SPEC.md 6.8)

**Status 24/10/26: steps 2 to 6 done; step 8 PASSES (Pixel and keep-alive, 2347 hrs). The move is done. Step 7 done 24/10/26 1000 hrs: nothing of travelboard left in weatherboard (below).**

Step 7, 24/10/26. Read-only inventory matched 6.8 exactly (3 tables with 33, 12 and 1 rows, 7 indexes, 11 constraints, 9 `tb_` functions, 4 history rows, 1 auth user; weatherboard's other 759 catalogue objects hash `1fc8e6b3fc48`, 12 cron jobs, bucket `radar`, 7 Edge Functions of its own plus `tb-journal`). The drop is `supabase/cleanup/weatherboard_6.8_step7.sql`: one transaction, no CASCADE, row-count guards. Sent three times through the Supabase connector; each call timed out at 60 s (the third with a 5 s lock timeout, so not a lock wait), and each time a read-only check showed nothing changed and no session left behind. Most likely the connector's confirmation for destructive statements went unanswered. Gary then ran the same file in weatherboard's SQL Editor at 0017 hrs 24/10/26: "Success". Checked after: weatherboard's other catalogue objects unchanged (759, hash `1fc8e6b3fc48`, same as before, covering tables, functions, cron jobs and the `radar` bucket); nothing named `travel`, `tb_` or `tb-` left in the database; the 4 history rows gone; its 7 own Edge Functions unchanged (same versions and hashes). Left for Gary in the dashboard: Edge Function `tb-journal` and auth user `gary@travelboard.local` (both still present at 0019 hrs). Gary deleted both; checked 24/10/26 1000 hrs: weatherboard lists only its own 7 Edge Functions, no `gary@travelboard.local`, no schema `travel`, no `tb_` functions, no `tb_` history rows, no `tb` bucket. Step 7 done.

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
