import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { STORY_GENERATION_PHASES } from '../../src/hooks/useStoryGenerationPhase';
import {
  WARRANTY_STORY_MAX_TOKENS,
  WARRANTY_STORY_TEMPERATURE,
  buildWarrantyStoryUserMessage,
} from '../../src/prompts/warrantyStory';
import { STORY_SCORE_SYSTEM_PROMPT } from '../../src/prompts/storyQuality';
import type { RepairLine, RepairOrder } from '../../src/types';

const baseRo: RepairOrder = {
  id: 'ro-1',
  roNumber: '482910',
  vehicle: {
    vin: 'W1N4N4HB5NJ123456',
    year: '2022',
    make: 'Mercedes-Benz',
    model: 'GLE 350',
    mileageIn: '28450',
    mileageOut: '28458',
  },
  customer: { name: 'John Smith' },
  complaints: ['# A CHECK ENGINE LIGHT ON'],
  repairLines: [],
};

const baseLine: RepairLine = {
  id: 'line-1',
  lineNumber: 1,
  description: 'Engine diagnosis',
  customerConcern: 'CHECK ENGINE LIGHT ON',
  technicianNotes: 'Found P0300. Source voltage 12.4V.',
  xentryImages: [],
  extractedData: {
    codes: ['P0300'],
    faultCodes: [{ code: 'P0300', description: 'Random/multiple cylinder misfire detected' }],
    guidedTests: ['Cylinder 3 misfire count elevated'],
    measurements: [{ label: 'Source voltage', value: '12.4V' }],
    components: [],
    circuits: [],
  },
};

describe('story generation performance settings', () => {
  test('uses grok-4.3 with reasoning disabled for latency', () => {
    const grokSrc = readFileSync(join(process.cwd(), 'src/lib/grok.ts'), 'utf8');
    assert.match(grokSrc, /GROK_CHAT_MODEL = 'grok-4\.3'/);
    assert.match(grokSrc, /WARRANTY_STORY_SCORE_MAX_TOKENS = 650/);
    assert.match(grokSrc, /reasoning_effort: reasoningEffort/);
    assert.match(grokSrc, /reasoningEffort: 'none'/);
  });

  test('caps generation and score output tokens', () => {
    assert.equal(WARRANTY_STORY_MAX_TOKENS, 550);
    assert.ok(WARRANTY_STORY_TEMPERATURE <= 0.25);
  });

  test('user prompt truncates oversized history context', () => {
    const compact = buildWarrantyStoryUserMessage(baseRo, baseLine, '', 0);
    const withHistory = buildWarrantyStoryUserMessage(baseRo, baseLine, 'x'.repeat(4_000), 0);
    assert.ok(compact.length < 2_800);
    assert.match(withHistory, /Style reference/);
    assert.match(withHistory, /truncated/);
    assert.ok(!withHistory.includes('x'.repeat(1_000)));
  });

  test('score system prompt uses compact MI criteria', () => {
    assert.match(STORY_SCORE_SYSTEM_PROMPT, /MI 2\.0 scoring/i);
    assert.ok(STORY_SCORE_SYSTEM_PROMPT.length < 1_800);
  });

  test('generation phase messages cover story writing only', () => {
    assert.equal(STORY_GENERATION_PHASES.length, 3);
    assert.match(STORY_GENERATION_PHASES[0], /Thinking/i);
    assert.match(STORY_GENERATION_PHASES[2], /Polishing/i);
  });
});