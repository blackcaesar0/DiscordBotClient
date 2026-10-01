/* Copyright Elysia © 2025. All rights reserved */

import { scope } from "electron-log";
import express from "express";
import { readFileSync } from "fs";
import https from "https";
import { type AddressInfo } from "net";
import path from "path";
import { registerRoutesSync } from "src/AppUtils/RegisterRoutes";
import { isBlacklistedRoute } from "src/AppUtils/RequestGuards";
import { createRequestLogger } from "src/AppUtils/RequestLogger";
import Util from "src/AppUtils/Utils";

import Constants from "./Constants";

const logger = scope("APIServer");

const app = express();

app.use(createRequestLogger(logger));

const HttpsOptions = Util.generateSelfSignedCertificate();

const server = https.createServer({
    key: HttpsOptions.private,
    cert: HttpsOptions.cert,
}, app);

const ignoreHeaders = ["cookie", "sec-", "referer", "origin", "authorization", "host"];

// Handle headers
app.all("*", function (req, res, next) {
    req.originalHeaders = req.headers;
    const headers: typeof req.headers = {};
    Object.keys(req.headers).forEach(key => {
        if (!ignoreHeaders.some(prefix => key.toLowerCase().startsWith(prefix))) {
            headers[key] = req.headers[key];
        }
    });
    if (req.headers.authorization) {
        if (!req.headers.authorization.toLowerCase().startsWith("bot ")) {
            headers.authorization = `Bot ${req.headers.authorization.trim()}`;
        } else {
            headers.authorization = req.headers.authorization.trim();
        }
        headers["user-agent"] = Constants.UserAgentDiscordBot;
    }
    req.headers = headers;
    next();
});

registerRoutesSync(app, path.resolve(__dirname, "routes"), ["/api/v10", "/api/v9", "/api"]);

app.all("/developers/*", (req, res) => {
    return res.redirect("/app");
});

// Other
app.use((req, res, next) => {
    if (req.originalUrl.endsWith(".map")) return res.status(404).send();
    if (isBlacklistedRoute(req.originalUrl, Constants.BlacklistRoutes)) {
        return res.status(403).send({
            message: "APIServer: Bots cannot use this endpoint",
            code: 20001,
        });
    }
    // API routes
    // `Util.proxy` is async: without forwarding the rejection, a failure here would surface as an
    // unhandled rejection in the main process instead of an error response.
    if (req.originalUrl.includes("/api/")) return Util.proxy(req, res).catch(next);
    // Main page
    if (["/", "/app", "/login"].includes(req.path) || ["/channels/"].some(s => req.path.startsWith(s))) {
        logger.log("Serving Discord HTML for route:", req.path);
        return res.send(readFileSync(Constants.DiscordHTMLPath, "utf8"));
    }
    // Other routes
    req.headers = req.originalHeaders;
    return Util.proxy(req, res).catch(next);
});

// Error handler. The Discord web client can only parse JSON error bodies, while Express' default
// handler answers with an HTML stack-trace page (which also leaks local paths into the renderer).
app.use((err: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
    logger.error(`Unhandled error while serving ${req.method} ${req.path}:`, err);
    if (res.headersSent) return res.end();
    return res.status(500).send({
        message: "APIServer: Internal error while proxying this request",
        code: 0,
    });
});

export default async function startAppServer (): Promise<number> {
    return new Promise((resolve, reject) => {
        const callback = () => {
            const address = server.address() as AddressInfo;
            resolve(address.port);
            logger.log(`API Server listening on https://localhost:${address.port}`);
        };
        // Bind to the loopback interface only. The previous `listen(0)` bound to 0.0.0.0,
        // exposing the Discord API proxy (with the app's session cookies) to the whole LAN.
        // The app reaches this server via 127.0.0.1 (host-rules maps discord.com -> 127.0.0.1),
        // so loopback-only binding is fully sufficient.
        server.listen(0, "127.0.0.1").once("listening", callback);
        server.on("error", reject);
    });
}
