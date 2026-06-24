/**
 * Centralized environment validation for Merlin.
 * Called at Node startup (instrumentation) and before production builds (scripts/validate-env.mjs).
 */

const REQUIRED_ENV_VARS = ['DATABASE_URL', 'ENCRYPTION_KEY', 'SESSION_SECRET'] as const;

const RECOMMENDED_ENV_VARS = ['GROK_API_KEY', 'BLOB_READ_WRITE_TOKEN'] as const;

/** H8: KV required in production for distributed rate limiting across serverless instances. */
const PRODUCTION_REQUIRED_ENV_VARS = ['KV_REST_API_URL', 'KV_REST_API_TOKEN'] as const;

export interface EnvironmentValidationResult {
  missing: string[];
  warnings: string[];
  valid: boolean;
}

export interface RuntimeConfig {
  appVersion: string;
  promptVersion: string;
  buildCommit: string;
  buildDate: string;
  maintenanceMode: boolean;
  nodeEnv: string;
}

function isTruthyEnv(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

/** True when MERLIN_MAINTENANCE_MODE is enabled — blocks AI routes and shows maintenance UI. */
export function isMaintenanceModeEnabled(): boolean {
  return isTruthyEnv(process.env.MERLIN_MAINTENANCE_MODE);
}

export function getBuildCommit(): string {
  return (
    process.env.NEXT_PUBLIC_BUILD_COMMIT?.trim() ||
    process.env.VERCEL_GIT_COMMIT_SHA?.trim() ||
    process.env.GIT_COMMIT?.trim() ||
    'dev'
  );
}

export function getBuildDate(): string {
  return process.env.NEXT_PUBLIC_BUILD_DATE?.trim() || new Date().toISOString();
}

export function getAppVersion(): string {
  return process.env.npm_package_version || '3.0.1';
}

export function validateEnvironment(options: { throwOnError?: boolean; production?: boolean } = {}): EnvironmentValidationResult {
  const missing: string[] = [];
  const warnings: string[] = [];
  const isProduction = options.production ?? process.env.NODE_ENV === 'production';

  for (const key of REQUIRED_ENV_VARS) {
    if (!process.env[key]?.trim()) {
      missing.push(key);
    }
  }

  const encryptionKey = process.env.ENCRYPTION_KEY?.trim();
  if (encryptionKey) {
    if (encryptionKey.length < 32) {
      warnings.push('ENCRYPTION_KEY is shorter than 32 characters');
    }
    if (!/^[0-9a-fA-F]{64}$/.test(encryptionKey)) {
      warnings.push('ENCRYPTION_KEY should be 64 hex characters (openssl rand -hex 32)');
    }
  }

  const sessionSecret = process.env.SESSION_SECRET?.trim();
  if (sessionSecret && sessionSecret.length < 32) {
    warnings.push('SESSION_SECRET is shorter than the recommended 32 characters');
  }

  for (const key of RECOMMENDED_ENV_VARS) {
    if (!process.env[key]?.trim()) {
      warnings.push(`${key} not configured`);
    }
  }

  if (isProduction) {
    for (const key of PRODUCTION_REQUIRED_ENV_VARS) {
      if (!process.env[key]?.trim()) {
        missing.push(key);
      }
    }
  } else if (!process.env.KV_REST_API_URL?.trim() || !process.env.KV_REST_API_TOKEN?.trim()) {
    warnings.push('KV_REST_API_URL/KV_REST_API_TOKEN not configured — distributed rate limiting disabled');
  }

  if (isTruthyEnv(process.env.NEXT_PUBLIC_GROK_API_KEY) || isTruthyEnv(process.env.NEXT_PUBLIC_XAI_API_KEY)) {
    warnings.push('Remove NEXT_PUBLIC_* xAI keys — use server-only GROK_API_KEY');
  }

  const valid = missing.length === 0;

  if (!valid) {
    const message = `Missing required environment variables: ${missing.join(', ')}`;
    console.error(`[merlin:env] ${message}`);
    if (options.throwOnError) {
      throw new Error(message);
    }
  }

  for (const warning of warnings) {
    console.warn(`[merlin:env] ${warning}`);
  }

  return { missing, warnings, valid };
}

/** Stricter validation used by `npm run build` — fails on missing required vars. */
export function validateBuildEnvironment(): EnvironmentValidationResult {
  return validateEnvironment({ throwOnError: true, production: true });
}

/** Snapshot of non-secret runtime configuration for health/status endpoints. */
export function getRuntimeConfig(promptVersion: string): RuntimeConfig {
  return {
    appVersion: getAppVersion(),
    promptVersion,
    buildCommit: getBuildCommit(),
    buildDate: getBuildDate(),
    maintenanceMode: isMaintenanceModeEnabled(),
    nodeEnv: process.env.NODE_ENV || 'development',
  };
}