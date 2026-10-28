import redis from "../config/redisClient.js";

const script = `
    local now = tonumber(ARGV[1])
    local windowSize = tonumber(ARGV[2])
    local limit = tonumber(ARGV[3])

    local currentWindowStart = math.floor(now / windowSize) * windowSize
    local currKey = KEYS[1] .. ":" .. currentWindowStart
    local prevKey = KEYS[1] .. ":" .. (currentWindowStart - windowSize)

    local currCount = tonumber(redis.call("GET", currKey)) or 0
    local prevCount = tonumber(redis.call("GET", prevKey)) or 0

    local elapsed = now - currentWindowStart
    local estimatedCount = prevCount * (1 - (elapsed / windowSize)) + currCount
    local reset = math.max(1, math.ceil(windowSize - elapsed))

    if estimatedCount < limit then
        redis.call("INCR", currKey)
        redis.call("EXPIRE", currKey, math.ceil(windowSize * 2))
        local remaining = math.max(0, math.floor(limit - (estimatedCount + 1)))
        return {1, remaining, reset}
    end

    return {0, 0, reset}
`;

export const isAllowed = async (clientId, limit, windowSize, route = "") => {
    const key = route
        ? `ratelimit:slidingWindowCounter:${clientId}:${route}`
        : `ratelimit:slidingWindowCounter:${clientId}`;
    const now = Date.now() / 1000;

    const [allowed, remaining, reset] = await redis.eval(
        script,
        1,
        key,
        now,
        windowSize,
        limit
    );

    return {
        allowed: allowed === 1,
        remaining: Number(remaining),
        reset: Number(reset)
    };
};