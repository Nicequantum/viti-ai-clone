#!/usr/bin/env node
/**
 * Build-time environment validation — runs before `next build`.
 * Fails fast when critical secrets are missing in CI/production pipelines.
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REQUIRED = ['DATABASE_URL', 'ENCRYPTION_KEY', 'SESSION_SECRET'];

function loadDotEnvFile(filename) {
  const path = resolve(process.cwd(), filename);
  if (!existsSync(path)) return;
  const content = readFileSync(path, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

loadDotEnvFile('.env');
loadDotEnvFile('.env.local');
loadDotEnvFile('.env.production');

const missing = REQUIRED.filter((key) => !process.env[key]?.trim());
if (missing.length > 0) {
  console.error(`[merlin:build] Missing required environment variables: ${missing.join(', ')}`);
  console.error('[merlin:build] Configure .env.local or your CI/CD secret store before building.');
  process.exit(1);
}

function resolveCommit() {
  if (process.env.VERCEL_GIT_COMMIT_SHA?.trim()) return process.env.VERCEL_GIT_COMMIT_SHA.trim();
  if (process.env.GIT_COMMIT?.trim()) return process.env.GIT_COMMIT.trim();
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

process.env.NEXT_PUBLIC_BUILD_COMMIT = resolveCommit();
process.env.NEXT_PUBLIC_BUILD_DATE = new Date().toISOString();

console.log(`[merlin:build] Environment OK — commit ${process.env.NEXT_PUBLIC_BUILD_COMMIT}`);