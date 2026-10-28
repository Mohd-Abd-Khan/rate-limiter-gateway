export const ALGO_TYPE = "tokenBucket";
export const limit = 10;
export const capacity = 5;
export const windowSize = 10;
export const refillRate = 1;

export const ROUTE_ALGO_MAP = {
  "/api/posts": "tokenBucket",
  "/api/users": "fixedWindow",
};

export const DEFAULT_ALGO = "tokenBucket";

export const VALID_ALGORITHMS = [
  "fixedWindow",
  "slidingLog",
  "slidingCounter",
  "tokenBucket",
  "leakyBucket"
];

// Query parameter override can be controlled via environment variable (default: true for dev/demo)
export const ALLOW_QUERY_OVERRIDE = process.env.ALLOW_QUERY_OVERRIDE !== "false";

// Enable route-level key isolation so /api/users does not drain /api/posts quota
export const ENABLE_ROUTE_ISOLATION = process.env.ENABLE_ROUTE_ISOLATION !== "false";

// Rate limiting failure policy when Redis is unavailable: true = fail-open, false = fail-closed
export const RATE_LIMIT_FAIL_OPEN = process.env.RATE_LIMIT_FAIL_OPEN !== "false";