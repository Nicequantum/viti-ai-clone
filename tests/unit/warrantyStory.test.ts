import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  STORY_TEMPLATES,
  SYSTEM_PROMPT,
  WARRANTY_STORY_MAX_TOKENS,
  WARRANTY_WORKFLOW_STEPS,
  buildWarrantyStoryUserMessage,
} from '../../src/prompts/warrantyStory';
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
  technicianNotes: 'Found P0300. Source voltage 12.4V. Performed guided test on cylinder 3.',
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

describe('warranty story prompts', () => {
  test('SYSTEM_PROMPT uses compact generation rules (style variation in user message)', () => {
    assert.match(SYSTEM_PROMPT, /Merlin/i);
    assert.match(SYSTEM_PROMPT, /MI 2\.0/i);
    assert.match(SYSTEM_PROMPT, /flowing paragraphs|natural prose/i);
    assert.match(SYSTEM_PROMPT, /no visible headings/i);
    assert.match(SYSTEM_PROMPT, /Quick Test/i);
    assert.match(SYSTEM_PROMPT, /10 workflow steps/i);
    assert.match(SYSTEM_PROMPT, /\[NOT DOCUMENTED\]/);
    assert.match(SYSTEM_PROMPT, /style variation arrives in the user message/i);
    assert.doesNotMatch(SYSTEM_PROMPT, /NATURAL STYLE VARIATION \(CRITICAL/i);
  });

  test('WARRANTY_WORKFLOW_STEPS lists all 10 billing/audit steps in order', () => {
    assert.equal(WARRANTY_WORKFLOW_STEPS.length, 10);
    assert.match(WARRANTY_WORKFLOW_STEPS[0], /Initial test drive/i);
    assert.match(WARRANTY_WORKFLOW_STEPS[9], /Final verification test drive/i);
  });

  test('STORY_TEMPLATES reference diagnostic workflow elements', () => {
    assert.ok(STORY_TEMPLATES.length >= 5);
    for (const template of STORY_TEMPLATES) {
      assert.match(template, /workflow|drive|Quick Test|voltage|XENTRY|guided test|verification|complaint/i);
    }
  });

  test('buildWarrantyStoryUserMessage injects workflow checklist, natural format, and style variation', () => {
    const message = buildWarrantyStoryUserMessage(baseRo, baseLine, '', 0);
    assert.match(message, /Required workflow/i);
    assert.match(message, /Initial test drive to confirm\/reproduce/i);
    assert.match(message, /Disconnect battery charger and XENTRY/i);
    assert.match(message, /natural paragraph form/i);
    assert.match(message, /no visible headings/i);
    assert.match(message, /28450 → 28458/);
    assert.match(message, /P0300/);
    assert.match(message, /Chronological narrative/);
    assert.match(message, /Style variation for THIS story/i);
    assert.match(message, /Sentence rhythm:/i);
    assert.match(message, /Technical detail emphasis:/i);
    assert.match(message, /Transitional phrasing:/i);
  });

  test('buildWarrantyStoryUserMessage selects template by index', () => {
    const explicit = buildWarrantyStoryUserMessage(baseRo, baseLine, '', 2);
    assert.match(explicit, /Concise audit record/);
  });

  test('WARRANTY_STORY_MAX_TOKENS limits generation output', () => {
    assert.equal(WARRANTY_STORY_MAX_TOKENS, 550);
  });
});