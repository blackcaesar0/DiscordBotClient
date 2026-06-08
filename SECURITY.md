# Security Policy & Model

This document explains **how DiscordBotClient handles your bot token**, what the
realistic risks are, and how the app is hardened. Read it before using the app
with a production bot.

> [!WARNING]
> **Using a bot token in a Discord-like client is against the Discord Terms of
> Service.** This is the single biggest risk and it cannot be solved in code:
> Discord may flag or disable your bot/application. Use a throwaway/test bot if
> you are not comfortable with that risk.

---

## TL;DR — "Is it safe for me to use?"

- **Your token is not sent to any third party.** It only ever travels to
  Discord's own API (`canary.discord.com`) and is stored locally by the bundled
  Discord web client (same place normal Discord web stores its token). The token
  is **not** written to the app logs.
- **The biggest practical risk is account/ToS-related**, not data theft (see the
  warning above).
- On a **trusted machine and network**, day-to-day risk is low.
- On a **shared or hostile network**, be aware of the residual risks listed
  below.

If you don't trust the prebuilt binaries, **build from source** — the entire
data flow is in this repository and described below.

---

## How it works (threat-model overview)

DiscordBotClient runs the **real Discord web client** (a bundled snapshot) and
makes it talk to a **local proxy** instead of Discord directly:

1. A local **HTTPS server** is started on a random port with a self-signed
   certificate (`src/AppCore/APIServer.ts`).
2. Chromium's `host-rules` switch maps `discord.com` → `127.0.0.1:<port>`
   (`src/AppCore/index.ts`), so the web client unknowingly talks to the proxy.
3. The proxy forwards API calls to `https://canary.discord.com`, rewriting your
   `Authorization` header to `Bot <token>` (`src/AppUtils/Utils.ts`).
4. A number of user-only API responses are **faked locally** so a bot account
   renders like a user (profile, Nitro, experiments).

### Where your token lives

| Location | Notes |
|----------|-------|
| Browser storage in the `persist:elysia_dbc` Electron session | Same model as logging into Discord web. Lives under the app's `userData` directory. |
| The `Authorization` header of each request to the **local** proxy | Forwarded to Discord; never persisted by the proxy. |
| **Not** in application logs | Request logging (morgan) records method/URL/status only, not headers. |

You can wipe all of this from the tray menu → **"Delete all application data and
relaunch"**.

---

## Hardening implemented

| Risk | Mitigation |
|------|-----------|
| TLS validation disabled app-wide | The app **no longer** uses the global `ignore-certificate-errors` switch. TLS bypass is scoped with `session.setCertificateVerifyProc()` so **only** the locally-mapped `discord.com` self-signed proxy is trusted; every other host (CDN, GitHub updates, themes) keeps normal certificate validation. |
| Proxy reachable from the LAN | Both local servers now bind to `127.0.0.1` only (previously `0.0.0.0`), so they are not reachable from other devices on the network. |
| Token in logs | Header values are never logged. |

---

## Residual risks (know these)

These are inherent trade-offs of running a third-party client and are **not**
currently mitigated:

1. **Discord ToS** — bots driven through a user client can be flagged/disabled.
2. **`webSecurity: false`** — same-origin policy and CORS are disabled in the
   renderer windows. This is required for the proxy approach to work, but it
   means any cross-site scripting (e.g. via a malicious Vencord theme/plugin or
   injected content) is more dangerous than in a hardened browser. **Only
   install Vencord themes/plugins you trust.**
3. **No Content-Security-Policy** on the bundled client.
4. **Self-signed certificate** for the local proxy (expected; trusted in a
   scoped way as described above).
5. **Unsigned binaries** on Windows/macOS — see the README section on
   anti-virus false positives. Prefer building from source if in doubt.

---

## Recommendations for users

- Use a **dedicated test bot** rather than a production bot where possible.
- Only run the app on a machine **you control**.
- Be **selective with Vencord plugins/themes** — they run with elevated
  privileges due to `webSecurity: false`.
- Keep the app **updated** (auto-update on Windows/Linux; manual on macOS).
- If you ever suspect token compromise, **reset the bot token** in the
  [Discord Developer Portal](https://discord.com/developers/applications)
  immediately.

---

## Reporting a vulnerability

If you find a security issue, please **do not** open a public issue with
exploit details. Instead, open a minimal private report via the repository's
GitHub security advisories (or contact the maintainer listed in `package.json`)
and allow reasonable time for a fix before public disclosure.
