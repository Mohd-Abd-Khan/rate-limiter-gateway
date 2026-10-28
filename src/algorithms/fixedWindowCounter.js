import redis from "../config/redisClient.js";

const script = `
    local count = redis.call("INCR", KEYS[1])
    if count == 1 then
        redis.call("EXPIRE", KEYS[1], ARGV[1])
    end
    local ttl = redis.call("TTL", KEYS[1])
    return {count, ttl}
`;

export const isAllowed = async (clientId, limit, windowSize, route = "") => {
    const key = route
        ? `ratelimit:fixedWindow:${clientId}:${route}`
        : `ratelimit:fixedWindow:${clientId}`;

    const [count, ttl] = await redis.eval(script, 1, key, windowSize);
    const numericCount = Number(count);
    const numericTtl = Number(ttl);
    const allowed = numericCount <= limit;
    const remaining = Math.max(0, limit - numericCount);
    const reset = numericTtl > 0 ? numericTtl : Number(windowSize);

    return {
        allowed,
        remaining,
        reset,
        total: numericCount
    };
};