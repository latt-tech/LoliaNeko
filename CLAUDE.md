# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

LoliaNeko (「ロリア・猫」) is a third-party desktop client for Lolia FRP, built with **Electron 28** (Node.js main process + plain HTML/CSS/JS renderer using **MDUI v1** via unpkg CDN). It handles OAuth login, a dashboard for user/traffic/tunnel data, and managing a local `frpc` runner process (install/update/start/stop with live logs).

## Commands

```bash
npm install        # install deps (electron 28.3.3, adm-zip, tar, electron-builder)
npm start          # run the app (electron .)
npm run dist       # package with electron-builder → dist/ (win: nsis + portable x64)
```

There is **no test suite** and no lint step. Use `node --check <file>` to syntax-check main-process modules.

### Prerequisites

- Node.js 18+ (fetch API required). No Go, no Bun.

## Architecture

### Main ↔ renderer bridge (the core pattern)

The renderer never touches Node APIs directly. `src/preload.js` exposes a `window.neko` API tree (`app` / `token` / `center` / `frpc` / `window` / `shell`) via `contextBridge`, backed by `ipcRenderer.invoke` channels registered in `src/main/ipc.js`.

**IPC protocol:** every handler returns `{ ok: true, data }` or `{ ok: false, error }` (see `wrap()` in `ipc.js` — it must strip the first `event` argument). The preload unwraps and throws `Error(error.message)` on failure. New handlers must go through `wrap()` to stay compatible.

Main → renderer push uses `webContents.send`: `frpc_install_progress` (install progress events) and `window:changed` (maximize state, consumed by the custom title bar).

### Main process (`src/main/`)

- `index.js` — frameless `BrowserWindow` (950x600 default, 800x600 min), window size/maximised persistence, single-instance lock, `window:*` IPC (note: these handlers return `{ok,data}` manually, not via `wrap()`), stop runner on close. Also owns `shell:openLicense`, which opens `LICENSES.chromium.html` (repo root, must stay in `build.files`) in a separate child window.
- `config.js` — `ConfigManager`: `config.json` in `app.getPath('userData')` (theme/window/advanced).
- `version.js` — build info from env vars `LOLIA_GIT_COMMIT` / `LOLIA_GIT_BRANCH` / `LOLIA_BUILD_TIME`; User-Agent string.
- `httpclient.js` — generic fetch client that unwraps the Lolia API envelope (`{code, status, msg, data}`), injects the bearer token, calls `onUnauthorized` on 401/403, returns typed `APIError`.
- `api-center.js` — the 10 center API endpoints. Base URL overridable via `LOLIA_CENTER_API_BASE_URL` (default `https://api.lolia.link/api/v1`).
- `ipc.js` — registers all channels with `wrap()`.

### Services (`src/main/services/`)

- `token-store.js` — OAuth token persisted as JSON in `userData/token.json`, encrypted with Electron `safeStorage` (Windows DPAPI).
- `oauth.js` — Authorization Code + PKCE (S256). Local callback server listens on `0.0.0.0:11419` (redirect URI `http://localhost:11419`), 3-minute timeout, `shell.openExternal` for the authorize page. `loadOrRefreshOAuthToken` refreshes within 60s of expiry. Env overrides: `LOLIA_OAUTH_CLIENT_ID/AUTHORIZE_URL/TOKEN_URL/REDIRECT_URL`.
- `center-service.js` — dashboard/tunnels/runner data aggregation + the local frpc runner lifecycle (`startRunner`/`stopRunner`/`getRunnerRuntimeStatus`). Runner logs are ring-buffered (300 lines); the `-t id:token` argument is masked in the reported command. Stopping uses SIGINT → SIGTERM → kill.
- `frpc-service.js` — downloads/installs/updates/removes the `frpc` binary from GitHub releases (`Lolia-FRP/lolia-frp`, asset `LoliaFrp_{os}_{arch}.zip|tar.gz`), SHA256 verification, mirror support (official / builtin presets / custom base URL or URL template with `{owner}/{repo}/{tag}/{asset}` placeholders). State lives under `userData/frpc/` (`bin/`, `downloads/`, `installed.json`, `settings.json`).

### Renderer (`renderer/`)

Plain HTML/CSS/JS — no framework, no build step. MDUI v1.0.2 + Material Icons from unpkg CDN.

- `index.html` — custom draggable title bar (`-webkit-app-region: drag`), nav, five `<section>` pages.
- `js/app.js` — hash router with OAuth guard (`hasOAuthToken`), theme handling (`mdui-theme-layout-dark` toggle + injected `<style>` to override MDUI colors for 7 accent presets, persisted in `localStorage` keys `lolia.theme` / `lolia.accent`), hand-written SVG traffic chart, per-page mount functions returning `{cleanup}`.
- MDUI grid breakpoints: `sm` = ≥600px, `md` = ≥1024px. The window default is 950px wide, so use `mdui-col-sm-*` for multi-column layouts.

## Conventions

- Code comments and user-facing strings are in **Chinese**; match the surrounding style.
- API model JSON fields are **snake_case** (`goos`, `binary_path`, `node_id`, …) — keep them consistent between main process and renderer.
- Version is centralized in `package.json` (read via `app.getVersion()`).
- CI builds run `npm ci` + `npx electron-builder` per platform/arch matrix in `.github/workflows/release.yml`.
