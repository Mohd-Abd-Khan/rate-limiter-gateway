import Redis from "ioredis";

const redisUrl = process.env.REDIS_URL || "redis://127.0.0.1:6379";

const redis = new Redis(redisUrl, {
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
        return Math.min(times * 200, 2000);
    },
});

redis.on("connect", () => console.log("Redis Connected"));
redis.on("error", (e) => console.error("Redis Error: ", e.message));

export default redis;