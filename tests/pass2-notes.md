# Pass 2 JavaScript verification

Commits: 91da5a6 (audit harness), b7f82e7 (keyboard controls and stable away
updates). The slider handoff, stronger audit trace and these notes remain
uncommitted pending the all-eight-smokes requirement or an explicit exception.

All runs used the isolated rig at http://localhost:8793/. No real music was
played, starred, or modified. Version strings and CSS/HTML were left alone.

## Commands and results

- `node tests/regressions.mjs`: all six groups pass.
- `for f in js/*.js; do node --check "$f" || exit; done`: pass.
- `./check-version.sh`: pass, v2026.10.18.1 on all 32 asset URLs.
- `git diff --check`: pass.
- `~/tools/nodeb tests/browser.mjs --url=http://localhost:8793/ --output=/tmp/klab-final-full-clean`: pass.
- The same driver with `--smoke=true --variant=light|win|gnome|kde|linux|mac|side`
  (each variant run separately, output `/tmp/klab-final-<variant>`): all seven pass.
- `~/tools/nodeb tests/browser.mjs --url=http://localhost:8793/ --smoke=true --w=700 --h=900 --output=/tmp/klab-final-narrow`:
  **fails** on Home: `Dock button escaped: btnFS`.
- Repeat with `--baseline=true --output=/tmp/klab-baseline-narrow` before the
  JavaScript fix commit: same failure using original production JavaScript.
- `~/tools/nodeb tests/browser.mjs --url=http://localhost:8793/ --worker=true --output=/tmp/klab-worker`:
  passes version eviction, offline asset hit, and network-only document/API checks.
- `~/tools/nodeb tests/browser.mjs --url=http://localhost:8793/ --audit=true --output=/tmp/klab-audit-final-trace`:
  passes, including the regular fake Matrix regressions and feedback, profile,
  playlist, browse, create-channel and choice dialogs. JSON report in that directory.

The audit is intentionally opt-in. Weak references avoid retaining every event
target while counting listeners; once listeners and AbortSignal removals make
those counts approximate. Instrumentation itself adds overhead. The hidden test
simulates `document.hidden` and fires visibilitychange; it does not reproduce
Chrome's background throttling or Electron tray behavior.

## Runtime findings

Across three 20-switch loops, listeners stayed at 562, active interval handles
at 12, observed MutationObservers at 28, and blob URLs at 1. After GC, JS heap
was 3,759,520 / 3,862,064 / 3,868,096 bytes. These short runs show no accumulating
route leak, not proof against leaks over a day. Hidden-tab simulation stopped
three presence polling handles (12 to 9). Heartbeats intentionally continue.

No uncaught exceptions or unhandled rejections. Three distinct high-resolution
artwork proxy URLs under `/api/music-requests/artwork/files/` answered 502. The
SSO popup warning is expected with `window.open` suppressed. The fake failed-send
test logs its deliberate error; the offline worker checks log expected failures.
The report retains these instead of hiding them. Four long tasks occurred
across the run (maximum 106 ms, including instrumented startup). The marked
100-event timeupdate and mousemove loops showed no synchronous Layout entries;
the subsequent scroll loop flushed layout once. This is a synthetic diagnostic,
not a real-playback benchmark.

## Screenshots inspected

Before/after `keyboard-artist.png`, `keyboard-presence.png`, and
`away-presence.png` under `/tmp/klab-key-{before,after}-{dark,light,win}` were
viewed as comparison sheets; representative dark/Windows files were also viewed
at full size. Discography and presence geometry stays the same; away text still
reads `Away 8m`. Clock/spotlight content, resolved artwork and backdrop timing
vary between captures. Windows Acrylic is washed out with the fake bridge.
The audit screenshot overview (tabs and common dialogs) was also inspected.
The final clean `chat-fixture.png` was viewed after allowing the image viewer
closing transition to finish.
The narrow `home.png` shows the fullscreen control overflowing the dock.

## Needs the CSS side

1. Keep `#playerDock #btnFS` within the dock at 700x900 with a fine pointer.
   Relevant fixed minimums: `.player-info`, `.player-progress`, `.player-vol`,
   `.vol-slider`, `.player-controls`, and `.player-dock` gaps/padding. Keep the
   desktop layout and existing phone-only breakpoint rule.
2. Add `[role="link"]:focus-visible` to the shared focus-ring selectors near
   `[role="button"]:focus-visible` for the newly focusable presence links.
3. Slider transform opt-in requires coordinated CSS and a reload. JS reads
   `--slider-dot-transform: 1` from each `.slider-wrap` at construction and writes
   a unitless `--slider-pct` onto its `.slider-dot`. A candidate CSS implementation
   is below; this CSS has **not** been applied or verified on this branch:

   ```css
   .slider-wrap { container-type: inline-size; --slider-dot-transform: 1; }
   .slider-dot {
     left: 0;
     transform: translate(calc(var(--slider-pct, 0) * 100cqw - 50%), -50%);
   }
   ```

   Keep the flag absent until the container-relative transform is ready. The
   present CSS continues to receive the original percentage `left` values.

## Left alone / limits

SFX suspension remains uncertain on Safari and for background notifications.
The presence song-color Map can grow with distinct songs; this run did not
establish a practical memory problem or test an eviction policy. Composite Home
tiles still need a broader keyboard design (separate nested actions), beyond the
simple card controls fixed here. No real Matrix SSO/reconnect, real phone, GPU
materials, Electron tray/lock, listening-party integration or day-long profiling
was available. Some specialized media/upload dialogs were not opened by the
audit. The hot-path trace uses a synthetic duration/position on an unloaded player;
it does not play a real track.
