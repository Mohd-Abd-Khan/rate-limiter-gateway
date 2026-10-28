# Bug Fix Report — Rate Limiter Gateway

**Date:** 2026-10-28  
**Project:** Rate Limiter Gateway  
**Auditor:** Senior Backend & Application Security Engineer  

---

## 1. Summary of Resolved Defects

All confirmed defects discovered during the architecture and security audit have been systematically resolved, verified with regression tests, and audited for zero regression.

| Defect ID | Severity | Component | Issue | Fix Summary | Regression Test |
|---|---|---|---|---|---|
| **DEF-01** | **High** | `slidingWindowLog.js` | Member collision in Redis Sorted Set under concurrency | Added unique member suffix `${now}:${crypto.randomBytes(4).toString("hex")}` and dynamic reset calculation from oldest active log entry | `tests/algorithms.test.js` ("handles concurrent requests without member collision") |
| **DEF-02** | **High** | `rateLimiter.js` | `ROUTE_ALGO_MAP` never matched due to Express route prefix stripping | Reconstructed full path (`req.baseUrl + req.path`) before matching route table | `tests/gateway.test.js` ("correctly resolves ROUTE_ALGO_MAP") |
| **DEF-03** | **Medium** | All Algorithms | Missing route-level key isolation; one route exhausted quota for all other routes | Integrated sanitized route key into Redis keys (`ratelimit:<algo>:<clientId>:<routeKey>`) | `tests/algorithms.test.js` ("enforces route isolation") |
| **DEF-04** | **Medium** | Algorithms & `rateLimiter.js` | Silent swallowing of Redis failures; no distinction between allowed requests and cache outages | Propagated Redis errors to middleware; injected `X-RateLimit-Degraded: true` header; supported explicit fail-open/fail-closed policy | `src/middleware/rateLimiter.js` |
| **DEF-05** | **Medium** | `statsTracker.js` | Unbounded memory growth (DoS risk under high client IP cardinality) | Implemented LRU/size-capped eviction at 10,000 entries; corrected `cleintStats` typo; exported `resetStats()` | `tests/gateway.test.js` ("GET /stats reports tracked requests") |
| **DEF-06** | **Low** | `rateLimiter.js` | Unrestricted query parameter policy override (`?algo=...`) | Added strict whitelist validation (`VALID_ALGORITHMS`) returning HTTP 400 on invalid input, and added `ALLOW_QUERY_OVERRIDE` control | `tests/gateway.test.js` ("returns HTTP 400 for invalid algo") |
| **DEF-07** | **Low** | `server.js` | Shallow health check; returned static `status: ok` without verifying Redis | Upgraded `/health` to execute live `redis.ping()` and report dependency health with HTTP 200/503 | `tests/gateway.test.js` ("GET /health returns 200 with Redis dependency status") |
| **DEF-08** | **Low** | `server.js` | Missing graceful shutdown; left open sockets on process termination | Added SIGINT and SIGTERM handlers to close HTTP server and Redis connection cleanly | `server.js` |
| **DEF-09** | **Medium** | Whole Project | Zero automated tests in repository | Created 15 automated test suites covering algorithms, gateway middleware, and reverse proxy forwarding | `npm test` (15 passing tests) |
| **DEF-10** | **High** | `leakyBucket.js` | Queue admitting overflow due to checking `queue < capacity` instead of `queue + 1 <= capacity` | Changed admission check to require 1 whole unit of capacity (`queue + 1 <= capacity`), preventing fractional-second overflow | `tests/algorithms.test.js` ("queues requests up to capacity and rejects overflow") |
| **SEC-01** | **Critical/High** | Dependencies | Vulnerabilities in `proxy-addr`, `body-parser`, and `qs` | Executed semver-safe `npm audit fix` updating subdependencies to secure patch versions | `npm audit` (0 vulnerabilities) |

---

## 2. Detailed Root Cause Analysis & Implementations

### DEF-01: Sorted Set Member Collision in Sliding Window Log
- **Root Cause**: The Lua script executed `redis.call("ZADD", KEYS[1], now, now)`. When multiple requests arrived within the same millisecond or second, the member string `now` collided with existing members. Because Redis Sorted Set members are unique, Redis updated the score rather than adding a new element, causing `ZCARD` to severely undercount requests.
- **Fix**: Replaced with `ZADD KEYS[1] now (now .. ":" .. randomHex)`. The score maintains exact time ordering for `ZREMRANGEBYSCORE`, while the member remains distinct.

### DEF-02: Route-to-Algorithm Mapping Failure
- **Root Cause**: Express strips the mount prefix `/api` when delegating to sub-middlewares mounted via `app.use("/api", ...)`. In `rateLimiter.js`, `req.path` evaluated to `/users` instead of `/api/users`. Looking up `ROUTE_ALGO_MAP["/users"]` returned `undefined`, causing the gateway to always fall back to `DEFAULT_ALGO`.
- **Fix**: Reconstructed `fullPath = req.baseUrl ? (req.baseUrl + req.path) : req.path` and normalized trailing slashes before route table lookup.

### DEF-03: Route-Level Key Isolation
- **Root Cause**: Keys were formatted as `ratelimit:<algo>:<clientId>`. If a user made 10 requests to `/api/users`, their quota on `/api/posts` was immediately depleted.
- **Fix**: Appended sanitized route identifier: `ratelimit:<algo>:<clientId>:<routeKey>`. Configurable via `ENABLE_ROUTE_ISOLATION`.

### DEF-10: Leaky Bucket Queue Overflow Defect
- **Root Cause**: The original Lua script checked `if queue < capacity then queue = queue + 1`. Because elapsed time calculation leaks continuously (`queue = math.max(0, queue - elapsed * leakRate)`), even a 2ms gap reduced `queue` from 3 to 2.998. The condition `2.998 < 3` was true, admitting another request and pushing the queue to 3.998, violating the maximum capacity ceiling.
- **Fix**: Require one full unit of capacity: `if queue + 1 <= capacity then queue = queue + 1`.
