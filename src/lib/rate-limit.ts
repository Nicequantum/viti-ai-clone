import { apiError, RATE_LIMIT_ERROR } from './errors';
import { logger } from './logger';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const memoryStore = new Map<string, RateLimitEntry>();

export interface RateLimitConfig {
  limit: number;
  windowMs: number;
}

export const RATE_LIMITS = {
  auth: { limit: 10, windowMs: 60_000 },
  upload: { limit: 30, windowMs: 60_000 },
  /** All Grok-backed routes (story, review, RO/diagnostic extract) share this ceiling. */
  generate: { limit: 20, windowMs: 60_000 },
  grok: { limit: 20, windowMs: 60_000 },
  default: { limit: 60, windowMs: 60_000 },
} as const;

function getClientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]?.trim() || 'unknown';
  return request.headers.get('x-real-ip') || 'unknown';
}

function checkMemoryRateLimit(key: string, config: RateLimitConfig): Response | null {
  const now = Date.now();
  const entry = memoryStore.get(key);

  if (!entry || now >= entry.resetAt) {
    memoryStore.set(key, { count: 1, resetAt: now + config.windowMs });
    return null;
  }

  if (entry.count >= config.limit) {
    return apiError(RATE_LIMIT_ERROR, 429);
  }

  entry.count += 1;
  return null;
}

async function checkKvRateLimit(key: string, config: RateLimitConfig): Promise<Response | null> {
  const { kv } = await import('@vercel/kv');
  const count = await kv.incr(key);

  if (count === 1) {
    await kv.expire(key, Math.max(1, Math.ceil(config.windowMs / 1000)));
  }

  if (count > config.limit) {
    return apiError(RATE_LIMIT_ERROR, 429);
  }

  return null;
}

export function isKvConfigured(): boolean {
  return Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

export async function checkRateLimit(
  request: Request,
  routeKey: string,
  config: RateLimitConfig = RATE_LIMITS.default
): Promise<Response | null> {
  const ip = getClientIp(request);
  const key = `ratelimit:${routeKey}:${ip}`;

  if (isKvConfigured()) {
    try {
      return await checkKvRateLimit(key, config);
    } catch (error) {
      logger.warn('rate_limit.kv_fallback', {
        error: error instanceof Error ? error.message : 'unknown',
      });
    }
  }

  return checkMemoryRateLimit(key, config);
}

export function getRequestIp(request: Request): string {
  return getClientIp(request);
}