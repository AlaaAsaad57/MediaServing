const Redis = require("ioredis");

let redis = null;
let redisAvailable = false;
const inMemoryLocks = new Map();

function toInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function createRedisClient() {
  const redisUrl = (process.env.REDIS_URL || "").trim();
  const commonOptions = {
    maxRetriesPerRequest: 1,
    // ALWAYS return a number. ioredis reads a non-number as "stop reconnecting
    // permanently" — it sets the client status to `end` and flushes the command
    // queue (ioredis built/redis/event_handler.js). Nothing here ever calls
    // connect() a second time, so the old `return null` after 3 tries turned one
    // brief Redis outage into a dead client for the life of the process: every
    // later command rejected with "Connection is closed.", /gated/* answered 503
    // forever, and only a container restart cleared it.
    //
    // maxRetriesPerRequest stays at 1, so during a real outage a command still
    // fails in well under a second — the routes keep failing fast (503) instead
    // of hanging. This only governs whether the client ever comes back.
    retryStrategy(times) {
      return Math.min(times * 200, 5000);
    },
    lazyConnect: true,
  };

  if (redisUrl.startsWith("redis://") || redisUrl.startsWith("rediss://")) {
    return new Redis(redisUrl, commonOptions);
  }

  return new Redis({
    host: redisUrl || "127.0.0.1",
    port: toInt(process.env.REDIS_PORT, 6379),
    username: process.env.REDIS_USERNAME,
    password: process.env.REDIS_PASS,
    tls:
      process.env.REDIS_TLS === "true" || process.env.REDIS_TLS === "1"
        ? {}
        : undefined,
    ...commonOptions,
  });
}

function initRedis() {
  try {
    redis = createRedisClient();

    redis.on("error", () => {
      redisAvailable = false;
    });

    // The flag must be able to come BACK. `error` clears it, and the connect()
    // below only ever runs once, so without this listener a single error left
    // locking in the in-memory fallback for the life of the process even after
    // Redis returned — silently, and wrongly the moment a second instance runs.
    // ioredis emits `ready` on every successful (re)connection.
    redis.on("ready", () => {
      redisAvailable = true;
    });

    redis
      .connect()
      .then(() => {
        redisAvailable = true;
      })
      .catch(() => {
        redisAvailable = false;
      });
  } catch {
    redisAvailable = false;
  }
}

async function acquireLock(key) {
  const lockKey = `lock:${key}`;

  if (redisAvailable && redis) {
    const result = await redis.set(lockKey, "1", "NX", "EX", 30);
    return result === "OK";
  }

  // In-memory fallback
  if (inMemoryLocks.has(key)) {
    return false;
  }
  inMemoryLocks.set(key, Date.now());
  return true;
}

async function releaseLock(key) {
  const lockKey = `lock:${key}`;

  if (redisAvailable && redis) {
    await redis.del(lockKey);
    return;
  }

  // In-memory fallback
  inMemoryLocks.delete(key);
}

async function waitForLock(key, maxAttempts = 20, intervalMs = 200) {
  for (let i = 0; i < maxAttempts; i++) {
    const acquired = await acquireLock(key);
    if (acquired) return true;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}

function closeRedis() {
  if (redis) {
    redis.disconnect();
  }
}

module.exports = {
  createRedisClient,
  initRedis,
  acquireLock,
  releaseLock,
  waitForLock,
  closeRedis,
};
