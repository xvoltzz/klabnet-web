# The bug review, still to do (written 2026-11-20)

The big refresh (Social/Contacts and calls, Videos with Clips, the Studio, TV, Live, screen share, the voice panel, Home) is on prod. The owner asked for everything to be reviewed for bugs: "dig into bugs… please review everything, lock in". Two areas are done:

- **Videos core, uploads, TV, watch parties, the mini player.** A 13 GB upload "never showed up" on prod: multipart bodies were spooled whole into the container's /tmp and then refused at the old 4 GB cap. Now uploads go in resumable 32 MB parts straight onto the share (klabnet-api 25b4d6b, klabnet-web d71b011). The players also stop retrying a dead stream in a tight loop.
- **Calls, extensions, Contacts, the new Home.** These were built and tested last (klabnet-api 340ad50, klabnet-web f1d4dff), so they're freshest and not in a review below. Still worth a look later.

Three reviews were started and stopped partway, because the laptop overheated. Their partial fixes are committed. Run them here, **one at a time** (each opens headless Chrome and the API).

## How to run one

Open Claude Code in klabnet-web and paste this, filling in the review's letter:

> Read docs/review-plan.md and run review **A** (or B, C) from it. Follow "How to work" exactly.

Before starting, pull both repos (`git pull` in klabnet-web and klabnet-api), so the rig runs the API that prod has.

## How to work (every review)

- **Brief.** Find and FIX real bugs in your area. Not style nits, not refactors. In priority order:
  1. Crashes and page errors.
  2. Things that silently stop working: stuck states, polls that die, promises that never settle, leaking listeners or timers, stale caches.
  3. Wrong data.
  4. Security and permission holes in the API: an auth check on every write, path traversal on file routes, SQL built from strings, size limits.
  5. Races between parallel actions.
  6. Prod-only failure modes. Prod sits behind Caddy and Authentik forward_auth: an expired session turns API calls into a 302 or an HTML page. Proxies answer 413/502/504 with HTML bodies. Also big files, slow links, and the API restarting mid-action.
  7. Phones, and the desktop app (Electron).
  8. A page left open for days, two tabs or devices at once, and an API older than the site.
- **Read first:**
  - CLAUDE.md in full. It's the map of what everything is and why, including the owner's words.
  - AGENTS.md's "Running and testing it on this machine", which sets up the local rig on this Windows/WSL desktop. A Chrome-and-API rig is the only way to see the site without Authentik.
  - Then read your area's code in full, line by line.
- **Reproduce on the rig** at `http://localhost:8791`:
  - **Identity:** the `x-dev-user` header (tester, alice, bob…).
  - **Drivers:** `tests/drive/shoot.mjs` (screenshots) and `tests/drive/probe.mjs` (prints each step's JS result; only steps named `shot*` are screenshotted).
    - Usage: `node shoot.mjs <outdir> desktop|phone dark|light [steps.json]`, where steps are `[[name, js, waitMs], …]`.
    - Set `CHROME` to Chrome's path (`set CHROME=C:\Program Files\Google\Chrome\Application\chrome.exe`) and `RIG` if not on :8791.
    - A step that returns a promise hangs. Wrap it as `void (async()=>{…})(); 0`.
    - On Windows, make sure Chrome is gone at the end (AGENTS.md: `taskkill /PID … /T /F`, never by name).
  - **Motion:** headless runs with motion off (`klabMotionOk()` is false), so animations jump to the end. Set `window.klabMotionOk = () => true` to test them. That's how the title bar prompt's endless retype loop shows itself.
  - **Theme:** the rig syncs tester's theme pref. After a light-theme run: `curl -X PATCH localhost:8791/api/prefs -H "content-type: application/json" -d "{\"theme\":\"dark\"}"`.
  - **Voice, screen share, calls and live** need a dev LiveKit (CLAUDE.md "Voice" → Testing it locally). Two or three Chrome processes as different users, with `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream --auto-select-desktop-capture-source="Entire screen"`.
  - **Load:** keep it light. One Chrome at a time except for two-person tests, no big video encodes, and stop what you start.
- **Fixing:**
  - Use minimal, targeted edits. `node --check` every JS file you touch; ast-check the Python.
  - Bump the version when you're done (CLAUDE.md: `KLABNET_VERSION` and every `?v=`, then `./check-version.sh`). If you used a new `ti-*` icon, rebuild the font (`scripts/build-icons.py`).
- **Committing:**
  - Commit as `xvoltzz <40217474+xvoltzz@users.noreply.github.com>`, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - klabnet-web works on `refresh`, fast-forwarded into `main`. klabnet-api commits to `main`.
  - Push to `origin` (Gitea) only. The owner deploys prod.
- **Report:** tightly, most severe first. For each bug: where, what went wrong, how you confirmed it, and the fix. Then what's suspicious but unconfirmed, and what you couldn't test.

## Review A: Clips and the Studio

klabnet-web `js/42-clips.js`, `js/43-studio.js` (CSS "CLIPS", "VIDEO STUDIO"). klabnet-api `app/routers/clips.py`, `app/routers/studio.py`, and the parts of `videos.py` they call (edit rendering, rebuild, clip cut).

Already fixed when it was stopped:
- A crafted edit list raising in the worker.
- A render that failed after the edit changed.
- A thumbnail picked mid-render.
- Retrying a failed render.
- The processing view redrawing.
- Clip uploads stalling the queue.
- Hover-play off the page.

Still to look at:
- **Permissions:** only the owner or an admin edits, renders, deletes or makes upload-timeline clips. Anyone can vote, once per poll.
- **Links and text:** card and annotation link URLs must be sanitised (no `javascript:`, `rel=noopener`, external links shown as such), and text rendered escaped.
- **Timing:** revert while rendering, editing a video still processing, deleting a video mid-render, a clip of a clip, clips longer than `CLIP_MAX_SECONDS` via the edited timeline.
- **The clip viewer:** ←/→ across a list that changes, hover-play leaking hls instances.
- **Overlays and polls:** overlay timing in full screen and PiP, polls racing.

Exercise it end to end:
- **Studio:** edit, render, revert, then annotations, cards and the end screen on a viewer's page.
- **Clips:** upload several, make a clip from an edited video, step through the viewer.

## Review B: voice, screen share, the voice panel, live streaming, calls

klabnet-web `js/22-voice.js`, `js/45-live.js`, `js/46-calls.js`, the voice and live parts of `js/07-tabnav.js` `place()`, and `js/25-social.js` (Together's voice and live cards). CSS "VOICE: SCREEN SHARE", "VOICE: THE PANEL", "LIVE", "CALLS AND CONTACTS". klabnet-api `app/routers/voice.py`, `live.py`, `calls.py`, and the voice, live and call parts of `rooms.py`, `presence.py` and `recap.py`. Also `compose.yml`, `livekit.yaml`, and README "Voice" / "Live streaming": check the deploy instructions against LiveKit's documented config (ports, env names, livekit/ingress v1.6 config keys, the Caddy snippet).

The owner hasn't tried streaming, screen sharing or calls for real yet. Look especially at:
- **The mic:** a mute that fails must never leave a mic open. This applies to calls too.
- **Reconnects:** LiveKit restarting, the network dropping, a laptop sleeping.
- **Second devices:** joining on another device; calls ringing on two devices.
- **Leaving:** leaving while sharing; hanging up while ringing or connecting.
- **The stage:** sharers coming and going; screens subscribed when nobody watches.
- **The panel:** its placement as the sidebar hides and shows, and on narrow windows.
- **Do not disturb:** gating for shares, calls and live.
- **Token grants:** can a viewer token publish? Can someone get another user's stream key or rotate it? Can anyone join a call room they weren't in?
- **Live chat permissions.**
- **The ingress poll thread:** it must not die on an exception.
- **Streams and calls** that never end in the DB.
- **`LIVE_INGRESS` off:** everything hidden, with no errors.

End with a short checklist for the owner's first real test of screen share, calls and OBS.

## Review C: the shell, Music, Social's Feed and Chat, Photos, everything else

Everything else in klabnet-web, focused on what the refresh changed. See `git log` since `4424523` and `git diff 4424523..main -- <file>`. In particular:
- **Core:** `js/00-util.js` (klabMenu, klabLayers, klabUndo, toasts) and `js/01-shell.js` (the prompt, keys, `KLAB_KEYS`).
- **Music:**
  - `js/02-player.js` and `js/03-picker-tabs.js`: the queue popover, drag to reorder, shuffle and repeat, `klabRestorePlayer`.
  - `js/05-favorites.js`: the Songs/Albums/Artists switch.
  - `js/07-tabnav.js`: the sidebar tree, `FRONT`, deep links.
  - `js/09`/`js/15`: Music itself.
- **Pages:**
  - `js/14-photos.js`: Timeline, Your photos and Tagged, and Sort.
  - `js/23-session.js`, with the queue.
  - `js/18-home.js` and `js/33-plaza.js`: the minimal Home and What's new.
  - `js/47-contacts.js`.
- **The rest:**
  - `js/32-terminal.js`: Go anywhere.
  - `js/34-emoji.js`, `js/35-profile.js`, `js/36-recap.js`.
  - `sw.js`.
- **CSS:** the COMPONENTS and REFRESH blocks in `css/app.css`. Visual bugs: overlapping things, invisible text in the Light, Wood, Sky and OLED themes, the phone layout.
- **klabnet-api:** `week.py`, `recap.py`, `people.py`, `posts.py` (PATCH edit), and prefs (`fav_albums`/`fav_artists`).

Look especially at:
- **Runaway loops** like the prompt's: timers or rAF loops that never stop, observers that retrigger themselves, polls that keep running off-page or double up after tab switches.
- **Escape:** klabLayers getting stuck. An overlay that never unregisters leaves Escape dead.
- **Undo toasts** that commit twice or never.
- **The queue popover** with the session's remote mode, and with 2,000+ songs.
- **This week's date maths** across time zones, DST and Monday boundaries; the recap's `since`.
- **Go anywhere** with no API.
- **The service worker's** `?v=` recheck.
- **A page open for days:** memory and timers.
- **Shortcuts firing while typing.**
- **First load** with an empty localStorage.
- **An API older than the site:** 404/405 handled everywhere.

Count timers, intervals and listeners before and after visiting each page several times.

---

# Features to build next (after the reviews)

The owner picked two of the ideas from 2026-11-20. Build them after reviews A to C, one at a time, the same way. Follow "How to work" above for the rig, drivers, load, commits and pushing to Gitea only. Then add a section to CLAUDE.md for each.

## Feature D: the dialer reaches channels

Extensions 800–999 were kept free for this (CLAUDE.md "Calls, extensions, Contacts"; klabnet-api `app/routers/calls.py`). Make the dialer a remote for all of klabnet:

- **8xx is a voice channel.** 801 is the first channel and so on, in the channels' own order. A channel gets a fixed number once it exists, stored in klabnet-api, so it doesn't shift when one is deleted. Dialing joins it, with the same "leave your call?" prompt as now.
- **9xx is a TV channel.** 9 + the channel's own number, so 903 is TV channel 3 (TV numbers are 1–99). Dialing opens it in Videos, or in the mini player if you're elsewhere.
- **Showing numbers:** wherever channels show (the voice group, TV's list and guide, the dialer's as-you-type lookup, Contacts' find box, Go anywhere), show the number dim beside the name, like a person's extension.
- **No match:** an unknown number says so ("Nothing on 857").
- **Radio, maybe:** 7xx for radio stations would be natural, but 100–799 are people's. Ask the owner before taking any range.
- **Tests:** dialing each kind by keyboard and by keypad, a deleted channel's number, and dialing while in a call.

## Feature E: streams saved as videos

When a live stream ends, it lands in the streamer's Videos, so Clips' "Make a clip" works on it (CLAUDE.md "Live streaming"; klabnet-api `app/routers/live.py`).

- **Recording:** use LiveKit **Egress** (a room-composite or track-composite egress of the `live-<user>` room to an MP4 file on the media share), started when the stream goes live and stopped when it ends.
  - Add the `egress` service to compose.yml beside `ingress`. It uses the same Redis, and its config goes through an env body like ingress.
  - Document it in the README: the profile, its ports, and its CPU and GPU needs. Egress can use NVENC on the 4070 Ti; see README "GPU (NVIDIA)".
- **Settings → Streaming:** a switch, "Save my streams to Videos", on by default, plus per stream "Don't save this one" while live.
- **After a stream ends:** the file goes through the normal video pipeline (`videos.create`, `queue_it`), with:
  - `published` = the stream's start;
  - title = the stream's title, with game and description carried over;
  - `unlisted` until the streamer publishes it, or public at once (ask the owner which default).
  The stream's chat stays readable beside the video if that's cheap (the `live_chat` rows keep their stream id); otherwise leave it.
- **Where it shows:** the Live page's "Earlier" rows link to the saved video, and the recap says "alice's stream is up".
- **Short streams:** under 60 seconds aren't saved. Remove the file.
- **Failure modes:** egress not running means streams still work and simply aren't saved (log it, show nothing broken). A disk that fills mid-stream stops the recording without stopping the stream.
- **Tests:** the live harness from the Live pass (Ingress under bwrap and ffmpeg as OBS) plus Egress the same way if it can run there. If it can't, test the API side with a stubbed egress and say what's unverified.
