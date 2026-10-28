import redis from "../config/redisClient.js";

const script = `
    local key = KEYS[1]
    local now = tonumber(ARGV[1])
    local capacity = tonumber(ARGV[2])
    local leakRate = tonumber(ARGV[3])

    local data = redis.call("HMGET", key, "queue", "lastLeakTime")
    local queue = tonumber(data[1])
    local lastLeakTime = tonumber(data[2])

    if queue == nil then
        queue = 0
        lastLeakTime = now
    end

    local elapsed = math.max(0, now - lastLeakTime)
    local leaked = elapsed * leakRate
    queue = math.max(0, queue - leaked)
    lastLeakTime = now

    local allowed = 0
    if queue + 1 <= capacity then
        queue = queue + 1
        allowed = 1
    end

    redis.call("HSET", key, "queue", tostring(queue), "lastLeakTime", tostring(lastLeakTime))
    redis.call("EXPIRE", key, 3600)

    local remaining = math.max(0, math.floor(capacity - queue))
    local reset = 0
    if allowed == 0 and leakRate > 0 then
        reset = math.max(1, math.ceil((queue - capacity + 1) / leakRate))
    end

    return {allowed, remaining, reset}
`;

export const isAllowed = async (clientId, capacity, leakRate, route = "") => {
    const key = route
        ? `ratelimit:leakyBucket:${clientId}:${route}`
        : `ratelimit:leakyBucket:${clientId}`;
    const now = Date.now() / 1000;

    const [allowed, remaining, reset] = await redis.eval(
        script,
        1,
        key,
        now,
        capacity,
        leakRate
    );

    return {
        allowed: allowed === 1,
        remaining: Number(remaining),
        reset: Number(reset)
    };
};