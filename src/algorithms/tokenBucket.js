import redis from "../config/redisClient.js";

const script = `
    local key = KEYS[1]
    local now = tonumber(ARGV[1])
    local totalTokens = tonumber(ARGV[2])
    local refillRate = tonumber(ARGV[3])

    local data = redis.call("HMGET", key, "tokens", "lastRefillTime")
    local tokens = tonumber(data[1])
    local lastRefillTime = tonumber(data[2])

    if tokens == nil then
        tokens = totalTokens
        lastRefillTime = now
    end

    local elapsed = math.max(0, now - lastRefillTime)
    local refill = elapsed * refillRate
    tokens = math.min(totalTokens, tokens + refill)
    lastRefillTime = now

    local allowed = 0
    if tokens >= 1 then
        tokens = tokens - 1
        allowed = 1
    end

    redis.call("HSET", key, "tokens", tostring(tokens), "lastRefillTime", tostring(lastRefillTime))
    redis.call("EXPIRE", key, 3600)

    local remaining = math.floor(tokens)
    local reset = 0
    if allowed == 0 and refillRate > 0 then
        reset = math.max(1, math.ceil((1 - tokens) / refillRate))
    end

    return {allowed, remaining, reset}
`;

export const isAllowed = async (clientId, totalTokens, refillRate, route = "") => {
    const key = route
        ? `ratelimit:tokenBucket:${clientId}:${route}`
        : `ratelimit:tokenBucket:${clientId}`;
    const now = Date.now() / 1000;

    const [allowed, remaining, reset] = await redis.eval(
        script,
        1,
        key,
        now,
        totalTokens,
        refillRate
    );

    return {
        allowed: allowed === 1,
        remaining: Number(remaining),
        reset: Number(reset)
    };
};