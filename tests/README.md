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
