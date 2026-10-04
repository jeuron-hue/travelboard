# CLAUDE.md: travelboard

Standing brief for Claude Code. Read this file, then `SPEC.md`, before doing anything.

## What this is

travelboard is Gary Chan's personal travel app: a phone PWA (`trip.html`) for capture, voice notes and journalling with Claude, and later a rig planner (`planner.html`). One user. Built module by module; each module is specified in `SPEC.md` with an acceptance list.

## Current module

**M1 Capture** (Gary's go 04/10/26). M0 Foundation is done. Do not start M2 or any later module until Gary says go. If you finish early, stop and report.

## Hard rules

1. **Shared Supabase project.** travelboard lives inside the `weatherboard` project (ref `nyjsrnntxdgfykkmihpx`), which runs Gary's live East Sky Board weather fleet. You may create or change only:
   - schema `travel` and objects inside it
   - functions in `public` whose names start with `tb_`
   - Edge Functions whose names start with `tb-`

   Never alter, drop, rename or grant on anything else: no `public` tables, no `prices` schema, no cron jobs, no other Edge Functions, no auth settings beyond turning self-signup off. Run a catalogue snapshot query before and after each migration and confirm the diff touches only travelboard objects.
2. **Migrations:** one block at a time, each wrapped in a transaction, saved as a numbered file in `supabase/migrations/`. Show the output of each block before applying the next. No destructive statement without Gary's explicit yes in chat.
3. **Data access:** tables in `travel` get no grants to `anon` or `authenticated`. The client reaches data only through `SECURITY DEFINER` RPCs with `set search_path = travel, public`, `revoke all from public, anon`, `grant execute to authenticated`, and a check that `auth.uid()` is not null.
4. **Keys:** the publishable key may sit in client source (fetch it with the Supabase connector, do not guess it). `service_role` never appears in any file in this repo. `ANTHROPIC_API_KEY` exists only as an Edge Function secret set by Gary in the dashboard.
5. **No build step.** Vanilla HTML, CSS and JS. Libraries are pinned and vendored into `vendor/` so the app works offline. No npm runtime dependencies in the shipped site.
6. **Offline-first.** The phone UI reads IndexedDB only. Supabase is a sync target, never a render source. A capture must save with no network, no session and no GPS.
7. **Never auto-parse transcripts** into structured fields.
8. **Never hard delete** from the client. Soft delete via `deleted_at`.
9. **Service worker:** bump the cache version on every release; never call `skipWaiting` automatically.

## Conventions

- Single-file pages (`trip.html`, later `planner.html`) with markup, styles and script inline. `sw.js` and `manifest.webmanifest` are separate files by necessity.
- Each HTML file opens with a comment block: "SOURCE OF RECORD", what it does, then a dated change log, newest first (same convention as weatherboard's `index.html`).
- Styling follows weatherboard: IBM Plex Sans, colour tokens on `:root` with light and dark sets, `data-theme` on `documentElement`, theme choice in `localStorage`. Reuse weatherboard's token names; travelboard gets its own accent.
- UI: dates dd/mm/yy, times 24-hour (for example 0901 hrs), SI units, no em dashes in UI copy.
- Phone-first layout: primary actions in thumb reach at the bottom, large tap targets, works one-handed.

## Definition of done

A module is done when every item in its acceptance list in `SPEC.md` passes, `checks/static.cjs` passes, and `checks/smoke.sql` passes. Write the dated results into `TESTS.md`. On-device steps are run by Gary on his Pixel; write them as numbered steps he can follow and report back on.

## When the spec is wrong

If something in `SPEC.md` is wrong, contradictory or impossible, stop, tell Gary what and why, propose the correction, and once he agrees, fix `SPEC.md` in the same session and add a change-log line. Do not build around a known error, and do not silently diverge from the spec.

## Deploy

GitHub Pages from `main`, repo root. After a deploy, confirm the live page serves the new service worker version before reporting done.

## Reporting

Short. What was built, what passed, what failed, what Gary needs to do (dashboard steps, device tests). Put decisions to him directly as questions; do not park them in a list for later.
