import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { KNOWLEDGE_BASE_ORIGINALS } from '@/data/knowledgeBaseOriginals';
import { STORY_TEMPLATE_SEEDS } from '@/lib/storyTemplateSeed';
import {
  formatKnowledgeBaseForPrompt,
  selectRelevantKnowledgeEntries,
  type KnowledgeBaseRecord,
} from '@/lib/templateLibrary';
import type { RepairLine, RepairOrder } from '@/types';

function kbFromSeed(title: string, fullOriginalText: string, source = 'seed'): KnowledgeBaseRecord {
  const seed = STORY_TEMPLATE_SEEDS.find((s) => s.title === title)!;
  return {
    id: `kb-${title}`,
    title: seed.title,
    category: seed.category,
    generatedText: null,
    fullOriginalText,
    cleanTemplate: seed.complaint,
    tags: seed.tags,
    source,
    dealershipId: source === 'user' ? 'dealer-1' : '__global__',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

const baseRo: RepairOrder = {
  id: 'ro-1',
  roNumber: 'R-100',
  vehicle: {
    vin: 'WDD123',
    year: '2022',
    make: 'Mercedes-Benz',
    model: 'GLE 450',
    mileageIn: '42000',
    mileageOut: '',
  },
  customer: { name: 'Test' },
  complaints: ['Blind spot warning on'],
  repairLines: [],
};

const baseLine: RepairLine = {
  id: 'line-1',
  lineNumber: 1,
  description: 'Blind Spot Assist Warning repair',
  customerConcern: 'Blind spot assist fault message',
  technicianNotes: '',
  xentryImages: [],
};

describe('story template seed data', () => {
  it('includes 3 customer pay and 22 warranty templates', () => {
    const customer = STORY_TEMPLATE_SEEDS.filter((s) => s.category === 'customer');
    const warranty = STORY_TEMPLATE_SEEDS.filter((s) => s.category === 'warranty');
    assert.equal(customer.length, 3);
    assert.equal(warranty.length, 22);
    assert.equal(STORY_TEMPLATE_SEEDS.length, 25);
  });

  it('uses unique titles', () => {
    const titles = STORY_TEMPLATE_SEEDS.map((s) => s.title);
    assert.equal(new Set(titles).size, titles.length);
  });

  it('stores user-provided blind spot original verbatim', () => {
    const original = KNOWLEDGE_BASE_ORIGINALS['Blind Spot Assist Warning'];
    assert.ok(original);
    assert.match(original!, /2023 Mercedes-Benz S-Class/);
    assert.match(original!, /multifunction camera/);
  });
});

describe('knowledge base selection', () => {
  it('ranks blind spot template for matching line description', () => {
    const entries = [
      kbFromSeed('Blind Spot Assist Warning', KNOWLEDGE_BASE_ORIGINALS['Blind Spot Assist Warning']!),
      kbFromSeed('B Service', ''),
      kbFromSeed('Cylinder Head Failure', ''),
    ];
    const selected = selectRelevantKnowledgeEntries(baseRo, baseLine, entries, 'dealer-1', 2);
    assert.equal(selected[0]?.title, 'Blind Spot Assist Warning');
  });

  it('formats knowledge base prompt with style guardrails', () => {
    const prompt = formatKnowledgeBaseForPrompt([
      kbFromSeed('Blind Spot Assist Warning', KNOWLEDGE_BASE_ORIGINALS['Blind Spot Assist Warning']!),
    ]);
    assert.match(prompt, /KNOWLEDGE BASE/);
    assert.match(prompt, /Blind Spot Assist Warning/);
    assert.match(prompt, /GROWING DEALERSHIP/i);
  });

  it('selects seed templates via cleanTemplate when fullOriginalText is empty', () => {
    const entries = [
      kbFromSeed('Blind Spot Assist Warning', ''),
      kbFromSeed('B Service', ''),
    ];
    const selected = selectRelevantKnowledgeEntries(baseRo, baseLine, entries, 'dealer-1', 3);
    assert.equal(selected[0]?.title, 'Blind Spot Assist Warning');
  });

  it('falls back to cleanTemplate in prompt when fullOriginalText is empty', () => {
    const seed = STORY_TEMPLATE_SEEDS.find((s) => s.title === 'B Service')!;
    const prompt = formatKnowledgeBaseForPrompt([
      {
        ...kbFromSeed('B Service', ''),
        cleanTemplate: seed.complaint,
      },
    ]);
    assert.match(prompt, /B Service/);
    assert.ok(prompt.includes(seed.complaint));
  });
});

describe('template tags', () => {
  it('builds tags from title and story content', async () => {
    const { buildTemplateTags } = await import('@/lib/templateTags');
    const tags = buildTemplateTags({
      title: 'Blind Spot Assist Warning',
      category: 'warranty',
      finalText: 'Customer reported blind spot assist warning on 2023 S-Class. XENTRY quick test performed.',
      lineDescription: 'Blind Spot Assist Warning repair',
      vehicleMake: 'Mercedes-Benz',
      vehicleModel: 'S-Class',
      codes: ['U0122'],
    });
    assert.ok(tags.includes('warranty'));
    assert.ok(tags.includes('user-saved'));
    assert.ok(tags.some((t) => t.includes('blind') || t.includes('spot')));
  });
});