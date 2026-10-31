# CLAUDE.md: travelboard

Standing brief for Claude Code. Read this file, then `SPEC.md`, before doing anything.

## What this is

travelboard is Gary Chan's personal travel app: a phone PWA (`trip.html`) for capture, voice notes and journalling with Claude, and later a rig planner (`planner.html`). Two users from M1.2: Gary and his travel companion Eric, each on his own Android phone. Built module by module; each module is specified in `SPEC.md` with an acceptance list.

## Current module

**M1.3 Look and place** (`SPEC.md` 7C), in two sessions (7C.6), from the approved mockup (7C.8). Gary's go 24/10/26. M1.2 Two travellers (7B) is built; its two-phone test runs on the M1.3 design. Both pass on the phones by 05/11/26; freeze 06/11/26. If either is slipping, stop and tell Gary. M0 done 04/10/26, M1 done 10/10/26, M2 done 23/10/26, the move and M1.1 done 24/10/26. **M1.4 Capture days** (`SPEC.md` 7D, client 0.15.0) added 26/10/26 on Gary's decision; it passes on both phones by 05/11/26 too. **0.16.0** (27/10/26, Gary's decisions after step 9): the place-you-are-in chip and the Locate button (`SPEC.md` 7.2, 7C.4, 7C.7 items 4a and 4b), same cut-off. The shakedown (26/10 to 06/11) is fixes only apart from finishing M1.2, M1.3 and M1.4. Do not start M3 or any later module until Gary says go.

## Hard rules

1. **Own Supabase project.** travelboard lives in its own project `travelboard` (ref `nnnnonspfljdkrxstslw`, org `jeuron`) from 23/10/26. Within it, keep travelboard's naming: schema `travel`, functions `public.tb_*`, Edge Functions `tb-*`, secrets `TB_*`, Storage bucket `tb-photos` with policies `tb_photos_*`. Leave Supabase's own schemas alone except where a migration names the change. The `weatherboard` project (ref `nyjsrnntxdgfykkmihpx`) runs Gary's live weather fleet: never create or change anything there. Read-only queries there are allowed for the data copy in `SPEC.md` 6.8; dropping travelboard's old objects there needs Gary's explicit yes, in one transaction, with a catalogue diff. Run a catalogue snapshot before and after each migration and confirm the diff matches what the migration says.
2. **Migrations:** one block at a time, each wrapped in a transaction, saved as a numbered file in `supabase/migrations/`. Show the output of each block before applying the next. No destructive statement without Gary's explicit yes in chat.
3. **Data access:** tables in `travel` get no grants to `anon` or `authenticated`. The client reaches data only through `SECURITY DEFINER` RPCs with `set search_path = travel, public`, `revoke all from public, anon`, `grant execute to authenticated`, and a check that `auth.uid()` is not null.
4. **Keys:** the publishable key may sit in client source (fetch it with the Supabase connector, do not guess it). `service_role` never appears in any file in this repo. The Anthropic key exists only as the Edge Function secret `TB_ANTHROPIC_API_KEY`, set by Gary in the dashboard of project `travelboard` from the Console workspace `travelboard`. Never use or ask for weather's key.
5. **No build step.** Vanilla HTML, CSS and JS. Libraries are pinned and vendored into `vendor/` so the app works offline. No npm runtime dependencies in the shipped site.
6. **Offline-first.** The phone UI reads IndexedDB only. Supabase is a sync target, never a render source. A capture must save with no network, no session and no GPS.
7. **Never auto-parse transcripts** into structured fields.
8. **Never hard delete** from the client. Soft delete via `deleted_at`.
9. **Service worker:** bump the cache version on every release; never call `skipWaiting` automatically.

## Conventions

- Single-file pages (`trip.html`, later `planner.html`) with markup, styles and script inline. `sw.js` and `manifest.webmanifest` are separate files by necessity.
- Each HTML file opens with a comment block: "SOURCE OF RECORD", what it does, then a line pointing to CHANGELOG.md, which holds the change history (moved out of the headers 30/10/26; see Versions and changes).
- Styling: travelboard's own field-notebook identity from M1.3 (`SPEC.md` 7C): a vendored serif for headings, IBM Plex Sans for body and UI, colour tokens on `:root` with light and dark sets, `data-theme` on `documentElement`, theme choice in `localStorage`. Reuse weatherboard's token names where they exist; exact values come from the approved mockup.
- UI: dates dd/mm/yy, times 24-hour (for example 0901 hrs), SI units, no em dashes in UI copy.
- Phone-first layout: primary actions in thumb reach at the bottom, large tap targets, works one-handed.

## Versions and changes
The same rule runs in every app repo (retouch, filter, travelboard, icantell), agreed with Gary 30/10/26. The full method is in the version-release skill.
- Numbers run x.y.z. Patch (z): a fix or retuning, nothing new to learn. Minor (y): something new Gary can do, a finished module, or a visible redesign; the patch goes back to 0. Major (x): 1.0.0 only when Gary declares the app finished after real use; after that x moves only when something old stops working (saved data, a file format). Until then the app stays on 0.x.
- One version per release. A release is any change to the app that reaches main. Docs-only and test-only work carries no bump and is listed in the next version's entry. A work-in-progress checkpoint does not bump the version; the bump goes in the commit that completes the release.
- The bump changes APP_VERSION in trip.html and CACHE_VERSION in sw.js together, in the release commit, and the commit subject ends with (vX.Y.Z).
- CHANGELOG.md gets the version's entry in the same commit, at the top (newest first): a heading `## vX.Y.Z, dd/mm/yy HHMM hrs`, optionally followed by `, <phase>`, giving the date and time the release commit is made, in Singapore time; then one or more `- ` lines saying what changed, in plain words. Reasons and phone results stay in SPEC.md (with its own change log of decisions) and TESTS.md. A released entry is changed only to correct a fact.
- checks/static.cjs fails if a heading lacks the version, date or time, the newest entry is not the current version, versions or times are out of order, or an entry has no change line.
- Each release is built on its own branch and merged by Gary through a pull request; GitHub deletes the branch when the pull request is merged. Releases are tagged vX.Y.Z on their commit in main from the rig, in a batch when Gary asks (version-release skill, section 2). A build session stops at the merge: it does not tag, delete branches, or mention either (a cloud session cannot push tags or delete branches).

## Definition of done

A module is done when every item in its acceptance list in `SPEC.md` passes, `checks/static.cjs` passes, and `checks/smoke.sql` passes. Write the dated results into `TESTS.md`. On-device steps are run by Gary on his Pixel; write them as numbered steps he can follow and report back on.

## When the spec is wrong

If something in `SPEC.md` is wrong, contradictory or impossible, stop, tell Gary what and why, propose the correction, and once he agrees, fix `SPEC.md` in the same session and add a change-log line. Do not build around a known error, and do not silently diverge from the spec.

## Deploy

GitHub Pages from `main`, repo root. After a deploy, confirm the live page serves the new service worker version before reporting done.

## Reporting

Short. What was built, what passed, what failed, what Gary needs to do (dashboard steps, device tests). Put decisions to him directly as questions; do not park them in a list for later.
