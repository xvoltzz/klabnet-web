# klabnet-web: notes for Codex

Two agents work on this repo: Claude Code (reads `CLAUDE.md`) and Codex (reads this file). `CLAUDE.md` is the owner's rule book and is authoritative: read it first, all of it. This file adds what Codex needs to do its own deep dive after the bug-fix pass of 2026-10-06 (`v2026.10.06.3`): what the project is, how to run and test it on this machine, what that pass changed, what it could not verify, and what it left open.

## The project in one screen

- klabnet is the klab.gg homelab's own app, one site at `user.klab.gg` behind Authentik: Home, Feed, Chat (Matrix), Music (Navidrome over the Subsonic API) and Photos. The same page is the inside of the desktop apps.
- Sibling repos, all under `~/projects/`:
  - `klabnet-api`: FastAPI + SQLite, everything under `/api/*`. Identity comes from `X-Authentik-*` headers that Caddy adds.
  - `klabnet-desktop`: the Electron app (Windows, Linux, macOS). `src/preload.js` defines `window.klabnetDesktop`.
  - `klabnet-kde`: the native KDE app, same bridge shape.
- No build step and no framework. `index.html` loads `css/app.css` and `js/NN-*.js` as classic `<script defer>` files, in order, sharing globals. Top-level `const`/`let` are global bindings but not `window` properties. Later files wrap earlier functions by reassigning them (`playSong`, `nextSong`, `loadPickerTab`, `openFS`, `showToast`, `updateQueueBadge`), so grep for `<name> = ` before changing a function's signature.
- `README.md` is partly out of date (it says everything is in `index.html`). Trust `CLAUDE.md` and the code.

### What lives where

| File | What it holds |
|---|---|
| `index.html` | All markup, three inline boot scripts (performance mode, desktop-app chrome, nav mode), `KLABNET_VERSION` |
| `css/app.css` | Everything, ~7,900 lines. Later blocks override earlier ones on purpose; the platform skins are at the end |
| `js/00-util.js` | `fetchTimeout`, `esc`, `linkifyHTML`, `klabMenu` (right-click menus), `klabSoften`, `klabCleanSong`, `klabPostSong`, `klabCount`, `klabCap` |
| `js/01-shell.js` | Header prompt and splash text (MOTD), theme and background colour, global keyboard shortcuts |
| `js/02-player.js` | Player state, `playSong`, sliders, song list rendering, toasts, full-screen player |
| `js/03-picker-tabs.js` | Albums, artists and the queue views |
| `js/04-sfx.js` | UI sounds (`SFX`), Media Session |
| `js/05-favorites.js` | Favourites, play history, the dock's heart and star |
| `js/06-prefs.js` | Prefs sync with the API, settings, desktop notifications, update check |
| `js/07-tabnav.js` | Tab router (`setActiveTab`), Settings panel, sidebar navigation, desktop-app integration |
| `js/08-chat.js` | Chat on matrix-js-sdk 42.3.0 (loaded from esm.sh), dialogs (`showConfirmDialog`, `showInputDialog`), image viewer, profile modal |
| `js/09-music-extras.js` | Genres, song menu, sorting, music requests, high-res art |
| `js/09b-playlists.js` | Playlists: covers, descriptions, featuring, the playlist page and editor (see `CLAUDE.md`, "Playlists") |
| `js/10-lyrics.js` | Lyrics, playback keys (Space, arrows, M), wheel volume |
| `js/11-presence.js` | Presence beats and polling, away status, listening parties, notes |
| `js/11b-markdown.js`, `js/11c-gifs.js` | Markdown (marked + DOMPurify), the GIF picker |
| `js/12-feed.js` | Feed: posts, replies, reactions, composer, mentions |
| `js/13-tail.js` | Mouse Back button, accent colour from album art, album and artist pages |
| `js/14-photos.js`, `js/19-slideshow.js` | Photos and its slideshow (through `window.klabPhotos`) |
| `js/15-music-home.js` | Music Home, Cover Flow, shuffle wheel |
| `js/16-motion.js`, `js/17-history.js` | Sliding selection pills; browser Back/Forward through screens |
| `js/18-home.js` | Home tab: spotlight, tiles, the "what just happened" line |
| `js/20-mentions.js`, `js/21-stars.js` | @mention suggestions (not in chat); stars on songs and albums |
| `js/22-voice.js` | Voice channels on LiveKit (see `CLAUDE.md`, "Voice"); `js/vendor/livekit-client.umd.js` loads on first join |
| `js/23-session.js` | One player on every device: the active one plays, the rest are its remotes (see `CLAUDE.md`, "One player on every device"). Loads last; makes `playerState.audio` stand in for the active device's |

## Rules that bite

These are in `CLAUDE.md`; repeated because breaking them ships a broken site.

- **Every CSS or JS change needs a version bump**, including while testing. Bump `KLABNET_VERSION` and every `?v=` in `index.html` together, then run `./check-version.sh`:
  `sed -i 's/v2026\.10\.06\.3/v2026.10.06.4/g' index.html && ./check-version.sh`
  Bump from whatever the file says now; the other agent may have moved it. The service worker serves `?v=` files cache-first.
- **Push only when the owner says so.** "push" means all four remotes (Gitea, GitHub, staging, prod). Prod is the live site.
- Commit as `xvoltzz <40217474+xvoltzz@users.noreply.github.com>`.
- A new `ti-*` icon means rebuilding the subset font with `scripts/build-icons.py`.
- Design: Music is the reference. Sentence case, radius 6 to 10px, two button kinds, pointer on everything you press, no text selection outside inputs, scrollbars hidden, phone layout only under `(max-width: 760px) and (pointer: coarse)`, no new never-ending animations. The owner cares a lot about consistency.
- Memory rules for images (blurred backdrops go through `klabSoften`, call `klabnetDesktop.trimMemory()` when letting go of many big pictures) are in `CLAUDE.md`.
- Before starting: `git pull`. Two agents edit this tree, so don't revert changes you didn't make; if something looks wrong, check `git log -p` for the reason first. Most odd-looking code here has a comment saying which bug it fixed.

## Running and testing it on this machine

WSL has no `node` and no Chrome. What works:

- **Node:** `/mnt/c/Users/xvoltzz/AppData/Local/hermes/node/node.exe` (v22). Give it Windows paths: `node.exe --check "$(wslpath -w js/08-chat.js)"`. Environment variables cross with `WSLENV=NAME`.
- **Chrome:** `C:\Program Files\Google\Chrome\Application\chrome.exe`, headless, driven over the DevTools protocol from a Node script (Node 22 has a global `WebSocket`). Use a random `--remote-debugging-port` and a temp `--user-data-dir`, and end with `taskkill /PID <pid> /T /F`. A leftover instance on a fixed port gets reused, init scripts included, and gives false errors. The owner's own Chrome is usually open: never kill `chrome.exe` by name.
- **The API:** run the real one locally. System python has no pip: `python3 -m venv --without-pip venv`, fetch `get-pip.py`, then install fastapi, uvicorn, httpx, python-multipart, Pillow, pillow-heif. The local `klabnet-api` clone can be behind Gitea, so `git fetch` and run from `git archive origin/main` extracted somewhere temporary. Wrap it like this and start with `uvicorn dev:app --port 8791`:

```python
import os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
os.environ.setdefault("DB_PATH", os.path.join(HERE, "data", "prefs.db"))
os.environ.setdefault("MEDIA_DIR", os.path.join(HERE, "media"))   # touch media/.klabnet-media or uploads answer 503
sys.path.insert(0, os.path.join(HERE, "api"))                      # the extracted klabnet-api
from app.main import app as api
from starlette.staticfiles import StaticFiles
static = StaticFiles(directory=os.path.expanduser("~/projects/klabnet-web"), html=True)

async def app(scope, receive, send):
    if scope["type"] == "lifespan":
        return await api(scope, receive, send)
    if scope["type"] == "http" and scope["path"].startswith("/api/"):
        user = next((v.decode() for k, v in scope["headers"] if k == b"x-dev-user"), "tester")
        scope = dict(scope, headers=list(scope["headers"]) + [
            (b"x-authentik-username", user.encode()), (b"x-authentik-groups", b"klabnet-admin")])
        return await api(scope, receive, send)
    return await static(scope, receive, send)
```

  Seed other people by sending requests with an `x-dev-user` header. Windows Chrome reaches it at `http://localhost:8791/`.
- **What that rig covers and what it can't:**
  - Navidrome (`music.klab.gg`) is reachable from here, so Music shows the real library. Don't play songs, star, or change anything there from a test.
  - Chat needs a Matrix SSO login, so no chat code runs. The first click or key anywhere opens the SSO popup; set `window.open = () => null` before the page loads or the headless page navigates away to the Authentik login.
  - Headless has no GPU, so the page is in performance mode (`data-fx="low"`): no blur, no backdrops. Google Fonts fail to load there too, so text metrics are a fallback font's.
  - The desktop skins can be previewed by defining a fake `window.klabnetDesktop` before load (shape in `klabnet-desktop/src/preload.js`; `getSettings()` must return `version`, `platform` and `update: { state: 'idle' }`). A fake Acrylic or vibrancy material renders washed out in headless; that is the fake, not a bug.
  - Not covered at all: a real phone, real GPU effects, the real Electron app, two people in a listening party.

## What the 2026-10-06 pass did

Six read-only reviews (shell, music, chat, presence/feed/home, photos, CSS), each finding checked against the code before fixing, then every tab, light theme, sidebar navigation and four desktop skins run in headless Chrome with no script errors. About 120 fixes in 26 files. The ones a second reviewer should know about, because they changed how something works:

- **Feed:** every post had `data-post-id=""` (a doubled quote in `postHTML`). That one character broke per-post reconciliation, the typing guard, the right-click menu and `klabFeedFocus`. Fixed, plus: `postRenderKey` follows the roster through `_peopleVer` and the markdown cache clears on `klab:people`; `textMentions` counts "@bob."; the feed polls while hidden if desktop notifications are on; a held-back post redraws on `focusout`; a replies fetch that raced your own reply is discarded and refetched.
- **Stars (`js/21-stars.js`):** `klabStars.ensure(key)` fetches one item's stars, and `klabStars.toggle(key, want)` takes the intended state, because the server only flips. Unknown keys paint blank; a failed toggle no longer pins the cache; a batch GET no longer overwrites a newer toggle.
- **History (`js/17-history.js`):** `depth` is gone; each pushed entry carries `klabAt` in `history.state`. Back from an album or artist page to the list it opened over just closes the panel (`underPanel`), instead of reloading the list.
- **Prefs (`js/06-prefs.js`):** after a PATCH, the base is set from what was sent (`changes[n]`), not from what the field holds by then.
- **Presence (`js/11-presence.js`):** a locked device reports `activeAgo >= lockedFor` so the server's `active_at <= locked_at` rule holds; with Away switched off it still sends in-page activity; `nextSong` does nothing for a party follower whose song ended (the host's tick brings the next one), and the watchdog moves on if the host has gone.
- **Chat (`js/08-chat.js`), none of it run:** see the next section.
- **Photos and slideshow:** only the primary button taps to zoom; keys stand aside for the image viewer; `klabPostSong` maps the API's `songId` to `id` (the "Play song" menu items never showed); delete stays on a neighbour; `total` follows posts and deletes; `hasOlder` also trusts `total`, since the API can return a short page; preload eviction is least-recently-used; slideshow `mergeNew` appends older pages instead of jumping the queue; "Mine" with nothing of yours falls back to everyone's.
- **Player:** unmute keeps the slider's volume; the wheel over the dock slider steps once; `getActiveLine` is computed from the current time for the current song only; `updateMediaSession` skips rebuilding metadata for the same song; play history and playlists store `slimSong` records; Albums and sorted Songs caches live ten minutes (`LIBRARY_TTL_MS`).
- **Shell:** `g`-chords stop propagation; Tab, digits and `g x` do nothing under the full-screen player or the slideshow; the splash text tilts less when long (`--motd-tilt`, `fitMotdText`) so it stays in the window; accent sampling is once per cover and only when playing flips.
- **CSS and wording:** view titles are 30px on Feed, Home and Chat; the app sidebar's rows match Music's; dialog text is 12 to 13px; toasts are `z-index: 3500`; the GIF picker is 405, under dialogs; Music's scrollbars are hidden; sentence case across menus, toasts and empty states; counts go through `klabCount`; server error strings through `klabCap`.

Two changes in behaviour the owner was told about: a conversation invite from someone on the same homeserver is accepted automatically (`acceptDmInvites`), and Photos text is no longer selectable on a desktop.

## Not verified: start here

**Every chat change was made by reading, with no Matrix session to run it.** These deserve a real run on staging, and a second read:

- `Room.localEchoUpdated` handler in `bootClient`: cancels events with status `not_sent` (`client.cancelPendingEvent`). Check it against how `sendChatMessage` restores the text on failure, and that a retry by the SDK's scheduler isn't cut short.
- `acceptDmInvites()`: called on every live sync. Check it against `ensureDmBookkeeping` and that the first message then notifies.
- `renderTimeline` scroll anchor: keeps the top visible message in place across rebuilds, replacing "old top plus height difference". Check pagination (`maybeLoadOlderMessages`, which now also retries up to four empty pages) and that nothing fights the "stay at the bottom" paths.
- `notifyNewMessage`: no toast for events older than five minutes; your own message from another device marks the room read. The `receipt` handler does the same when `room.hasUserReadEvent` says you've read the last message.
- `mxcToBlobUrl`: anything that isn't a raster image type becomes `application/octet-stream`. Check avatars and banners still show (an SVG avatar now won't).
- `sendChatGif` and `shareNowPlaying` carry an open reply. `startDm` returns a boolean and guards double starts.
- `.chat-head h2` went from 24px to 30px unseen. Check the chat header's height and truncation.

Also unrun: the listening-party change, the away-on-lock change (needs a real lock), anything on a phone, and the Photos song-box change that holds your music before playing a clip.

## Known and left open

Reported by the reviews and not fixed. Each is a reasonable next thing.

- **Chat rebuilds the whole timeline on every event** (`renderTimeline`). An append-only fast path would fix it. Each GIF send re-uploads the file to Synapse; picker tiles and chat keep full-size GIFs.
- **Chat read receipts:** `readActiveChatRoom` and `renderTimeline` disagree on which event is last (one counts edits), and `_lastSentReadEventId` is set before the receipt succeeds.
- **Phone:** Chat's in-app back arrow pushes a history entry instead of going back (`setChatMobileView` wrapper in `js/17-history.js`).
- **klabnet-desktop:** the permission allow-list in `src/main.js` appears to lack `'screen-wake-lock'`, so the slideshow can't keep the screen awake in the app. Not run.
- **klabnet-api:** photo list queries apply `LIMIT` before dropping posts with no photos, so a page can come back short. The client tolerates it now; the queries should filter.
- **Home** fetches `/api/posts?limit=8` on its own while the feed already polls 50. "Away 7m" is inside the HTML that presence diffing compares, so away people cause rebuilds every minute. Feed and Home format relative times differently.
- **Music requests:** the list re-renders up to five times per visit while avatars resolve.
- **The image viewer** doesn't cancel the original's download when closed early.
- **The sound-effects `AudioContext`** never suspends. Left alone because resuming outside a gesture is uncertain on Safari and would cost notification sounds.
- **Accessibility:** several things you press aren't buttons (`.s-toggle` divs in Settings, the mute icons, `#playerArtWrap`, `.ap-sim-chip`), so they aren't keyboard reachable.
- **Dead code:** the presence-rail block and `.player-art` observer in `js/13-tail.js`, the fallback body of `loadArtistView` in `js/03-picker-tabs.js`, `setRailTab` in `js/11-presence.js`, and CSS for `.rail-tabs`, `.rail-channels`, `.chat-channels-toolbar`.
- **CSS:**
  - Fonts: rules ask for JetBrains Mono 500 and Inter 800 and 300, but only 700 and 400 to 700 are loaded, so they render at the nearest weight. Loading them changes how those elements look: the owner's call.
  - Buttons that are neither primary nor secondary: `.chat-head-btn`, `.chat-hello-chip`, `.feed-post-more`, `.fb-type-btn`, `.music-req-type-btn`, `.picker-sort-btn`, plus a few off-size ones.
  - 12px radii on `.header-right` and `.tab-nav` were left because they are concentric with the 8px buttons inside.
  - Small-caps labels that differ slightly from the standard (`.ph-spec .k`, `.ph-month`, `.mh-wheel-result .k`, `.fs-upnext-row .q`).
  - `.slider-fill` animates `width` on every `timeupdate`; `transform: scaleX()` would avoid layout.
  - Undefined custom properties that only ever use their fallback: `--fs-17`, `--font-mono`, `--ph-rail-w`.
  - `@media (max-width: 860px)` hides the dock's extra buttons on a narrow desktop window too.
  - The file is 484KB, 23% of it comments. It gzips to about 106KB; stripping comments at deploy would be the only large saving.

## Where a deep dive is most likely to pay

- Chat, with a real session: everything in "Not verified", and the SDK edges nobody could exercise (limited timelines, redactions of your own pending events, reconnect after sleep).
- A phone: `(max-width: 760px) and (pointer: coarse)` layouts, the bottom dock, history on Back, long-press menus.
- The real desktop apps: title-bar geometry under page zoom, materials, the tray (hidden-window behaviour, where timers and polls should stop), memory after long sessions.
- Long sessions in general: caches with no bound, observers that never disconnect, blob URLs never revoked. The reviews checked the obvious ones and found them bounded; a profile of the real app after a day would say more than reading.
- Cross-file wrapper chains. `playSong` is wrapped three times and `loadPickerTab` five; a change to the base function's arguments or return value is where regressions come from.
