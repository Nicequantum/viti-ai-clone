import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { getBuildCommit, isMaintenanceModeEnabled, validateEnvironment } from '../../src/lib/env';

describe('environment validation', () => {
  test('detects maintenance mode values', () => {
    const prev = process.env.MERLIN_MAINTENANCE_MODE;
    process.env.MERLIN_MAINTENANCE_MODE = 'true';
    assert.equal(isMaintenanceModeEnabled(), true);
    process.env.MERLIN_MAINTENANCE_MODE = '0';
    assert.equal(isMaintenanceModeEnabled(), false);
    process.env.MERLIN_MAINTENANCE_MODE = prev;
  });

  test('reports missing required variables', () => {
    const saved = {
      DATABASE_URL: process.env.DATABASE_URL,
      ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,
      SESSION_SECRET: process.env.SESSION_SECRET,
    };
    delete process.env.DATABASE_URL;
    const result = validateEnvironment({ throwOnError: false });
    assert.ok(result.missing.includes('DATABASE_URL'));
    process.env.DATABASE_URL = saved.DATABASE_URL;
    process.env.ENCRYPTION_KEY = saved.ENCRYPTION_KEY;
    process.env.SESSION_SECRET = saved.SESSION_SECRET;
  });

  test('getBuildCommit falls back to dev', () => {
    const prev = process.env.NEXT_PUBLIC_BUILD_COMMIT;
    delete process.env.NEXT_PUBLIC_BUILD_COMMIT;
    delete process.env.VERCEL_GIT_COMMIT_SHA;
    delete process.env.GIT_COMMIT;
    assert.equal(getBuildCommit(), 'dev');
    process.env.NEXT_PUBLIC_BUILD_COMMIT = prev;
  });
});