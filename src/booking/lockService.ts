import Redis from 'ioredis';
import { logger } from '@/config/logger';

const LOCK_TTL_MS = 10_000;
const LOCK_RETRY_DELAY_MS = 50;
const LOCK_MAX_RETRIES = 20;

let _redis: Redis | null = null;

export function getRedis(): Redis {
  if (!_redis) {
    const url = process.env.REDIS_URL ?? 'redis://localhost:6379';
    _redis = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 3 });
    _redis.on('error', err => logger.error({ err }, 'Redis error'));
  }
  return _redis;
}

export async function acquireLock(key: string, value: string): Promise<boolean> {
  const redis = getRedis();
  const result = await redis.set(`lock:${key}`, value, 'PX', LOCK_TTL_MS, 'NX');
  return result === 'OK';
}

export async function releaseLock(key: string, value: string): Promise<void> {
  const redis = getRedis();
  const script = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("del", KEYS[1])
    else
      return 0
    end
  `;
  await redis.eval(script, 1, `lock:${key}`, value);
}

export async function withLock<T>(
  key: string,
  fn: () => Promise<T>,
): Promise<T> {
  const lockValue = `${Date.now()}-${Math.random()}`;
  let acquired = false;

  for (let attempt = 0; attempt < LOCK_MAX_RETRIES; attempt++) {
    acquired = await acquireLock(key, lockValue);
    if (acquired) break;
    await new Promise(resolve => setTimeout(resolve, LOCK_RETRY_DELAY_MS));
  }

  if (!acquired) {
    throw new Error(`Could not acquire lock for key: ${key}`);
  }

  try {
    return await fn();
  } finally {
    await releaseLock(key, lockValue);
  }
}

export async function disconnectRedis(): Promise<void> {
  if (_redis) {
    await _redis.quit();
    _redis = null;
  }
}
