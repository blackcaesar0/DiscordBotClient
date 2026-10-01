/* Copyright Elysia © 2025. All rights reserved */

/**
 * Pure version-comparison helpers. Kept free of Electron imports so they are unit testable
 * (see `test/Version.test.ts`).
 */

function stripMetadata (version: string): string {
    return version.trim().replace(/^v/i, "").split("+")[0];
}

/**
 * Parse the numeric core of a version string.
 *
 * @param version Version such as `v1.2.3`, `1.2.3-nightly.4` or `1.2`.
 * @returns The numeric components, or `null` when the version cannot be parsed.
 */
export function parseVersionCore (version: unknown): number[] | null {
    if (typeof version !== "string") return null;
    const core = stripMetadata(version).split("-")[0];
    if (!/^\d+(\.\d+)*$/.test(core)) return null;
    return core.split(".").map(Number);
}

function isPrerelease (version: string): boolean {
    return stripMetadata(version).includes("-");
}

/**
 * Whether `candidate` is newer than `current`.
 *
 * Tolerates a `v` prefix, a missing patch component, prerelease suffixes (`1.2.3-nightly.1`, which
 * sorts *before* `1.2.3`) and build metadata. Never throws: an unparseable version returns `false`,
 * so a malformed release tag can never be mistaken for an available update.
 *
 * @param current The version in use.
 * @param candidate The version to compare against.
 */
export function isNewerVersion (current: unknown, candidate: unknown): boolean {
    const currentCore = parseVersionCore(current);
    const candidateCore = parseVersionCore(candidate);
    if (!currentCore || !candidateCore) return false;
    const length = Math.max(currentCore.length, candidateCore.length);
    for (let index = 0; index < length; index++) {
        const left = currentCore[index] ?? 0;
        const right = candidateCore[index] ?? 0;
        if (right > left) return true;
        if (right < left) return false;
    }
    // Same numeric core: only a prerelease -> release transition is an upgrade.
    return isPrerelease(current as string) && !isPrerelease(candidate as string);
}
