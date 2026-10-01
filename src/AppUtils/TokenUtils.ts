/* Copyright Elysia © 2025. All rights reserved */

/**
 * Pure token helpers. Kept free of Electron imports so they are unit testable
 * (see `test/TokenUtils.test.ts`).
 */

/**
 * Strip a single leading `Bot`/`Bearer` prefix from an authorization value.
 *
 * Only the **prefix** is removed: a bot token is base64url data that may legitimately contain
 * `Bot` somewhere in the middle, and stripping every occurrence corrupts the token (which then
 * fails against Discord with a confusing 401).
 *
 * @param token Raw `Authorization` header value or user-entered token.
 * @returns The bare token, or an empty string when there is nothing usable.
 */
export function stripTokenPrefix (token: unknown): string {
    if (typeof token !== "string") return "";
    return token.trim().replace(/^(Bot|Bearer)\s+/i, "").trim();
}

/**
 * Decode the account ID a Discord token belongs to.
 *
 * @param token Raw `Authorization` header value or bare token.
 * @returns The snowflake encoded in the token's first part, or `null` when it cannot be read.
 */
export function getIDFromToken (token: unknown): string | null {
    const bare = stripTokenPrefix(token);
    if (!bare) return null;
    const parts = bare.split(".");
    // A token must have at least 2 parts (id.secret).
    if (parts.length < 2) return null;
    try {
        const decoded = Buffer.from(parts[0], "base64").toString();
        // Discord user/bot IDs are numeric (snowflakes).
        if (!decoded || !/^\d+$/.test(decoded)) return null;
        return decoded;
    } catch {
        return null;
    }
}
