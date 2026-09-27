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
