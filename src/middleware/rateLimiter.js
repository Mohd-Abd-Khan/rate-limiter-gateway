import { isAllowed as fixedWindow } from "../algorithms/fixedWindowCounter.js";
import { isAllowed as slidingLog } from "../algorithms/slidingWindowLog.js";
import { isAllowed as slidingCounter } from "../algorithms/slidingWindowCounter.js";
import { isAllowed as tokenBucket } from "../algorithms/tokenBucket.js";
import { isAllowed as leakyBucket } from "../algorithms/leakyBucket.js";
import { logger } from "./logger.js";

import {
    limit,
    capacity,
    windowSize,
    refillRate,
    ROUTE_ALGO_MAP,
    DEFAULT_ALGO,
    VALID_ALGORITHMS,
    ALLOW_QUERY_OVERRIDE,
    ENABLE_ROUTE_ISOLATION,
    RATE_LIMIT_FAIL_OPEN
} from "../config/rateLimitConfig.js";

export const rateLimiter = async (req, res, next) => {
    try {
        const clientId = req.ip || req.socket.remoteAddress || "127.0.0.1";

        // Resolve path accurately whether mounted at root or mounted via app.use("/api", ...)
        const fullPath = req.baseUrl ? `${req.baseUrl}${req.path}` : req.path;
        const normalizedPath = fullPath.replace(/\/$/, "") || "/";

        // Algorithm resolution: Query Param (if permitted) -> Route Mapping -> Global Default
        let algorithm = null;
        if (ALLOW_QUERY_OVERRIDE && req.query.algo) {
            algorithm = String(req.query.algo);
        } else {
            algorithm =
                ROUTE_ALGO_MAP[normalizedPath] ||
                ROUTE_ALGO_MAP[fullPath] ||
                ROUTE_ALGO_MAP[req.path] ||
                DEFAULT_ALGO;
        }

        if (!VALID_ALGORITHMS.includes(algorithm)) {
            return res.status(400).json({
                error: "Bad Request",
                message: `Unknown or invalid rate limiting algorithm: ${algorithm}`,
                supportedAlgorithms: VALID_ALGORITHMS
            });
        }

        const routeKey = ENABLE_ROUTE_ISOLATION
            ? normalizedPath.replace(/[^a-zA-Z0-9_-]/g, "_")
            : "";

        let result = { allowed: false, remaining: 0, reset: 0 };

        switch (algorithm) {
            case "fixedWindow":
                result = await fixedWindow(clientId, limit, windowSize, routeKey);
                break;

            case "slidingLog":
                result = await slidingLog(clientId, limit, windowSize, routeKey);
                break;

            case "slidingCounter":
                result = await slidingCounter(clientId, limit, windowSize, routeKey);
                break;

            case "tokenBucket":
                result = await tokenBucket(clientId, capacity, refillRate, routeKey);
                break;

            case "leakyBucket":
                result = await leakyBucket(clientId, capacity, refillRate, routeKey);
                break;

            default:
                return res.status(400).json({
                    error: "Bad Request",
                    message: `Unknown rate limiting algorithm: ${algorithm}`
                });
        }

        const isAllowedReq =
            typeof result === "object" && result !== null
                ? result.allowed
                : Boolean(result);

        const remaining = result?.remaining ?? 0;
        const reset = result?.reset ?? 1;
        const maxLimit = algorithm.includes("Bucket") ? capacity : limit;

        // Set standard rate limit headers
        res.setHeader("X-RateLimit-Algorithm", algorithm);
        res.setHeader("X-RateLimit-Limit", String(maxLimit));
        res.setHeader("X-RateLimit-Remaining", String(Math.max(0, remaining)));
        res.setHeader("X-RateLimit-Reset", String(reset));

        if (isAllowedReq) {
            return next();
        }

        res.setHeader("Retry-After", String(reset));
        return res.status(429).json({
            error: "Too Many Requests",
            message: "Too many requests",
            retryAfter: reset,
            algorithm
        });

    } catch (err) {
        logger.error("Rate limiter Redis/Engine failure:", {
            error: err.message,
            stack: err.stack,
            url: req.originalUrl,
            clientId: req.ip
        });

        // Expose degraded-service indicator header
        res.setHeader("X-RateLimit-Degraded", "true");

        if (RATE_LIMIT_FAIL_OPEN) {
            // High availability: fail open to keep business service accessible
            return next();
        }

        // Fail-closed policy when explicitly enforced
        return res.status(503).json({
            error: "Service Unavailable",
            message: "Rate limiting service temporarily unavailable"
        });
    }
};