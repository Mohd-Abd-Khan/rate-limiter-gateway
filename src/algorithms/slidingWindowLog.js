import crypto from "crypto";
import redis from "../config/redisClient.js";

const script = `
    local now = tonumber(ARGV[1])
    local windowSize = tonumber(ARGV[2])
    local limit = tonumber(ARGV[3])
    local member = ARGV[4]
    local windowStart = now - windowSize

    redis.call("ZREMRANGEBYSCORE", KEYS[1], 0, windowStart)

    local count = redis.call("ZCARD", KEYS[1])

    if count < limit then
        redis.call("ZADD", KEYS[1], now, member)
        redis.call("EXPIRE", KEYS[1], math.ceil(windowSize))
        local remaining = limit - (count + 1)
        return {1, remaining, math.ceil(windowSize)}
    end

    local oldest = redis.call("ZRANGE", KEYS[1], 0, 0, "WITHSCORES")
    local reset = math.ceil(windowSize)
    if oldest and oldest[2] then
        local oldestScore = tonumber(oldest[2])
        reset = math.max(1, math.ceil((oldestScore + windowSize) - now))
    end

    return {0, 0, reset}
`;

export const isAllowed = async (clientId, limit, windowSize, route = "") => {
    const key = route
        ? `ratelimit:slidingWindowLog:${clientId}:${route}`
        : `ratelimit:slidingWindowLog:${clientId}`;
    const now = Date.now() / 1000;
    const uniqueMember = `${now}:${crypto.randomBytes(4).toString("hex")}`;

    const [allowed, remaining, reset] = await redis.eval(
        script,
        1,
        key,
        now,
        windowSize,
        limit,
        uniqueMember
    );

    return {
        allowed: allowed === 1,
        remaining: Number(remaining),
        reset: Number(reset)
    };
};