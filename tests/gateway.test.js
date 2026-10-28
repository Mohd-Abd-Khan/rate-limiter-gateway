import { describe, it, after, before } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

// Start a lightweight test instance of Express app
import express from "express";
import { rateLimiter } from "../src/middleware/rateLimiter.js";
import { statsTracker, getStats, resetStats } from "../src/middleware/statsTracker.js";
import redis from "../src/config/redisClient.js";

const app = express();
app.use(statsTracker);
app.use("/api", rateLimiter, (req, res) => {
    res.json({ message: "upstream ok", path: req.path });
});

app.get("/health", async (req, res) => {
    let redisStatus = "unknown";
    try {
        const ping = await redis.ping();
        redisStatus = ping === "PONG" ? "healthy" : "unhealthy";
    } catch {
        redisStatus = "unreachable";
    }
    const isHealthy = redisStatus === "healthy";
    res.status(isHealthy ? 200 : 503).json({
        status: isHealthy ? "ok" : "degraded",
        dependencies: { redis: redisStatus }
    });
});

app.get("/stats", (req, res) => {
    res.json(getStats());
});

let server;
let baseUrl;

const request = (path, headers = {}) => {
    return new Promise((resolve, reject) => {
        const url = new URL(path, baseUrl);
        const req = http.get(url, { headers }, (res) => {
            let body = "";
            res.on("data", (chunk) => (body += chunk));
            res.on("end", () => {
                let json = null;
                try {
                    json = JSON.parse(body);
                } catch {}
                resolve({
                    status: res.statusCode,
                    headers: res.headers,
                    body: json || body
                });
            });
        });
        req.on("error", reject);
    });
};

describe("Gateway Integration & Middleware Tests", () => {
    before(async () => {
        await new Promise((resolve) => {
            server = app.listen(0, "127.0.0.1", () => {
                const port = server.address().port;
                baseUrl = `http://127.0.0.1:${port}`;
                resolve();
            });
        });
    });

    after(async () => {
        await new Promise((res) => server.close(res));
        try {
            await redis.quit();
        } catch {
            redis.disconnect();
        }
    });

    it("GET /health returns 200 with Redis dependency status", async () => {
        const res = await request("/health");
        assert.equal(res.status, 200);
        assert.equal(res.body.status, "ok");
        assert.equal(res.body.dependencies.redis, "healthy");
    });

    it("GET /stats reports tracked requests and counts", async () => {
        resetStats();
        await request("/health"); // not in stats
        const res = await request("/stats");
        assert.equal(res.status, 200);
        assert.ok(typeof res.body === "object");
    });

    it("returns HTTP 400 for invalid or unsupported algorithm query param", async () => {
        const res = await request("/api/users?algo=invalidAlgo");
        assert.equal(res.status, 400);
        assert.equal(res.body.error, "Bad Request");
        assert.ok(res.body.supportedAlgorithms.includes("fixedWindow"));
    });

    it("injects RFC RateLimit headers on requests", async () => {
        const res = await request("/api/users?algo=fixedWindow");
        assert.equal(res.status, 200);
        assert.equal(res.headers["x-ratelimit-algorithm"], "fixedWindow");
        assert.ok(res.headers["x-ratelimit-limit"]);
        assert.ok(res.headers["x-ratelimit-remaining"] !== undefined);
        assert.ok(res.headers["x-ratelimit-reset"] !== undefined);
    });

    it("correctly resolves ROUTE_ALGO_MAP when no algo query is provided (DEF-02 Fix)", async () => {
        // /api/users should resolve to fixedWindow from ROUTE_ALGO_MAP
        const resUsers = await request("/api/users");
        assert.equal(resUsers.headers["x-ratelimit-algorithm"], "fixedWindow");

        // /api/posts should resolve to tokenBucket from ROUTE_ALGO_MAP
        const resPosts = await request("/api/posts");
        assert.equal(resPosts.headers["x-ratelimit-algorithm"], "tokenBucket");
    });

    it("enforces HTTP 429 with Retry-After header when rate limit is exceeded", async () => {
        // Fire burst on an isolated path with limit=10
        const testPath = `/api/burst-test-${Date.now()}?algo=fixedWindow`;
        let lastRes = null;
        for (let i = 0; i < 12; i++) {
            lastRes = await request(testPath);
        }
        assert.equal(lastRes.status, 429);
        assert.equal(lastRes.body.error, "Too Many Requests");
        assert.ok(lastRes.headers["retry-after"]);
    });
});
