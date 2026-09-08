# klabnet

The personal dashboard for the KLAB homelab — a single-page terminal-styled home screen serving as the front door to every self-hosted service, with an integrated music player, live presence, and admin-managed app tiles.

Live at [`user.klab.gg`](https://user.klab.gg) · staged at `staging.klab.gg` — both gated behind Authentik.

---

## What it does

- **App launcher grid** — tiles linking out to every service in the homelab (Immich, Nextcloud, Jellyfin, qBittorrent, Proxmox, Gitea, etc.), hardcoded in `index.html`, with live status dots and drag-to-reorder edit mode for admins.
- **Full music player** — talks directly to Navidrome over the Subsonic API: browse by album/artist/genre, search, queue, playlists, favorites, play history, synced lyrics, and a fullscreen "now playing" view with album-art-driven accent color extraction.
- **Presence** — an always-visible "// users" panel showing who else is online and what they're listening to, polling every 8 seconds.
- **Identity & preferences** — reads the logged-in user's identity and admin status from Authentik (via `X-Authentik-Username` / `X-Authentik-Groups` headers passed through Caddy), and persists per-user preferences server-side.
- **Personality touches** — a terminal-style typing intro, Minecraft-style rotating MOTD splash text, light/dark themes, and Frutiger Aero–inspired UI sound effects.

## Stack

- Single static `index.html` — vanilla JS, no build step, no framework.
- **Backend:** `klabnet-api` (FastAPI, separate service on `192.168.0.37:8765`) — handles `/api/me`, `/api/prefs`, `/api/presence`, etc.
- **Auth:** Authentik, enforced at the Caddy layer via `forward_auth` — the page itself trusts the identity headers Caddy injects after a successful auth check.
- **Music:** Navidrome (Subsonic API) at `music.klab.gg`.
- **Serving:** Caddy, `file_server` off a plain directory — no server-side rendering.

## Repository layout

```
index.html    — the entire application
klab.png      — favicon / branding
```

## Deployment

This repo uses a **push-to-deploy** git workflow instead of manual file transfer. Three environments, three remotes:

| Remote    | Target                                      | Purpose                                  |
|-----------|----------------------------------------------|-------------------------------------------|
| `origin`  | Gitea (`git.klab.gg`)                        | Primary archive / source of truth         |
| `github`  | GitHub                                       | Mirror / off-site backup                  |
| `staging` | `/home/klab/staging-web` → `staging.klab.gg` | Pre-flight testing with real Authentik + API |
| `prod`    | `/home/klab/web` → `user.klab.gg`            | Live site                                 |

`staging` and `prod` are bare repos on `klab-wv-core` with a `post-receive` hook that checks the pushed commit directly into the live-served directory:

```bash
git --work-tree=/home/klab/web --git-dir=/home/klab/repos/klabnet-web.git checkout -f main
```

Staging exists because opening the raw HTML locally breaks anything that depends on Authentik or the API — both require a real domain behind the real Caddy/Authentik chain. Staging is that chain, just pointed at a second directory and gated by its own Authentik provider.

### Day-to-day workflow

```bash
git add -A
git commit -m "..."
git push staging main    # test at staging.klab.gg
git push prod main       # ship it
git push origin main     # archive to Gitea
git push github main     # mirror to GitHub
```

In VS Code, these are wired up as tasks (`.vscode/tasks.json`) since the Source Control UI doesn't reliably prompt for the SSH key passphrase on `staging`/`prod`:

- **Push All** — pushes to all four remotes (default build task, `Ctrl+Shift+B`)
- **Deploy: Staging** / **Deploy: Prod** — single-target pushes

Run via `Ctrl+Shift+P` → **Tasks: Run Task**.

### Rollback

```bash
git revert <bad-commit-hash>
git push prod main
```

Or, for an immediate fix directly on the server:

```bash
cd /home/klab/web
git log --oneline
git checkout <hash> -- .
```

## Local development

There's no local dev server that fully replicates the site — the Authentik forward-auth and internal `/api/*` calls only work behind the real Caddy chain. Edit `index.html` directly and use `staging.klab.gg` as your test environment rather than a local preview.
