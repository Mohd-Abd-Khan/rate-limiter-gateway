import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import redis from "../src/config/redisClient.js";

import { isAllowed as fixedWindow } from "../src/algorithms/fixedWindowCounter.js";
import { isAllowed as slidingLog } from "../src/algorithms/slidingWindowLog.js";
import { isAllowed as slidingCounter } from "../src/algorithms/slidingWindowCounter.js";
import { isAllowed as tokenBucket } from "../src/algorithms/tokenBucket.js";
import { isAllowed as leakyBucket } from "../src/algorithms/leakyBucket.js";

const TEST_CLIENT = `test-client-${Date.now()}`;

describe("Rate Limiting Algorithms (Isolated Redis Tests)", () => {
    const testKeys = [];

    after(async () => {
        // Clean up only dedicated test keys
        if (testKeys.length > 0) {
            await redis.del(...testKeys);
        }
        try {
            await redis.quit();
        } catch {
            redis.disconnect();
        }
    });

    describe("Fixed Window Counter", () => {
        it("allows requests up to limit and blocks subsequent requests", async () => {
            const clientId = `${TEST_CLIENT}-fixed`;
            const route = "test_route";
            testKeys.push(`ratelimit:fixedWindow:${clientId}:${route}`);

            const limit = 3;
            const windowSize = 5;

            const res1 = await fixedWindow(clientId, limit, windowSize, route);
            assert.equal(res1.allowed, true);
            assert.equal(res1.remaining, 2);

            const res2 = await fixedWindow(clientId, limit, windowSize, route);
            assert.equal(res2.allowed, true);
            assert.equal(res2.remaining, 1);

            const res3 = await fixedWindow(clientId, limit, windowSize, route);
            assert.equal(res3.allowed, true);
            assert.equal(res3.remaining, 0);

            // 4th request exceeds limit
            const res4 = await fixedWindow(clientId, limit, windowSize, route);
            assert.equal(res4.allowed, false);
            assert.equal(res4.remaining, 0);
            assert.ok(res4.reset > 0 && res4.reset <= windowSize);
        });

        it("enforces route isolation so different routes do not exhaust each other", async () => {
            const clientId = `${TEST_CLIENT}-fixed-iso`;
            const routeA = "users";
            const routeB = "posts";
            testKeys.push(`ratelimit:fixedWindow:${clientId}:${routeA}`);
            testKeys.push(`ratelimit:fixedWindow:${clientId}:${routeB}`);

            const limit = 2;
            const windowSize = 5;

            // Exhaust routeA
            await fixedWindow(clientId, limit, windowSize, routeA);
            await fixedWindow(clientId, limit, windowSize, routeA);
            const blockedA = await fixedWindow(clientId, limit, windowSize, routeA);
            assert.equal(blockedA.allowed, false);

            // routeB should still have full quota
            const allowedB = await fixedWindow(clientId, limit, windowSize, routeB);
            assert.equal(allowedB.allowed, true);
            assert.equal(allowedB.remaining, 1);
        });
    });

    describe("Sliding Window Log (DEF-01 Collision Fix)", () => {
        it("handles concurrent requests without member collision or undercounting", async () => {
            const clientId = `${TEST_CLIENT}-sliding-log-col`;
            const route = "test_log";
            testKeys.push(`ratelimit:slidingWindowLog:${clientId}:${route}`);

            const limit = 5;
            const windowSize = 10;

            // Fire 10 simultaneous requests to test concurrency with identical timestamps
            const promises = Array.from({ length: 10 }, () =>
                slidingLog(clientId, limit, windowSize, route)
            );
            const results = await Promise.all(promises);

            const allowedCount = results.filter((r) => r.allowed).length;
            const blockedCount = results.filter((r) => !r.allowed).length;

            assert.equal(allowedCount, limit, `Expected exactly ${limit} allowed requests`);
            assert.equal(blockedCount, 5, "Expected 5 blocked requests");
        });
    });

    describe("Sliding Window Counter", () => {
        it("correctly calculates weighted count and restricts requests over limit", async () => {
            const clientId = `${TEST_CLIENT}-sliding-counter`;
            const route = "test_sc";

            const limit = 3;
            const windowSize = 10;

            const res1 = await slidingCounter(clientId, limit, windowSize, route);
            assert.equal(res1.allowed, true);

            const res2 = await slidingCounter(clientId, limit, windowSize, route);
            assert.equal(res2.allowed, true);

            const res3 = await slidingCounter(clientId, limit, windowSize, route);
            assert.equal(res3.allowed, true);

            const res4 = await slidingCounter(clientId, limit, windowSize, route);
            assert.equal(res4.allowed, false);
            assert.ok(res4.reset > 0);
        });
    });

    describe("Token Bucket", () => {
        it("allows burst up to capacity and throttles when empty", async () => {
            const clientId = `${TEST_CLIENT}-token-bucket`;
            const route = "test_tb";
            testKeys.push(`ratelimit:tokenBucket:${clientId}:${route}`);

            const capacity = 3;
            const refillRate = 0.5; // 1 token every 2 seconds

            const res1 = await tokenBucket(clientId, capacity, refillRate, route);
            assert.equal(res1.allowed, true);
            assert.equal(res1.remaining, 2);

            const res2 = await tokenBucket(clientId, capacity, refillRate, route);
            assert.equal(res2.allowed, true);
            assert.equal(res2.remaining, 1);

            const res3 = await tokenBucket(clientId, capacity, refillRate, route);
            assert.equal(res3.allowed, true);
            assert.equal(res3.remaining, 0);

            // Bucket empty
            const res4 = await tokenBucket(clientId, capacity, refillRate, route);
            assert.equal(res4.allowed, false);
            assert.ok(res4.reset >= 1);
        });
    });

    describe("Leaky Bucket", () => {
        it("queues requests up to capacity and rejects overflow", async () => {
            const clientId = `${TEST_CLIENT}-leaky-bucket`;
            const route = "test_lb";
            testKeys.push(`ratelimit:leakyBucket:${clientId}:${route}`);

            const capacity = 3;
            const leakRate = 1;

            const res1 = await leakyBucket(clientId, capacity, leakRate, route);
            assert.equal(res1.allowed, true);
            assert.equal(res1.remaining, 2);

            const res2 = await leakyBucket(clientId, capacity, leakRate, route);
            assert.equal(res2.allowed, true);
            assert.equal(res2.remaining, 1);

            const res3 = await leakyBucket(clientId, capacity, leakRate, route);
            assert.equal(res3.allowed, true);
            assert.equal(res3.remaining, 0);

            // Capacity reached - overflow
            const res4 = await leakyBucket(clientId, capacity, leakRate, route);
            assert.equal(res4.allowed, false);
        });
    });
});
