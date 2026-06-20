import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { DAILY_USAGE_LIMIT } from '../../src/lib/usageMonitoring';

describe('usage monitoring constants', () => {
  test('enforces 50 requests per technician per day', () => {
    assert.equal(DAILY_USAGE_LIMIT, 50);
  });
});