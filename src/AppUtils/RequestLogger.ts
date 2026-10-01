/* Copyright Elysia © 2025. All rights reserved */

import { scope } from "electron-log";
import express from "express";
import morgan from "morgan";
import GlobalConfig from "src/AppCore/Config";

import { redactSensitiveUrl } from "./RequestGuards";

type ScopedLogger = ReturnType<typeof scope>;

/**
 * Request URL with credentials masked.
 * electron-log persists these lines to disk, and Discord API URLs can carry secrets
 * (webhook/interaction tokens, OAuth codes), so the raw target is never logged.
 */
morgan.token("safe-url", (req: express.Request) => redactSensitiveUrl(req.originalUrl || req.url));

const LogFormat = ":method :safe-url :status :res[content-length] - :response-time ms";

/**
 * Build the request-logging middleware used by both local servers.
 *
 * Logging is opt-in via the `verbose_logging` config key (default `false`) and is evaluated per
 * request, so toggling it in the config editor takes effect without restarting the app.
 *
 * @param logger Scoped electron-log instance the lines are written to.
 */
export function createRequestLogger (logger: ScopedLogger) {
    return morgan(LogFormat, {
        skip: () => !GlobalConfig.config.verbose_logging,
        stream: {
            write: msg => logger.info(msg.replace(/\n/g, "")),
        },
    });
}
