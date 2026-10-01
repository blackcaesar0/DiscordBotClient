/* Copyright Elysia © 2025. All rights reserved */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isNewerVersion, parseVersionCore } from "../src/AppUtils/Version";

describe("parseVersionCore", () => {
    it("parses the numeric core", () => {
        assert.deepEqual(parseVersionCore("v3.9.1"), [3, 9, 1]);
        assert.deepEqual(parseVersionCore("3.9"), [3, 9]);
        assert.deepEqual(parseVersionCore("3.9.1-nightly.4"), [3, 9, 1]);
        assert.deepEqual(parseVersionCore("3.9.1+build.7"), [3, 9, 1]);
    });

    it("returns null for anything unparseable", () => {
        assert.equal(parseVersionCore("not-a-version"), null);
        assert.equal(parseVersionCore(""), null);
        assert.equal(parseVersionCore(undefined), null);
        assert.equal(parseVersionCore(3.9), null);
    });
});

describe("isNewerVersion", () => {
    it("compares releases component by component", () => {
        assert.equal(isNewerVersion("3.9.1", "3.9.2"), true);
        assert.equal(isNewerVersion("3.9.1", "3.10.0"), true);
        assert.equal(isNewerVersion("3.9.1", "4.0.0"), true);
        assert.equal(isNewerVersion("v3.9.1", "v3.9.1"), false);
        assert.equal(isNewerVersion("3.10.0", "3.9.9"), false);
        assert.equal(isNewerVersion("3.9.1", "3.9"), false);
    });

    it("orders prereleases before the release they precede", () => {
        assert.equal(isNewerVersion("3.9.1-nightly.1", "3.9.1"), true);
        assert.equal(isNewerVersion("3.9.1", "3.9.1-nightly.1"), false);
        assert.equal(isNewerVersion("3.9.1-nightly.1", "3.9.2-nightly.1"), true);
    });

    it("never throws on malformed input, it just reports no update", () => {
        assert.equal(isNewerVersion("3.9.1", "garbage"), false);
        assert.equal(isNewerVersion("garbage", "3.9.1"), false);
        assert.equal(isNewerVersion(undefined, null), false);
    });
});
