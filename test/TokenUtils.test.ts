/* Copyright Elysia © 2025. All rights reserved */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getIDFromToken, stripTokenPrefix } from "../src/AppUtils/TokenUtils";

// A token whose base64 payload contains "Bot": `replace(/Bot/g, "")` used to corrupt this.
const IdSegment = Buffer.from("1056491867375673424").toString("base64");
const TokenWithBotInside = `${IdSegment}.GaBotX.Zm9vYmFyBotbaz`;

describe("stripTokenPrefix", () => {
    it("removes a single Bot/Bearer prefix, case-insensitively", () => {
        assert.equal(stripTokenPrefix("Bot abc.def.ghi"), "abc.def.ghi");
        assert.equal(stripTokenPrefix("bot   abc.def.ghi"), "abc.def.ghi");
        assert.equal(stripTokenPrefix("BEARER abc.def.ghi"), "abc.def.ghi");
        assert.equal(stripTokenPrefix("  Bot abc.def.ghi  "), "abc.def.ghi");
        assert.equal(stripTokenPrefix("abc.def.ghi"), "abc.def.ghi");
    });

    it("keeps 'Bot' that is part of the token itself", () => {
        assert.equal(stripTokenPrefix(TokenWithBotInside), TokenWithBotInside);
        assert.equal(stripTokenPrefix(`Bot ${TokenWithBotInside}`), TokenWithBotInside);
    });

    it("returns an empty string for anything unusable", () => {
        assert.equal(stripTokenPrefix(undefined), "");
        assert.equal(stripTokenPrefix(null), "");
        assert.equal(stripTokenPrefix(42), "");
        assert.equal(stripTokenPrefix("   "), "");
    });
});

describe("getIDFromToken", () => {
    it("decodes the snowflake from the first segment", () => {
        assert.equal(getIDFromToken(`${IdSegment}.abc.def`), "1056491867375673424");
        assert.equal(getIDFromToken(`Bot ${IdSegment}.abc.def`), "1056491867375673424");
        assert.equal(getIDFromToken(TokenWithBotInside), "1056491867375673424");
    });

    it("returns null when there is no decodable ID", () => {
        assert.equal(getIDFromToken(""), null);
        assert.equal(getIDFromToken(undefined), null);
        assert.equal(getIDFromToken("single-segment"), null);
        assert.equal(getIDFromToken("bm90LWEtc25vd2ZsYWtl.abc.def"), null);
    });
});
