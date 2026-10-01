/* Copyright Elysia © 2025. All rights reserved */

import { APIGuildMember, APIUser } from "discord-api-types/v10";
import { net } from "electron";
import express from "express";
import multer from "multer";
import selfsigned from "selfsigned";
import GlobalConfig from "src/AppCore/Config";
import Constants from "src/AppCore/Constants";

import { UserFlagsBitField } from "./DiscordBitField";
import { buildUpstreamUrl, isJsonContentType } from "./RequestGuards";
import { getIDFromToken } from "./TokenUtils";
import { BadgesBasedUserDataAndExtends as UserBadges } from "./UserBadges";
import { isNewerVersion } from "./Version";

/**
 * Log a failed route callback and answer with a Discord-shaped error body.
 *
 * Callbacks passed to {@link Util.getDataFromRequest} run from a stream/multer callback, i.e.
 * outside the call stack Express can catch, so a throw or rejection there would otherwise become an
 * unhandled error in the main process and leave the request hanging.
 */
function failRequest (req: express.Request, res: express.Response, err: unknown) {
    console.error(`Route handler failed for ${req.method} ${req.originalUrl}:`, err);
    if (res.headersSent) return res.end();
    return res.status(500).send({
        message: "APIServer: Internal error while handling this request",
        code: 0,
    });
}

export default class Util {
    static ProfilePatch (
        userData: APIUser,
        guildMember: APIGuildMember | null = null,
        guildId: string | null = null,
        bio: string | null = null,
    ) {
        const flags = new UserFlagsBitField(userData.flags);
        const badges: object[] = [];
        flags.toArray().map(element => {
            // @ts-expect-error TS7053
            if (UserBadges[element]) {
                // @ts-expect-error TS7053
                badges.push(UserBadges[element]);
            }
        });
        if (userData.id !== Constants.UserIdDefault && GlobalConfig.config.generate_fake_profile) {
            if (userData.bot) {
                badges.push(
                    UserBadges.BotCommands,
                    UserBadges.ApplicationAutomod,
                    UserBadges.ApplicationGuildSubscription,
                );
            } else {
                badges.push(
                    UserBadges.PremiumDefault,
                    UserBadges.GuildBooster(9),
                    UserBadges.PremiumTenureV2(60),
                    UserBadges.LegacyUsername,
                    UserBadges.QuestCompleted,
                );
            }
        }
        /*
		// https://github.com/discord/discord-api-docs/issues/6623
		if (userData.premium_type > 0) {
			badges.push(UserBadges.PREMIUM_DEFAULT);
			if (userData.premium_type == 2) {
				badges.push(UserBadges.GUILD_BOOSTER_LEVEL(9));
			}
			// Ruby
			badges.push(UserBadges.PREMIUM_TENURE(60));
		}
		*/
        if (!bio && GlobalConfig.config.generate_fake_profile) {
            bio = "<a:shiggy:1162436090775470160> Based on the cutest Discord client mod :3";
        }
        return {
            application_role_connections: [],
            badges,
            connected_accounts: [],
            guild_badges: [],
            guild_member: guildMember,
            guild_member_profile: guildMember && {
                guild_id: guildId,
                pronouns: "",
                bio: "",
                banner: guildMember.banner,
                accent_color: null,
                theme_colors: null,
                popout_animation_particle_type: null,
                emoji: null,
                profile_effect: null,
            },
            legacy_username: null,
            mutual_friends: [],
            mutual_friends_count: 0,
            mutual_guilds: [],
            premium_since: GlobalConfig.config.generate_fake_profile ? "2016-12-22T00:00:00.000000+00:00" : null,
            premium_guild_since: GlobalConfig.config.generate_fake_profile ? "2016-12-22T00:00:00.000000+00:00" : null,
            // Force enable Nitro features (Bot)
            premium_type: userData.bot ? 2 : userData.premium_type,
            profile_themes_experiment_bucket: 4,
            user: userData,
            user_profile: {
                accent_color: userData.accent_color,
                banner: userData.banner,
                bio,
                emoji: null,
                popout_animation_particle_type: null,
                profile_effect: null,
                pronouns: null,
                theme_colors: null,
            },
        };
    }
    /**
     * Decode the account ID a Discord token belongs to.
     * @see {@link getIDFromToken} in `TokenUtils.ts` for the (unit tested) implementation.
     */
    static getIDFromToken (token: unknown = ""): string | null {
        return getIDFromToken(token);
    }

    static getDataFromRequest (
        req: express.Request,
        res: express.Response,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        callback: (rq: express.Request<any, any, any, any>, rs: express.Response) => unknown,
    ) {
        let data = "";
        const runCallback = () => {
            try {
                const result = callback(req, res);
                if (result && typeof (result as Promise<unknown>).then === "function") {
                    (result as Promise<unknown>).catch(err => failRequest(req, res, err));
                }
            } catch (err) {
                failRequest(req, res, err);
            }
        };
        // Media type only: `application/json; charset=utf-8` is still JSON.
        if (!isJsonContentType(req.headers["content-type"])) {
            return multer().any()(req, res, function (err) {
                if (err) {
                    console.error("Multer Error:", err);
                }
                runCallback();
            });
        }
        req.on("data", function (chunk) {
            data += chunk;
        });
        req.on("error", err => {
            // Without this the stream error is unhandled and the response never completes.
            console.error("Request stream error:", err);
            if (!res.headersSent) {
                res.status(400).send({
                    message: "APIServer: Could not read the request body",
                    code: 0,
                });
            }
        });
        req.on("end", function () {
            req.rawBody = data;
            if (data) {
                try {
                    req.body = JSON.parse(data);
                } catch (e) {
                    req.body = undefined;
                    console.error("JSON Parse Error:", e);
                }
            }
            runCallback();
        });
    }
    /**
     * Create a ISO Date string
     * Ex: 2024-12-25T14:14:53.033000+00:00
     * @param {number} addYear
     * @returns
     */
    static makeISODate (addYear = 0) {
        const date = new Date();
        date.setFullYear(date.getFullYear() + addYear);
        return date.toISOString().replace("Z", "000+00:00");
    }
    /**
     * Create a ISO Date string without milliseconds
     * Ex: 2024-12-25T14:18:15+00:00
     * @param {number} addYear
     * @returns
     */
    static makeISODateWithoutMilliseconds (addYear = 0) {
        const date = new Date();
        date.setFullYear(date.getFullYear() + addYear);
        return date.toISOString().replace(/\.\d+Z/, "+00:00");
    }
    /**
     * Compares two version strings and determines if `versionB` is newer than `versionA`.
     * Tolerates a `v` prefix, prerelease suffixes (nightly builds) and build metadata, and returns
     * `false` instead of throwing on an unparseable version.
     *
     * @param versionA - The current version (e.g., "v1.2.3" or "1.2.3").
     * @param versionB - The new version to check (e.g., "v1.3.0" or "1.3.0").
     * @returns `true` if `versionB` is newer than `versionA`, otherwise `false`.
     * @see {@link isNewerVersion} in `Version.ts` for the (unit tested) implementation.
     */
    static isNewerVersion (versionA: unknown, versionB: unknown) {
        return isNewerVersion(versionA, versionB);
    }
    static async proxy (req: express.Request, res: express.Response) {
        if (!net.isOnline()) {
            return res.status(503).send({ message: "chrome://dino" });
        }

        // Resolve the upstream URL instead of concatenating the raw request target onto the origin:
        // a target such as `/\evil.com/x` would otherwise resolve to another origin and leak the
        // rewritten `Authorization: Bot <token>` header to it (see buildUpstreamUrl).
        const upstreamUrl = buildUpstreamUrl(req.originalUrl);
        if (!upstreamUrl) {
            console.error("Proxy rejected an out-of-origin request target:", req.originalUrl);
            return res.status(400).send({
                message: "APIServer: Invalid request target",
                code: 0,
            });
        }

        // 1. Create Electron request
        const electronReq = net.request({
            method: req.method as string,
            url: upstreamUrl.toString(),
            redirect: "follow",
            useSessionCookies: true,
        });

        // 2. Copy headers (Express -> Electron)
        const skipHeaders = [
            "host",
            "connection",
            "content-length",
            "transfer-encoding",
            "upgrade",
            "origin",
            "referer",
        ];

        Object.entries(req.headers).forEach(([key, value]) => {
            if (value && !skipHeaders.includes(key.toLowerCase())) {
                try {
                    const headerValue = Array.isArray(value) ? value.join(", ") : value;
                    electronReq.setHeader(key, headerValue);
                } catch {
                    //
                }
            }
        });

        // 3. Origin & Referer
        electronReq.setHeader("Origin", "https://canary.discord.com");
        electronReq.setHeader("Referer", "https://canary.discord.com/");

        // 4. Electron -> Express
        electronReq.on("response", electronRes => {
            res.status(electronRes.statusCode);
            const skipResHeaders = [
                "content-encoding",
                "content-length",
                "transfer-encoding",
            ];
            Object.entries(electronRes.headers).forEach(([key, value]) => {
                if (value && !skipResHeaders.includes(key.toLowerCase())) {
                    try {
                        res.setHeader(key, value);
                    } catch {
                        //
                    }
                }
            });

            electronRes.on("data", chunk => res.write(chunk));
            electronRes.on("end", () => res.end());
            electronRes.on("error", err => {
                console.error("Proxy response error:", err);
                if (!res.headersSent) res.status(500).end();
            });
        });

        electronReq.on("error", err => {
            console.error("Proxy request error:", err);
            if (!res.headersSent) res.status(500).send({ error: err.message });
        });

        // 5. Pipe request body (Express -> Electron)
        if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            req.pipe(electronReq as any);
        } else {
            electronReq.end();
        }
    }
    static generateSelfSignedCertificate () {
        return selfsigned.generate([{ name: "commonName", value: "localhost" }], {
            days: 3650,
            keySize: 2048,
            algorithm: "sha256",
            extensions: [
                {
                    name: "basicConstraints",
                    cA: true,
                },
                {
                    name: "subjectAltName",
                    altNames: [
                        {
                            type: 2, // DNS
                            value: "localhost",
                        },
                        {
                            type: 7, // IP
                            ip: "127.0.0.1",
                        },
                    ],
                },
            ],
        });
    }
}
