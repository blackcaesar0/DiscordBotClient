# Architecture

This document explains how DiscordBotClient is put together so you can navigate
and contribute to the codebase. For the security model specifically, see
[`SECURITY.md`](../SECURITY.md).

## The core idea

DiscordBotClient does **not** reimplement the Discord UI. It ships a **snapshot
of the real Discord web client** and transparently reroutes its network traffic
through a **local proxy** that:

- swaps a **bot** token in where the web client expects a user token, and
- **fakes** the handful of user-only API responses the web client needs to
  render a bot account as if it were a user.

```
            ┌─────────────────────────── Electron main process ───────────────────────────┐
            │                                                                              │
 Discord    │   host-rules: discord.com ──► 127.0.0.1:<port>                               │
 web client │                                                                              │
 (snapshot) │   ┌───────────────────────┐    proxy (net.request)   ┌────────────────────┐ │
   renderer ─┼──►│  Local HTTPS proxy     ├────────────────────────►│ canary.discord.com │ │
   window   │   │  (APIServer.ts)        │   Authorization: Bot …   └────────────────────┘ │
            │   │  - rewrites auth header│                                                  │
            │   │  - fakes user routes   │                                                  │
            │   └───────────────────────┘                                                  │
            └──────────────────────────────────────────────────────────────────────────────┘
```

## Process / module map

### Main process — `src/AppCore/`

| File | Responsibility |
|------|----------------|
| `index.ts` | Electron entry point (`DiscordBotClient` class). Creates the session, the `BrowserWindow`, the tray, the auto-updater, window-open handling, and starts the servers. |
| `APIServer.ts` | The local HTTPS proxy the web client talks to. Strips/normalizes headers, rewrites `Authorization` to `Bot <token>`, serves the bundled Discord HTML, and routes everything else through `Util.proxy`. |
| `MessageEditorServer.ts` | A small local HTTP server that serves the beta message-editor UI. |
| `Config.ts` | INI-backed app configuration (`config.ini` in `userData`), validation, and Monaco autocomplete metadata. |
| `Constants.ts` | App-wide constants: paths, the mapped Discord domain, blacklisted routes, Chromium feature flags. |
| `IPCManager.ts` | Registers all `ipcMain` handlers (bot info lookup, experiments, window controls, config editor). |
| `IPCEvents.ts` | The enum of IPC channel names shared between main and preload. |
| `*Preload.ts` | `contextBridge` preload scripts exposing a minimal, typed API to each renderer. |
| `routes/` | Per-endpoint overrides. The directory tree mirrors Discord API paths (`#id` = a path param). Anything not overridden falls through to the real API. |

### Utilities — `src/AppUtils/`

| File | Responsibility |
|------|----------------|
| `Utils.ts` | The proxy implementation (`Util.proxy`), self-signed cert generation, profile patching, request body parsing. Token/version helpers here delegate to the pure modules below. |
| `RequestGuards.ts` | Pure (Electron-free, unit-tested) request helpers: path normalization, route blacklisting, upstream URL validation, log redaction, content-type sniffing. |
| `RequestLogger.ts` | The `morgan` middleware shared by both local servers (opt-in via `verbose_logging`, with URL redaction). |
| `TokenUtils.ts` | Pure token helpers: `Bot`/`Bearer` prefix stripping and token→ID decoding. |
| `Version.ts` | Pure version comparison (`v` prefix, prereleases and build metadata tolerated; never throws). |
| `RegisterRoutes.ts` | Walks the `routes/` tree and registers each file as an Express handler. |
| `Experiments.ts` | Builds the user/guild/apex experiment payloads from bundled snapshots. |
| `DiscordBitField/` | Typed bitfield helpers (intents, user flags, application flags). |
| `UserBadges.ts`, `UserPatch.ts`, `NitroData.ts`, `SystemMessages.ts` | Static data used to patch/fake responses. |

### Build scripts — `scripts/`

| Script | Purpose |
|--------|---------|
| `vencordClone.ts` / `vencordBuild.ts` | Clone and build the bundled Vencord extension. |
| `discohookClone.ts` / `discohookBuild.ts` | Clone and build the message-editor (Discohook-based) UI. |
| `update.ts` | Generate a fresh snapshot of the latest Discord web build. |
| `updateGuildExperiments.ts` | Refresh the bundled experiment data. |

## Request lifecycle

1. The renderer loads `https://discord.com` → Chromium `host-rules` sends it to
   the local HTTPS proxy at `127.0.0.1:<port>`.
2. `APIServer.ts`'s header middleware strips sensitive/irrelevant headers and,
   if an `Authorization` header is present, normalizes it to `Bot <token>` and
   sets the bot User-Agent.
3. Routing:
   - `routes/**` provides local overrides/fakes for specific endpoints.
   - Blacklisted endpoints (`Constants.BlacklistRoutes`) return `403`. The match
     runs on the **normalized** path (`RequestGuards.isBlacklistedRoute`), so an
     encoded (`%40me`), traversed (`..`) or differently-cased target cannot slip
     past a check that the upstream API would still route to the blocked endpoint.
   - `/`, `/app`, `/login`, `/channels/*` serve the bundled Discord HTML.
   - Everything else is forwarded to `canary.discord.com` by `Util.proxy`.
4. `Util.proxy` resolves the target with `RequestGuards.buildUpstreamUrl` (a
   target that would resolve to any other origin is rejected with `400`), then
   uses Electron's `net.request` (session-aware), copies safe headers, forces the
   correct `Origin`/`Referer`, and streams the response back to the web client.
5. Anything thrown while handling a request lands in the Express error handler,
   which answers with a Discord-shaped JSON body instead of an HTML stack trace.

## Local development

Requires **Node.js v24+** and **git**.

```sh
npm run requirement   # install deps + clone Vencord & Discohook sources
npm run vencord       # build the bundled Vencord extension
npm run build:ts      # compile TypeScript (tsc + tsc-alias) into build/
npm start             # launch Electron against build/
```

Handy scripts:

- `npm run lint` / `npm run lint:fix` — ESLint
- `npm run format` — Prettier
- `npm run test:typescript` — type-check only (sources + tests)
- `npm run test:unit` — unit tests for the pure helpers in `test/` (`node --test` via `tsx`)
- `npm run core:update` — regenerate the Discord web snapshot
- `npm run build` — full production build (`electron-builder`)

DevTools open automatically when the app is **not** packaged.

## Configuration

User configuration lives in `config.ini` under Electron's `userData` directory
and is editable from the tray menu → **Settings (Config Editor)**. Keys are
documented inline (with Monaco autocomplete) in `Config.ts`. An invalid file no
longer prevents startup: the app logs the problem, falls back to the defaults and
leaves the file untouched so it can be fixed from the editor.

| Key | Type | Default | Meaning |
|-----|------|---------|---------|
| `cache_assets` | boolean | `false` | Cache `discord.com/assets` to disk (faster on slow networks; not auto-cleaned). |
| `guilds_per_shard` | number | `100` | Used to compute the number of shards. Must be a whole number in `1..2500` (Discord's per-shard ceiling). |
| `suppress_intent_warning` | boolean | `false` | Skip the MESSAGE_CONTENT intent warning at login. |
| `generate_fake_profile` | boolean | `true` | Inject cosmetic fake profile/Nitro data. |
| `verbose_logging` | boolean | `false` | Log every request handled by the local servers (URLs are redacted; takes effect without a restart). |

## Tests

`test/` holds `node:test` suites executed with `npm run test:unit` (and run in CI
by `.github/workflows/lint.yml`):

- `RequestGuards.test.ts` — path normalization, deny-list matching (including
  encoding/traversal bypasses), upstream-origin validation, log redaction and
  JSON content-type detection.
- `TokenUtils.test.ts` — prefix stripping (a token whose payload contains `Bot`
  must survive it) and token→ID decoding.
- `Version.test.ts` — release/prerelease ordering and malformed input.

Keep security-relevant and otherwise fiddly logic in Electron-free modules like
these — it is what makes them testable without booting Electron.
