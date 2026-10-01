/* Copyright Elysia © 2025. All rights reserved */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { after, before, describe, it } from "node:test";

import { traverseDirectorySync } from "../src/AppUtils/RegisterRoutes";

let root: string;

before(() => {
    root = mkdtempSync(join(tmpdir(), "dbc-routes-"));
    mkdirSync(join(root, "#id"));
    mkdirSync(join(root, "users"));
    mkdirSync(join(root, ".hidden"));
    writeFileSync(join(root, "index.ts"), "");
    writeFileSync(join(root, "v2.ts"), "");
    writeFileSync(join(root, "types.d.ts"), "");
    writeFileSync(join(root, "notes.md"), "");
    writeFileSync(join(root, ".DS_Store.ts"), "");
    writeFileSync(join(root, "#id", "profile.ts"), "");
    writeFileSync(join(root, "users", "index.ts"), "");
    writeFileSync(join(root, ".hidden", "sneaky.ts"), "");
});

after(() => {
    rmSync(root, { recursive: true, force: true });
});

describe("traverseDirectorySync", () => {
    it("collects route modules recursively, static entries before parameterized ones", () => {
        const found = traverseDirectorySync({ dirname: root, recursive: true }).map(file =>
            relative(root, file).split("\\").join("/"),
        );
        // Entries are sorted per directory (a nested directory is walked where its name sorts),
        // with `#param` directories always last so static routes win.
        assert.deepEqual(found, ["index.ts", "users/index.ts", "v2.ts", "#id/profile.ts"]);
    });

    it("skips declaration files, non-script files and hidden entries", () => {
        const found = traverseDirectorySync({ dirname: root, recursive: true }).map(file =>
            relative(root, file).split("\\").join("/"),
        );
        assert.equal(
            found.some(file => file.endsWith(".d.ts")),
            false,
        );
        assert.equal(
            found.some(file => file.endsWith(".md")),
            false,
        );
        // Hidden entries are excluded: the default patterns are anchored, so they only work when
        // matched against the entry name.
        assert.equal(
            found.some(file => file.includes(".hidden") || file.includes(".DS_Store")),
            false,
        );
    });

    it("does not recurse when recursive is not set", () => {
        const found = traverseDirectorySync({ dirname: root }).map(file => relative(root, file));
        assert.deepEqual(found, ["index.ts", "v2.ts"]);
    });
});
