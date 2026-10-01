/* Copyright Elysia © 2025. All rights reserved */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    buildUpstreamUrl,
    isBlacklistedRoute,
    isJsonContentType,
    normalizeRequestPath,
    redactSensitiveUrl,
    UpstreamOrigin,
} from "../src/AppUtils/RequestGuards";

// A representative subset of Constants.BlacklistRoutes.
const Blacklist = ["users/@me/mfa", "users/@me/delete", "science", "/ack", "connections/"];

describe("normalizeRequestPath", () => {
    it("drops the query string and fragment", () => {
        assert.equal(normalizeRequestPath("/api/v9/users/@me?with_analytics=true#x"), "/api/v9/users/@me");
    });

    it("percent-decodes, including double encoding", () => {
        assert.equal(normalizeRequestPath("/api/v9/users/%40me"), "/api/v9/users/@me");
        assert.equal(normalizeRequestPath("/api/v9/users/%2540me"), "/api/v9/users/@me");
    });

    it("resolves dot segments and collapses separators", () => {
        assert.equal(normalizeRequestPath("/api/v9//users/./@me"), "/api/v9/users/@me");
        assert.equal(normalizeRequestPath("/api/v9/users/@me/../@me/mfa"), "/api/v9/users/@me/mfa");
        assert.equal(normalizeRequestPath("/api/v9\\users\\@me"), "/api/v9/users/@me");
    });

    it("lower-cases the path and never returns a relative path", () => {
        assert.equal(normalizeRequestPath("/API/V9/Users/@Me"), "/api/v9/users/@me");
        assert.equal(normalizeRequestPath("/.."), "/");
        assert.equal(normalizeRequestPath(""), "/");
    });
});

describe("isBlacklistedRoute", () => {
    it("blocks the plain form", () => {
        assert.equal(isBlacklistedRoute("/api/v9/users/@me/mfa/totp/enable", Blacklist), true);
        assert.equal(isBlacklistedRoute("/api/v9/science", Blacklist), true);
        assert.equal(isBlacklistedRoute("/api/v9/users/@me/connections/", Blacklist), true);
    });

    it("blocks encoded, traversed and mixed-case bypasses of the same endpoint", () => {
        assert.equal(isBlacklistedRoute("/api/v9/users/%40me/mfa/totp/enable", Blacklist), true);
        assert.equal(isBlacklistedRoute("/api/v9/users/%2540me/mfa/totp/enable", Blacklist), true);
        assert.equal(isBlacklistedRoute("/api/v9/users/@me/../@me/mfa/totp/enable", Blacklist), true);
        assert.equal(isBlacklistedRoute("/api/v9/users/@me/MFA/totp/enable", Blacklist), true);
        assert.equal(isBlacklistedRoute("/api/v9//users//@me//mfa", Blacklist), true);
        assert.equal(isBlacklistedRoute("/api/v9/channels/1/messages/2/ACK", Blacklist), true);
    });

    it("does not block unrelated endpoints, including a query that looks blacklisted", () => {
        assert.equal(isBlacklistedRoute("/api/v9/users/@me", Blacklist), false);
        assert.equal(isBlacklistedRoute("/api/v9/users/@me/guilds", Blacklist), false);
        assert.equal(isBlacklistedRoute("/api/v9/channels/1/messages?content=/ack", Blacklist), false);
    });
});

describe("buildUpstreamUrl", () => {
    it("keeps path and query on the upstream origin", () => {
        const url = buildUpstreamUrl("/api/v9/users/@me?with_counts=true");
        assert.equal(url?.toString(), `${UpstreamOrigin}/api/v9/users/@me?with_counts=true`);
    });

    it("never resolves to another origin", () => {
        for (const target of ["//evil.com/api/v9/users/@me", "/\\evil.com/api/v9/users/@me", "/\\\\evil.com/x"]) {
            const url = buildUpstreamUrl(target);
            assert.equal(url?.origin, UpstreamOrigin, `${target} escaped the upstream origin`);
        }
    });

    it("rejects targets that are not origin-form", () => {
        assert.equal(buildUpstreamUrl("https://evil.com/api/v9/users/@me"), null);
        assert.equal(buildUpstreamUrl("api/v9/users/@me"), null);
        assert.equal(buildUpstreamUrl(""), null);
    });

    it("does not decode encoded separators in the path", () => {
        const url = buildUpstreamUrl("/api/v9/guilds/1/channels%2Fx");
        assert.equal(url?.pathname, "/api/v9/guilds/1/channels%2Fx");
    });
});

describe("redactSensitiveUrl", () => {
    it("masks webhook and interaction tokens", () => {
        assert.equal(redactSensitiveUrl("/api/v9/webhooks/123/s3cr3t-token"), "/api/v9/webhooks/123/[redacted]");
        assert.equal(
            redactSensitiveUrl("/api/v9/webhooks/123/s3cr3t-token/messages/@original"),
            "/api/v9/webhooks/123/[redacted]/messages/@original",
        );
        assert.equal(
            redactSensitiveUrl("/api/v9/interactions/456/s3cr3t-token/callback"),
            "/api/v9/interactions/456/[redacted]/callback",
        );
    });

    it("masks sensitive query values only", () => {
        assert.equal(
            redactSensitiveUrl("/api/v9/oauth2/token?code=abc&client_id=1&limit=50"),
            "/api/v9/oauth2/token?code=[redacted]&client_id=1&limit=50",
        );
        assert.equal(
            redactSensitiveUrl("/api/v9/channels/1/messages?limit=50"),
            "/api/v9/channels/1/messages?limit=50",
        );
    });

    it("leaves ordinary targets untouched", () => {
        assert.equal(redactSensitiveUrl("/api/v9/users/@me"), "/api/v9/users/@me");
        assert.equal(redactSensitiveUrl(""), "");
    });
});

describe("isJsonContentType", () => {
    it("accepts the JSON media type with parameters", () => {
        assert.equal(isJsonContentType("application/json"), true);
        assert.equal(isJsonContentType("application/json; charset=utf-8"), true);
        assert.equal(isJsonContentType("Application/JSON"), true);
        assert.equal(isJsonContentType(" application/json "), true);
    });

    it("rejects other media types", () => {
        assert.equal(isJsonContentType("multipart/form-data; boundary=x"), false);
        assert.equal(isJsonContentType("text/plain"), false);
        assert.equal(isJsonContentType(undefined), false);
    });
});
