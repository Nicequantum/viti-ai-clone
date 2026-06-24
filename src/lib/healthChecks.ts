import { list } from '@vercel/blob';
import { VOICE_INPUT_SETTINGS } from './constants';
import { isMaintenanceModeEnabled, validateEnvironment } from './env';
import { getExposedPublicGrokEnvKeys, getGrokApiKey } from './grokApiKey';
import { encryptPII, decryptPII } from './encryption';
import { prisma } from './db';
import { isKvConfigured } from './rate-limit';

export type DependencyStatus = 'ok' | 'warn' | 'error';

export interface DependencyCheck {
  status: DependencyStatus;
  latencyMs?: number;
  detail?: string;
}

async function timed<T>(fn: () => Promise<T>): Promise<{ result: T; latencyMs: number }> {
  const start = Date.now();
  const result = await fn();
  return { result, latencyMs: Date.now() - start };
}

export function checkEnvironmentConfig(): DependencyCheck {
  try {
    const { missing, warnings } = validateEnvironment({ throwOnError: false });
    if (missing.length > 0) {
      return {
        status: 'error',
        detail: `Missing required env: ${missing.join(', ')}`,
      };
    }
    if (warnings.length > 0) {
      return {
        status: 'warn',
        detail: warnings.join('; '),
      };
    }
    return { status: 'ok' };
  } catch (error) {
    return {
      status: 'error',
      detail: error instanceof Error ? error.message : 'environment validation failed',
    };
  }
}

export async function checkDatabase(): Promise<DependencyCheck> {
  try {
    const { latencyMs } = await timed(async () => {
      await prisma.$queryRaw`SELECT 1`;
      return true;
    });
    return { status: 'ok', latencyMs };
  } catch (error) {
    return {
      status: 'error',
      detail: error instanceof Error ? error.message : 'connection failed',
    };
  }
}

export async function checkEncryption(): Promise<DependencyCheck> {
  const key = process.env.ENCRYPTION_KEY;
  if (!key || key.length < 32) {
    return { status: 'error', detail: 'ENCRYPTION_KEY missing or too short (min 32 chars)' };
  }
  try {
    const sample = 'health-check-pii-roundtrip';
    const encrypted = encryptPII(sample);
    const decrypted = decryptPII(encrypted);
    if (decrypted !== sample) {
      return { status: 'error', detail: 'encrypt/decrypt roundtrip mismatch' };
    }
    return { status: 'ok' };
  } catch (error) {
    return {
      status: 'error',
      detail: error instanceof Error ? error.message : 'encryption check failed',
    };
  }
}

export async function checkSessionSecret(): Promise<DependencyCheck> {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    return { status: 'error', detail: 'SESSION_SECRET not configured' };
  }
  if (secret.length < 32) {
    return { status: 'warn', detail: 'SESSION_SECRET shorter than recommended 32 characters' };
  }
  return { status: 'ok' };
}

export async function checkBlobStorage(): Promise<DependencyCheck> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    return { status: 'warn', detail: 'BLOB_READ_WRITE_TOKEN not configured — image uploads disabled' };
  }
  try {
    const { latencyMs } = await timed(async () => {
      await list({ token, limit: 1 });
      return true;
    });
    return { status: 'ok', latencyMs };
  } catch (error) {
    return {
      status: 'error',
      detail: error instanceof Error ? error.message : 'blob storage unreachable',
    };
  }
}

export async function checkGrokApi(): Promise<DependencyCheck> {
  const exposedPublicKeys = getExposedPublicGrokEnvKeys();
  if (exposedPublicKeys.length > 0) {
    return {
      status: 'error',
      detail: `Remove frontend xAI env vars (${exposedPublicKeys.join(', ')}) and use server-only GROK_API_KEY`,
    };
  }

  let key: string;
  try {
    key = getGrokApiKey();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'GROK_API_KEY not configured';
    if (message.includes('not configured')) {
      return { status: 'warn', detail: 'GROK_API_KEY not configured — AI features disabled' };
    }
    return { status: 'error', detail: message };
  }

  try {
    const { latencyMs } = await timed(async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12_000);
      try {
        const response = await fetch('https://api.x.ai/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'grok-3',
            messages: [{ role: 'user', content: 'Reply with exactly: ok' }],
            max_tokens: 4,
            temperature: 0,
          }),
          signal: controller.signal,
        });

        if (response.status === 401 || response.status === 403) {
          throw new Error(`API key rejected (HTTP ${response.status})`);
        }
        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`Chat completions failed (HTTP ${response.status}): ${errText.slice(0, 120)}`);
        }

        const payload = (await response.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        const content = payload.choices?.[0]?.message?.content?.trim();
        if (!content) {
          throw new Error('Grok chat completions returned an empty response');
        }
        return true;
      } finally {
        clearTimeout(timeout);
      }
    });
    return { status: 'ok', latencyMs, detail: 'chat/completions reachable (grok-3)' };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Grok API unreachable';
    if (message.includes('aborted')) {
      return { status: 'error', detail: 'Grok API request timed out' };
    }
    return { status: 'error', detail: message };
  }
}

export async function checkAdvisorIntelligence(): Promise<DependencyCheck> {
  try {
    const { latencyMs } = await timed(async () => {
      await prisma.serviceAdvisor.count();
      await prisma.advisorWritingProfile.count();
      return true;
    });
    return { status: 'ok', latencyMs, detail: 'Advisor Intelligence schema ready' };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'schema check failed';
    if (/does not exist|relation .* not found/i.test(message)) {
      return {
        status: 'error',
        detail: 'Advisor Intelligence migration not applied — run: npx prisma migrate deploy',
      };
    }
    return { status: 'error', detail: message };
  }
}

export async function checkKvStore(): Promise<DependencyCheck> {
  if (!isKvConfigured()) {
    return {
      status: 'warn',
      detail: 'KV_REST_API_URL/TOKEN not configured — using in-memory rate limit fallback',
    };
  }
  try {
    const { latencyMs } = await timed(async () => {
      const { kv } = await import('@vercel/kv');
      const probeKey = `health:probe:${Date.now()}`;
      await kv.set(probeKey, '1', { ex: 15 });
      const value = await kv.get(probeKey);
      if (value !== '1') {
        throw new Error('KV read/write probe failed');
      }
      await kv.del(probeKey);
      return true;
    });
    return { status: 'ok', latencyMs };
  } catch (error) {
    return {
      status: 'error',
      detail: error instanceof Error ? error.message : 'KV store unreachable',
    };
  }
}

/** Voice is client-side Web Speech API — health reports config readiness, not live mic access. */
export function checkVoiceInput(): DependencyCheck {
  if (!VOICE_INPUT_SETTINGS.enabled) {
    return { status: 'warn', detail: 'Voice input disabled in dealership configuration' };
  }
  return {
    status: 'ok',
    detail: `Voice enabled (${VOICE_INPUT_SETTINGS.language}, push-to-talk default: ${VOICE_INPUT_SETTINGS.pushToTalkDefault})`,
  };
}

export function checkMaintenanceMode(): DependencyCheck {
  if (isMaintenanceModeEnabled()) {
    return { status: 'warn', detail: 'MERLIN_MAINTENANCE_MODE active — AI routes blocked' };
  }
  return { status: 'ok', detail: 'Normal operation' };
}

export async function runAllHealthChecks(): Promise<Record<string, DependencyCheck>> {
  const environment = checkEnvironmentConfig();
  const voice = checkVoiceInput();
  const maintenance = checkMaintenanceMode();
  const [database, encryption, session, blob, grok, kv, advisorIntelligence] = await Promise.all([
    checkDatabase(),
    checkEncryption(),
    checkSessionSecret(),
    checkBlobStorage(),
    checkGrokApi(),
    checkKvStore(),
    checkAdvisorIntelligence(),
  ]);

  return { environment, database, encryption, session, blob, grok, kv, voice, maintenance, advisorIntelligence };
}

export function aggregateHealthStatus(
  checks: Record<string, DependencyCheck>
): 'ok' | 'degraded' | 'error' {
  const statuses = Object.values(checks).map((c) => c.status);
  if (statuses.some((s) => s === 'error')) return 'error';
  if (statuses.some((s) => s === 'warn')) return 'degraded';
  return 'ok';
}