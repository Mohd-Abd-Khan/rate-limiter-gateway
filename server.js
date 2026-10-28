import cors from "cors";
import express from "express";
import { createProxyMiddleware } from "http-proxy-middleware";

import { mockApp } from "./mockServer.js";
import { rateLimiter } from "./src/middleware/rateLimiter.js";
import { requestLogger } from "./src/middleware/requestLogger.js";
import { getStats, statsTracker } from "./src/middleware/statsTracker.js";
import redis from "./src/config/redisClient.js";

const app = express();

app.use(cors());

// Configure trust proxy if specified (useful when behind Nginx / Cloudflare / ALB)
if (process.env.TRUST_PROXY) {
    app.set("trust proxy", process.env.TRUST_PROXY === "true" ? true : process.env.TRUST_PROXY);
}

const PORT = Number(process.env.PORT) || 8080;
const MOCK_PORT = Number(process.env.MOCK_PORT) || 3001;

const UPSTREAM_TARGET =
    process.env.UPSTREAM_TARGET || `http://127.0.0.1:${MOCK_PORT}`;

// Start mock backend when no external upstream is configured
let mockServerInstance = null;
if (!process.env.UPSTREAM_TARGET) {
    mockServerInstance = mockApp.listen(MOCK_PORT, "0.0.0.0", () => {
        console.log(`Mock backend running on port ${MOCK_PORT}`);
    });
    mockServerInstance.on("error", (err) => {
        console.error(`Mock backend failed to bind on port ${MOCK_PORT}:`, err.message);
    });
}

const proxyMiddleware = createProxyMiddleware({
    target: UPSTREAM_TARGET,
    changeOrigin: true,
    pathRewrite: (path) => `/api${path}`,
    on: {
        error: (err, req, res) => {
            console.error("Proxy error connecting to upstream:", err.message);
            if (!res.headersSent) {
                res.status(502).json({
                    error: "Bad Gateway",
                    message: "Failed to connect to upstream service"
                });
            }
        }
    }
});

app.use(
    "/api",
    requestLogger,
    statsTracker,
    rateLimiter,
    proxyMiddleware
);

// Comprehensive Health check
app.get("/health", async (req, res) => {
    let redisStatus = "unknown";
    try {
        const ping = await redis.ping();
        redisStatus = ping === "PONG" ? "healthy" : "unhealthy";
    } catch {
        redisStatus = "unreachable";
    }

    const isHealthy = redisStatus === "healthy";
    const statusCode = isHealthy ? 200 : 503;

    res.status(statusCode).json({
        status: isHealthy ? "ok" : "degraded",
        uptime: Math.round(process.uptime()),
        timestamp: new Date().toISOString(),
        dependencies: {
            redis: redisStatus,
            upstream: UPSTREAM_TARGET
        }
    });
});

// Statistics
app.get("/stats", (req, res) => {
    res.status(200).json(getStats());
});

// Start gateway
const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Rate limiter gateway running on port ${PORT}`);
    console.log(`Upstream target: ${UPSTREAM_TARGET}`);
});

server.on("error", (err) => {
    console.error(`Gateway server failed on port ${PORT}:`, err.message);
});

// Graceful shutdown handler
const shutdown = async (signal) => {
    console.log(`\nReceived ${signal}, shutting down gracefully...`);
    if (mockServerInstance) {
        mockServerInstance.close();
    }
    server.close(() => {
        console.log("Gateway HTTP server closed.");
    });
    try {
        await redis.quit();
        console.log("Redis connection closed.");
    } catch {
        redis.disconnect();
    }
    process.exit(0);
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

export { app, server };