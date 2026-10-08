# klabnet-web: notes for Claude

klabnet is the klab.gg homelab's own app: chat (Matrix), feed, music (Navidrome), photos and home, as one site at `user.klab.gg`. It's also the inside of **klabnet-desktop** (the Electron app for Windows, Linux and, in progress, macOS; see that repo's CLAUDE.md for the Mac work). The server side is **klabnet-api** (FastAPI + SQLite). README.md covers architecture and deployment.

## How the code is put together
- No build step. `index.html` loads `css/app.css` and `js/NN-*.js` as classic `<script defer>` files that share globals. Top-level `const`/`let` are global bindings but **not** `window` properties (e.g. `ND_URL`, `KLABNET_VERSION`). Later files wrap earlier functions by reassigning them (`openFS`, `updateQueueBadge`, `syncShuffleBtns`).
- **Every change to CSS/JS needs a version bump**: `KLABNET_VERSION` and every `?v=` in index.html (`sed -i 's/v2026\.MM\.DD\.N/v2026.MM.DD.N+1/g' index.html`), then `./check-version.sh`. The service worker serves `?v=` files cache-first, so a stale version means stale code. This applies to testing too.
- Icons are a subset font. Using a new `ti-*` icon means rebuilding it with `scripts/build-icons.py` (needs fonttools + brotli; check the result is LF, not CRLF).
- Syntax-check JS with `node --check js/<file>.js`.

## Deploying
- Four remotes: `origin` (Gitea), `github`, `staging` (→ staging.klab.gg) and `prod` (→ user.klab.gg). The last two are bare repos on 192.168.0.6 with a post-receive checkout.
- **Push only when the owner says so.** "push" means all four. "push to staging" means staging only. Verify afterwards, e.g. `ssh klab@192.168.0.6 'grep -o "v2026[.0-9]*" /home/klab/web/index.html | head -1'`.
- Commit as `xvoltzz <40217474+xvoltzz@users.noreply.github.com>`.
- **klabnet-api** is deployed by the owner (`git pull origin main && git push prod main` on the API host). Commit and push API changes to its Gitea/GitHub remotes, then tell them to deploy.
- Ask before touching the live Caddy config.

## Design rules (the owner cares a lot about consistency)
- **Music is the reference.** It uses:
  - a sidebar with 38px rows, section labels (10px semibold tracked caps, dim), and a big 30px bold view title with a dim count beside it
  - panels with a hairline border, radius 10px and a glass fill
  - two kinds of button: primary (filled with the text colour) and secondary (glass with a hairline)

  Photos, the full-screen player and the chat search were all redesigned to match it. Anything new should look like it belongs in Music.
- Sentence case for everything you press or read; caps only for section labels.
- Boxy (radius 6 to 10px), blur/glass, a soft "bloom" glow on lit things.
- Pointer cursor on buttons. No text selection except in inputs (it's an app, not a document).
- No phone UI on a desktop: the phone layout is only for `(max-width: 760px) and (pointer: coarse)`, and narrow desktop windows keep the desktop layout.
- In the desktop app, each platform looks native: Windows (WinUI title bar, Acrylic, NavigationView sidebar), GNOME (libadwaita header bar), KDE (Breeze), and macOS ("KLABNET FOR MAC" at the end of css/app.css). These are keyed off `html.klabnet-app` and `data-platform`/`data-desktop`.
- Scrollbars are hidden everywhere.

## Voice (built 2026-10-06; not yet run against the real homelab)
Drop-in voice channels, like Mumble's or Discord's, on a self-hosted **LiveKit** server (WebRTC). The owner wanted "self-hosted, low-latency voice" and first thought of Mumble; a browser can't speak Mumble's protocol, LiveKit's client is the same JavaScript in a browser and in the apps.
- **Where things are:**
  - `js/22-voice.js`: all of it. The headset button in the header (`#voiceBtn`) opens `#voicePanel` (channels, the people in each, mute / deafen / leave); `#voiceMicBtn` is a mute button that shows only while you're in a channel. Settings → Voice has the devices, open mic or push to talk, and the processing switches.
  - `js/vendor/livekit-client.umd.js` (600KB) is fetched the first time someone joins, not at load. Its `?v=` is the library's version, not `KLABNET_VERSION`.
  - **klabnet-api** `app/routers/voice.py`: channel names (SQLite), who's in each (asked of LiveKit, cached 2s) and the join token. LiveKit itself is the `livekit` service in klabnet-api's `compose.yml`. Its README's "Voice" section is the setup (DNS, Caddy, router ports, `.env`).
- **It hides itself** until `GET /api/voice` says `enabled: true`, so the site is the same as before wherever LiveKit isn't set up. Caddy only forwards a fixed list of `/api` prefixes: `/api/voice*` has to be on it.
- **Identity is the klabnet username**, one per person: joining on a second device takes over from the first ("Voice moved to your other device").
- **Muted and deafened are participant attributes** (`mute`, `deaf`), not the track's mute bit, because a push-to-talk microphone is muted between words without its owner being muted. The API reads the same attributes for people outside the channel.
- **Going quiet cuts the microphone at the source first** (`mediaStreamTrack.enabled = false` in `applyMic`), then tells LiveKit. Keep it that way: a mute that fails must never leave a microphone open.
- Per-device settings are in `localStorage` under `klabnet_voice` (not synced prefs: device ids mean nothing on another machine).
- `window.klabVoice` (`join`, `leave`, `toggleMute`, `toggleDeafen`, `state()`) is there for the desktop apps and for tests.
- **Testing it locally:** LiveKit is one binary (`livekit-server --dev --node-ip <WSL address>`, key `devkey` / secret `secret`); run the API from AGENTS.md's rig with `LIVEKIT_URL=ws://localhost:7880 LIVEKIT_API_KEY=devkey LIVEKIT_API_SECRET=secret`. Headless Chrome with `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream --autoplay-policy=no-user-gesture-required` gives each tab a microphone; `--use-file-for-fake-audio-capture=<wav>` with something speech-like is needed for the speaking rings (the default beep is too short for LiveKit to call it speech). Two tabs as two users covered joining, hearing each other, mute, deafen, volume, push to talk, switching, a deleted channel and the second-device takeover.
- **Not done yet:**
  - Phones: the buttons are hidden under the phone media query. It needs its own layout.
  - The desktop apps: a global mute / push-to-talk key (a page only sees keys while it's focused), tray and Dock items. See klabnet-desktop's CLAUDE.md.
  - Nothing shows who's in voice outside the panel (presence cards, Home).

## Playlists (built 2026-10-08; not yet run against the real homelab)
A playlist has a name, a description, a cover, a color and its songs, and lives on **klabnet-api** so other people can see it. They used to be a name and some songs in each person's prefs.
- **Where things are:**
  - `js/09b-playlists.js`: all of it (the store, the sidebar rows, the page, the editor, Add to playlist, the right-click menu, Browse → Playlists, Home's card).
  - **klabnet-api** `app/routers/playlists.py`, under `/api/music-requests/playlists` so it rides a prefix Caddy already forwards. Covers are files on the media share (`playlists/<id[:2]>/<id>-l.jpg` 1000px, `-s.jpg` 300px); a new upload is a new id, so they're served as immutable.
- **Private, featured, open.** A playlist is private until its owner features it. A featured one is on Home's "Featured playlists" shelf and in Browse → Playlists for everyone; anyone can play it or save it to their sidebar. "Let others add songs" (`collab`) only works on a featured one: others add, and can take back what they added; only the owner (or an admin) reorders, removes, edits or deletes. Unfeaturing takes it out of the sidebars of people who saved it.
- **The list holds summaries, not songs** (`_pls`: count, length, the first four album covers). A playlist's songs are fetched when it's opened or played (`plGet`). The list is cached in `localStorage` under `klabnet_pl_cache` so the sidebar is there at once, and refreshed when Music opens.
- **Its page is the album page's panel.** `window.klabApPage.open()` in `js/13-tail.js` lets another file put a page in `#apPanel` with the same Back, stack and blurred backdrop; `openPlaylistPage(id, name)` uses it, and `js/17-history.js` wraps it like `openAlbumPage`. While it's open its sidebar row is the lit one (`setNavRow`), and the section underneath gets the highlight back after.
- **Covers:** an uploaded picture goes through the square cropper (`openImageCropper`, `shape: 'square'`); "Make one" draws an emoji or a few letters on the playlist's color (`plDrawCover`) and uploads that as a picture. With no cover it shows the first four album covers as a 2x2 (`plArt`).
- **Two things to keep working:**
  - *The old list.* `klabnet_playlists` (still a synced pref) is handed to `POST …/import` the first time this runs against an API with playlists, then emptied. The API remembers every old id it has taken (`playlist_imports`), so a second device holding the same list doesn't make copies and a deleted one doesn't come back.
  - *An API without playlists* (the site is deployed separately from the API): the list answers 404 or 405, `_plServer` is `false`, and everything works on the prefs list as before, with just a name. Every store function (`plCreate`, `plAddSongs`, …) has that branch.
- `tests/playlists.mjs` runs all of it against the local rig (two users through the `x-dev-user` header). It doesn't play anything.
- **Not done yet:**
  - Reordering on a phone: it's drag and drop, which touch screens don't do.
  - Sharing a playlist to the feed or chat, and showing someone's playlists on their profile.
  - An open playlist doesn't update live while you look at it; it's refetched when the list next refreshes.

## Testing without the real site
The real site needs Authentik, so local testing uses a mock server. It serves this repo, fakes `/api/*` (photos, presence, posts, artwork) and loads index.html with a fake `window.klabnetDesktop` to preview the app layouts. Pages are screenshotted in headless Chrome (`--screenshot`, `--virtual-time-budget`) inside an iframe harness that can call into the page. Headless Chrome has no GPU, so `data-fx="low"` (reduced effects) is on there: no blur and no backdrops. Performance was measured in real Chrome windows and in the real Electron app, not headless.

## Things built recently (Sep 2026) that are easy to trip over
- **High-res album art** (display only; Navidrome's own art is never changed):
  - `klabHiResArt()` in `js/09-music-extras.js` calls the API's `/api/music-requests/artwork` (iTunes → Deezer → Cover Art Archive, strict matching).
  - The API keeps the images on the media share and serves them from `/api/music-requests/artwork/files/<id>-l|-f`.
  - It's used by Cover Flow (`hires` option of `makeCoverFlow` in `js/15-music-home.js`), the full-screen player and the cover viewer.
  - Browsers remember lookups in `localStorage` under `klabnet_hires_art2`.
- **Cover Flow performance:** `-webkit-box-reflect: none` is *invalid* in Chrome (use `initial`). The reflections are real `.mh-refl` images now, because box-reflect redrew every frame and was ~15x slower at 4K.
- **Photos:**
  - On desktop, `js/14-photos.js` moves its controls into the sidebar (`placeChrome()`). On touch screens ≤900px it puts them back beside the photo.
  - The photo count comes from the API's `total` on the first page.
  - The slideshow (`js/19-slideshow.js`, the S key or the Slideshow row) works through `window.klabPhotos`, which 14-photos.js exposes (items, urls, paging, the photo's song). It holds only two photos at a time, loads older pages in the background, and keeps the screen awake with a Wake Lock.
- **Memory:** klabnet sat near 1GB in the desktop app. The details, measurements and the desktop-side fix are in klabnet-desktop's CLAUDE.md ("Memory (RAM) and GPU"). The rules this repo follows because of it:
  - Blurred backdrops never need big art: `klabSoften` (js/00-util.js) bakes them to 96px and downsizes any `getCoverArt` source to 300px before it's fetched. Don't give a blurred background a screen-sized image.
  - Decoded pictures are the memory. Chromium keeps every one it has drawn until the OS says memory is short. When a screen lets go of many big pictures, call `window.klabnetDesktop?.trimMemory?.()`, as Photos does when you leave it and the image viewer does when it closes.
  - Photos keeps at most 6 preloaded photos (`preloaded` in js/14-photos.js) and clears them on leaving the tab.
  - Animations that never stop make the window redraw every frame (steady GPU at 4K behind Acrylic), so avoid adding new ones. Home's spotlight progress bar was stepped once a second to save that, but the owner found it ugly: it's a smooth CSS animation again, on purpose.
- **Away** (js/11-presence.js + klabnet-api routers/presence.py): each presence beat sends `activeAgo` (seconds since this device was used), `idleKnown` (it sees the whole computer: the apps' `klabnetDesktop.idle()`, or Chrome's IdleDetector once allowed in Settings -> Away status) and `lockedFor`. The API marks someone away after 5 minutes with nothing used on any device, or on a locked screen. Other browsers only see klabnet's own input, so they never make anyone away.
- **Prefs** save with `PATCH /api/prefs` (just the changed fields, merged on the server, one request, so it survives a closing tab), falling back to GET+PUT on an API without PATCH.
- **Favourites** are slimmed song records (`slimSong` in js/05-favorites.js), up to 2000; adding past that says so rather than dropping the oldest.
