# Initial Audit Report — Rate Limiter Gateway

**Date:** 2026-10-28  
**Auditor:** Senior Backend & Security Architect  
**Project:** Rate Limiter Gateway  
**Workspace:** Project root

---

## 1. Executive & Architecture Overview

The **Rate Limiter Gateway** is an Express 5 and Redis-backed reverse proxy designed to throttle incoming HTTP requests across five rate-limiting algorithms before proxying traffic to backend upstream services.

### Core Components
1. **Entry Gateway (`server.js`)**: Starts the Express gateway on `PORT` (default 8080) and optionally starts `mockApp` on `MOCK_PORT` (default 3000 / override 3001). Applies CORS, request logging, statistics tracking, rate limiting, and reverse proxying (`http-proxy-middleware`).
2. **Mock Upstream (`mockServer.js`)**: Exposes mock endpoints `/api/users` and `/api/posts`.
3. **Rate Limiting Engine (`src/middleware/rateLimiter.js`)**: Selects algorithm based on query param `?algo=`, route mapping, or default. Executes algorithm functions backed by Redis.
4. **Five Algorithm Implementations (`src/algorithms/`)**:
   - `fixedWindowCounter.js`
   - `slidingWindowLog.js`
   - `slidingWindowCounter.js`
   - `tokenBucket.js`
   - `leakyBucket.js`
5. **Redis Client (`src/config/redisClient.js`)**: `ioredis` client with retry strategy and error logging.
6. **Observability (`src/middleware/requestLogger.js`, `statsTracker.js`, `logger.js`)**: Winston logger writing to `logs/requests.log` and `logs/blocked.log`, with an in-memory client statistics Map exposed via `GET /stats`.
7. **Frontend Test Console (`UI/index.html`)**: Single-page testing interface.

---

## 2. Baseline Verification

- **Node.js**: v24.11.1 | **npm**: 11.6.2
- **Redis**: Running in Docker container `rate-limiter-redis` at `127.0.0.1:6379`.
- **Ports**: Gateway at `127.0.0.1:8080`, Mock backend at `127.0.0.1:3001` (to prevent conflict with existing EHR containers on port 3000).
- **Health Check**: `GET /health` returns `{"status":"ok"}`.
- **Fixed Window Verification**: 10 rapid requests to `/api/users?algo=fixedWindow` returned HTTP 200, followed by HTTP 429 on requests 11 and 12.
- **Git Status**: Workspace is an uninitialized Git repository (`fatal: not a git repository`).

---

## 3. Dependency Audit Findings

Running `npm audit` revealed 3 vulnerabilities in dependencies pulled in by `express@5.2.1`:
1. **`proxy-addr` (1.1.0 - 2.0.7) — Critical (GHSA-jqcg-44mw-7w3h)**: Vulnerable to IP spoofing via IPv4-mapped IPv6 trust subnet. Fix: upgrade to `proxy-addr@2.0.8`.
2. **`body-parser` (2.0.0 - 2.3.0) — High (GHSA-27r3-jxmh-p828)**: Denial of Service via trailing bytes after compressed request body. Fix: upgrade to `body-parser@2.4.0`.
3. **`qs` (2.2.5 - 6.16.0) — Moderate (GHSA-x5fp-wj9c-mxmx, GHSA-4mjr-xmp4-gh2g, GHSA-6pq8-jhm2-2vcw)**: Denial of service and array-limit bypass. Fix: upgrade to `qs@6.17.0`.

*Resolution Plan*: Run semver-safe `npm update` / targeted subdependency resolution without breaking changes.

---

## 4. Confirmed Defects & Defect Catalog

| Defect ID | Severity | Category | Component | Description |
|-----------|----------|----------|-----------|-------------|
| **DEF-01** | **High** | Bug / Concurrency | `slidingWindowLog.js` | **Member collision in Redis Sorted Set**: Uses `now` as both score and member in `ZADD`. Concurrent requests with identical timestamp overwrite each other, causing request undercounting and rate limit bypass. |
| **DEF-02** | **High** | Logic / Routing | `rateLimiter.js` | **Route-to-Algorithm mapping failure**: Express strips `/api` when mounting `app.use('/api', rateLimiter)`. As a result, `req.path` is `/users`, not `/api/users`. `ROUTE_ALGO_MAP[req.path]` always evaluates to `undefined`, silently defaulting to `tokenBucket`. |
| **DEF-03** | **Medium** | Architecture / Isolation | All algorithms | **No Route-Level Key Isolation**: Redis keys are keyed solely by client IP (`ratelimit:tokenBucket:${clientId}`). A request to `/api/users` shares and depletes the same rate-limit bucket as `/api/posts`. |
| **DEF-04** | **Medium** | Reliability / Error Handling | `algorithms/*` & `rateLimiter.js` | **Masked Redis Failures**: Each algorithm catches Redis errors and returns `true`, masking outages from the middleware. The gateway cannot distinguish legitimate passes from Redis connection drops. |
| **DEF-05** | **Medium** | Memory / Security | `statsTracker.js` | **Unbounded In-Memory Map Growth**: `statsTracker` stores client stats indefinitely in a JavaScript `Map`. Without eviction or cap, this poses an unbounded memory leak under high-cardinality IP traffic. |
| **DEF-06** | **Low** | Security | `rateLimiter.js` | **Unrestricted Query Param Policy Override**: Any client can supply `?algo=...` to bypass route limits or switch algorithms at will. Needs environment-driven control or production safeguard. |
| **DEF-07** | **Low** | Observability | `server.js` | **Shallow Health Check**: `/health` returns static `{"status":"ok"}` without checking Redis connectivity or upstream service reachability. |
| **DEF-08** | **Low** | Lifecycle | `server.js` | **Missing Graceful Shutdown**: No SIGINT / SIGTERM listeners to close HTTP server or terminate Redis connection gracefully. |
| **DEF-09** | **Low** | Test Coverage | Whole Project | **Zero Automated Tests**: Project has no unit, integration, or regression test suite. |

---

## 5. Next Steps

Proceed with Phase Two through Ten to implement targeted, non-breaking bug fixes, add standard RateLimit headers, implement bounded client tracking, provide a comprehensive Node.js native test suite, and generate final validation documentation.
