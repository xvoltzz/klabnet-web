# Regression checks

Run the delayed-network tests without a server:

```sh
node tests/regressions.mjs
```

The browser tests need Node 22+, Chrome, and the isolated local API described
in `AGENTS.md`, serving this repo at `http://localhost:8791/` as `tester`.
Seed a few posts and photos; Music reads the real Navidrome library. Use a
separate temporary API database and media directory. The suite uses fake
Matrix clients and delayed responses, without logging in or sending chat.
It reads Music without playing songs or modifying its library.

```sh
node tests/browser.mjs
node tests/browser.mjs --smoke=true --variant=light
node tests/browser.mjs --smoke=true --variant=win
node tests/browser.mjs --smoke=true --variant=gnome
node tests/browser.mjs --smoke=true --variant=kde
node tests/browser.mjs --smoke=true --variant=mac
node tests/browser.mjs --smoke=true --variant=side
node tests/browser.mjs --smoke=true --w=700 --h=900
```

On this WSL machine use Windows Node for the browser driver:

```sh
/mnt/c/Users/xvoltzz/AppData/Local/hermes/node/node.exe "$(wslpath -w tests/browser.mjs)"
```

`CHROME_PATH` can override the Chrome executable. The driver creates a fresh
Chrome profile and random debugging port, prints its screenshot directory,
and terminates only the Chrome process tree it started. `--output=<path>`
chooses a screenshot directory. The tests fail on an assertion or an uncaught
page exception; external font/image network failures are not script errors.

These checks cover controlled client races and emulated layouts. A real
Matrix session, physical phone, GPU effects, native desktop material, and
multi-device listening parties still need separate testing.

## Playlists

`tests/playlists.mjs` makes a playlist and takes it through everything:
its cover (drawn, and a picture through the cropper), description and
color, adding, dragging and removing songs, featuring, a second person
saving it and adding to it, Back and Forward, playlists brought over from
prefs, and an API from before playlists. It needs the rig above with the
two-user wrapper from "Voice" below (it acts as other people through the
`x-dev-user` header), and `media/.klabnet-media` for covers. It reads the
real Navidrome library and plays nothing, and it deletes the playlists of
the users it runs as (`tester`, `alice`).

```sh
node tests/playlists.mjs
```

Not covered: a phone (songs can't be reordered by touch yet), and real
people changing the same playlist at once.

## One player on every device

`tests/session.mjs` opens klabnet several times as one person (a window
each) and checks they act as one player: the second follows the first's
song and position, its buttons (play, seek, next, the queue, volume,
shuffle, repeat) work the first, "Play here" moves the sound and where it
had got to, a third arrives as a remote and its login song stays quiet,
the active one closing leaves the rest paused where it was, their presence
card shows the device that's playing, and an API without sessions leaves
everything as it was. It needs the rig above with the two-user wrapper
from "Voice" below.

The songs are made up. Requests for their audio never reach Navidrome:
the test answers them with a quiet WAV, and counts scrobbles instead of
sending them.

```sh
node tests/session.mjs
```

Not covered: real devices on different networks, a phone, the desktop
apps, and listening parties (they need Matrix).

## Voice

`tests/voice.mjs` puts two people in a voice channel: two tabs of one
headless Chrome, each with a fake microphone, talking through a real
LiveKit. It checks that they hear each other, mute, deafen, per-person
volume, push to talk, switching channels, a channel deleted under someone,
and a second device taking over. On top of the rig above it needs:

- **LiveKit**, one binary from its GitHub releases, in dev mode (key
  `devkey`, secret `secret`). `--node-ip` is the address Chrome reaches it
  at: WSL's own (`hostname -I`) when Chrome runs on Windows.

  ```sh
  livekit-server --dev --bind 0.0.0.0 --node-ip 172.17.116.14
  ```
- **The API started with** `LIVEKIT_URL=ws://localhost:7880
  LIVEKIT_API_KEY=devkey LIVEKIT_API_SECRET=secret`.
- **Two users.** A page can't send the wrapper's `x-dev-user` header, so
  the wrapper also has to take the name from the address the tab was
  opened at (`/?u=alice`), which arrives as the Referer:

  ```python
  user = next((v.decode() for k, v in scope["headers"] if k == b"x-dev-user"), None)
  if user is None:
      ref = next((v.decode() for k, v in scope["headers"] if k == b"referer"), "")
      m = re.search(r"[?&]u=([a-z0-9_]+)", ref)
      user = m.group(1) if m else "tester"
  ```

```sh
node tests/voice.mjs
node tests/voice.mjs --variant=mac
```

Not covered: real microphones and speakers, echo, latency, a network that
blocks UDP, and anything on a phone.
