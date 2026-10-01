/* Copyright Elysia © 2025. All rights reserved */

/**
 * Pure request helpers shared by the local servers.
 *
 * This module intentionally has **no** Electron/Express imports: the security-relevant
 * decisions of the proxy (what counts as a blacklisted route, which upstream URL a request
 * is allowed to reach, what may be written to the log file) live here so they can be unit
 * tested with `npm run test:unit`.
 */

/** The only origin proxied API traffic is ever allowed to reach. */
export const UpstreamOrigin = "https://canary.discord.com";

/**
 * How many percent-decoding passes `normalizeRequestPath` performs.
 * Enough to collapse double/triple encoding (`%2540` -> `%40` -> `@`) without looping forever.
 */
const MaxDecodePasses = 3;

/** Query parameter names whose value is secret and must never reach the log file. */
const SensitiveQueryKeys = [
    "access_token",
    "api_key",
    "captcha_key",
    "captcha_rqtoken",
    "client_secret",
    "code",
    "key",
    "password",
    "refresh_token",
    "secret",
    "ticket",
    "token",
];

/**
 * Path segments after which `<id>/<secret>` follows in the Discord API
 * (`/webhooks/:id/:token`, `/interactions/:id/:token/callback`).
 */
const SecretAfterSegments = ["webhooks", "interactions"];

const RedactedValue = "[redacted]";

function decodeOnce (value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

function splitTarget (originalUrl: string): { path: string; suffix: string } {
    const index = originalUrl.search(/[?#]/);
    if (index === -1) return { path: originalUrl, suffix: "" };
    return { path: originalUrl.slice(0, index), suffix: originalUrl.slice(index) };
}

/**
 * Normalize a request target into the path an upstream HTTP server would actually route on.
 *
 * Without this, a deny-list that matches on the raw URL is trivially bypassed: `%40me` instead
 * of `@me`, a `..` segment, duplicate slashes or different casing all produce a raw URL that
 * does not contain the blacklisted substring, while Discord (and any normalizing proxy in
 * front of it) still resolves the request to the blocked endpoint.
 *
 * @param originalUrl Raw request target, e.g. `req.originalUrl`.
 * @returns Lower-cased, percent-decoded, dot-segment-resolved path without query/fragment.
 */
export function normalizeRequestPath (originalUrl: string): string {
    let { path } = splitTarget(originalUrl ?? "");
    for (let pass = 0; pass < MaxDecodePasses; pass++) {
        const decoded = decodeOnce(path);
        if (decoded === path) break;
        path = decoded;
    }
    // Chromium and most servers treat a backslash as a path separator; collapse both.
    path = path.replace(/\\/g, "/").replace(/\/{2,}/g, "/");
    const segments: string[] = [];
    for (const segment of path.split("/")) {
        if (segment === ".") continue;
        if (segment === "..") {
            segments.pop();
            continue;
        }
        segments.push(segment);
    }
    let normalized = segments.join("/");
    if (!normalized.startsWith("/")) normalized = `/${normalized}`;
    return normalized.toLowerCase();
}

/**
 * Whether a request target hits one of `Constants.BlacklistRoutes` after normalization.
 *
 * @param originalUrl Raw request target, e.g. `req.originalUrl`.
 * @param patterns Substrings of blocked paths.
 */
export function isBlacklistedRoute (originalUrl: string, patterns: readonly string[]): boolean {
    const path = normalizeRequestPath(originalUrl);
    return patterns.some(pattern => path.includes(normalizeRequestPath(pattern)));
}

/**
 * Build (and validate) the upstream URL a proxied request is forwarded to.
 *
 * Concatenating the request target onto the upstream origin is unsafe: the WHATWG URL parser
 * treats `\` like `/`, so a target such as `/\evil.com/x` resolves to a *different* origin,
 * and the proxy would happily forward the rewritten `Authorization: Bot <token>` header there.
 * Only origin-form targets that still resolve to `upstreamOrigin` are accepted.
 *
 * @param originalUrl Raw request target, e.g. `req.originalUrl`.
 * @param upstreamOrigin Origin the request must resolve to.
 * @returns The URL to request, or `null` when the target must be rejected.
 */
export function buildUpstreamUrl (originalUrl: string, upstreamOrigin: string = UpstreamOrigin): URL | null {
    if (!originalUrl || !originalUrl.startsWith("/")) return null;
    let base: URL;
    try {
        base = new URL(upstreamOrigin);
    } catch {
        return null;
    }
    // Collapse the leading run of separators so `//evil.com/x` cannot be parsed as an authority.
    const target = `/${originalUrl.replace(/^[/\\]+/, "")}`;
    let url: URL;
    try {
        url = new URL(target, base);
    } catch {
        return null;
    }
    if (url.origin !== base.origin) return null;
    return url;
}

/**
 * Mask the secrets a Discord API URL can carry, for request logging.
 *
 * Request logs are written to disk by electron-log, and some API URLs embed credentials in the
 * path (`/webhooks/:id/:token`, `/interactions/:id/:token/callback`) or the query string.
 *
 * @param originalUrl Raw request target, e.g. `req.originalUrl`.
 * @returns The same target with secret path segments and query values replaced.
 */
export function redactSensitiveUrl (originalUrl: string): string {
    if (!originalUrl) return originalUrl;
    const { path, suffix } = splitTarget(originalUrl);
    const segments = path.split("/");
    segments.forEach((segment, index) => {
        if (SecretAfterSegments.includes(segment.toLowerCase()) && segments[index + 2]) {
            segments[index + 2] = RedactedValue;
        }
    });
    let redacted = segments.join("/");
    if (!suffix.startsWith("?")) return redacted + suffix;
    const [query, ...fragment] = suffix.slice(1).split("#");
    redacted += `?${query
        .split("&")
        .map(pair => {
            const key = pair.split("=")[0];
            if (!SensitiveQueryKeys.includes(decodeOnce(key).toLowerCase())) return pair;
            return `${key}=${RedactedValue}`;
        })
        .join("&")}`;
    if (fragment.length) redacted += `#${fragment.join("#")}`;
    return redacted;
}

/**
 * Whether a request body should be parsed as JSON.
 *
 * Compares only the media type: a comparison against the whole header value misses
 * `application/json; charset=utf-8`, and the body would then be handed to the multipart parser.
 *
 * @param contentType Raw `Content-Type` header value.
 */
export function isJsonContentType (contentType: string | undefined): boolean {
    if (!contentType) return false;
    return contentType.split(";")[0].trim().toLowerCase() === "application/json";
}
