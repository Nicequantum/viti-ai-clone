import { prisma } from '@/lib/db';
import { getKnowledgeBaseOriginal, listLoadedKnowledgeBaseOriginals } from '@/data/knowledgeBaseOriginals';
import {
  STORY_TEMPLATE_SEEDS,
  toKnowledgeBaseFields,
  toTemplateContent,
  type StoryTemplateSeed,
} from '@/lib/storyTemplateSeed';
import type { RepairLine, RepairOrder, TemplateCategory } from '@/types';

export const GLOBAL_DEALERSHIP_ID = '__global__';

export async function seedTemplateLibraryIfEmpty(): Promise<{ templates: number; knowledgeBase: number }> {
  const [templateCount, kbCount] = await Promise.all([
    prisma.template.count(),
    prisma.knowledgeBase.count(),
  ]);

  if (templateCount > 0 && kbCount > 0) {
    return { templates: templateCount, knowledgeBase: kbCount };
  }

  for (const seed of STORY_TEMPLATE_SEEDS) {
    const content = toTemplateContent(seed);
    const kb = toKnowledgeBaseFields(seed);
    const userOriginal = getKnowledgeBaseOriginal(seed.title);

    await prisma.template.upsert({
      where: {
        dealershipId_title: { dealershipId: GLOBAL_DEALERSHIP_ID, title: seed.title },
      },
      update: { category: seed.category, content, source: 'seed' },
      create: {
        title: seed.title,
        category: seed.category,
        content,
        source: 'seed',
        dealershipId: GLOBAL_DEALERSHIP_ID,
      },
    });

    await prisma.knowledgeBase.upsert({
      where: {
        dealershipId_title: { dealershipId: GLOBAL_DEALERSHIP_ID, title: seed.title },
      },
      update: {
        category: kb.category,
        cleanTemplate: kb.cleanTemplate,
        tags: kb.tags,
        source: 'seed',
        ...(userOriginal ? { fullOriginalText: userOriginal } : {}),
      },
      create: {
        ...kb,
        source: 'seed',
        dealershipId: GLOBAL_DEALERSHIP_ID,
        ...(userOriginal ? { fullOriginalText: userOriginal } : {}),
      },
    });
  }

  return {
    templates: await prisma.template.count(),
    knowledgeBase: await prisma.knowledgeBase.count(),
  };
}

export interface TemplateRecord {
  id: string;
  title: string;
  category: TemplateCategory;
  content: string;
  source: string;
  dealershipId: string;
  useCount: number;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeBaseRecord {
  id: string;
  title: string;
  category: TemplateCategory;
  generatedText: string | null;
  fullOriginalText: string;
  cleanTemplate: string;
  tags: string[];
  source: string;
  dealershipId: string;
  createdAt: string;
  updatedAt: string;
}

export function mapTemplate(row: {
  id: string;
  title: string;
  category: string;
  content: string;
  source: string;
  dealershipId: string;
  useCount: number;
  lastUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): TemplateRecord {
  return {
    id: row.id,
    title: row.title,
    category: row.category as TemplateCategory,
    content: row.content,
    source: row.source,
    dealershipId: row.dealershipId,
    useCount: row.useCount,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function mapKnowledgeBase(row: {
  id: string;
  title: string;
  category: string;
  generatedText: string | null;
  fullOriginalText: string;
  cleanTemplate: string;
  tags: string;
  source: string;
  dealershipId: string;
  createdAt: Date;
  updatedAt: Date;
}): KnowledgeBaseRecord {
  let tags: string[] = [];
  try {
    const parsed = JSON.parse(row.tags);
    tags = Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    tags = [];
  }
  return {
    id: row.id,
    title: row.title,
    category: row.category as TemplateCategory,
    generatedText: row.generatedText,
    fullOriginalText: row.fullOriginalText,
    cleanTemplate: row.cleanTemplate,
    tags,
    source: row.source,
    dealershipId: row.dealershipId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

function scoreKnowledgeEntry(
  entry: KnowledgeBaseRecord,
  haystack: string,
  lineDescription: string
): number {
  let score = 0;
  const titleLower = entry.title.toLowerCase();
  const descLower = lineDescription.toLowerCase();

  if (entry.source === 'user') score += 8;
  if (entry.tags.includes('user-saved')) score += 4;
  if (entry.generatedText?.trim() && (entry.fullOriginalText.trim() || entry.cleanTemplate.trim())) score += 2;

  if (descLower.includes(titleLower) || titleLower.includes(descLower)) {
    score += 12;
  }

  for (const tag of entry.tags) {
    const tagLower = tag.toLowerCase();
    if (haystack.includes(tagLower)) score += 4;
    if (descLower.includes(tagLower)) score += 6;
  }

  const titleTokens = tokenize(entry.title);
  for (const token of titleTokens) {
    if (haystack.includes(token)) score += 2;
  }

  return score;
}

export function selectRelevantKnowledgeEntries(
  ro: RepairOrder,
  line: RepairLine,
  entries: KnowledgeBaseRecord[],
  dealershipId: string,
  limit = 5
): KnowledgeBaseRecord[] {
  const codes = line.extractedData?.codes?.join(' ') || '';
  const haystack = [
    line.description,
    line.customerConcern,
    line.technicianNotes,
    ro.vehicle.make,
    ro.vehicle.model,
    ...(ro.complaints || []),
    codes,
  ]
    .join(' ')
    .toLowerCase();

  const hasUsableContent = (entry: KnowledgeBaseRecord) =>
    entry.fullOriginalText.trim().length > 0 || entry.cleanTemplate.trim().length > 0;

  const scored = [...entries]
    .filter(hasUsableContent)
    .map((entry) => ({ entry, score: scoreKnowledgeEntry(entry, haystack, line.description) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  const dealershipUser = scored.filter((item) => item.entry.dealershipId === dealershipId).slice(0, 3);
  const pickedIds = new Set(dealershipUser.map((item) => item.entry.id));
  const remainder = scored.filter((item) => !pickedIds.has(item.entry.id));

  return [...dealershipUser, ...remainder].slice(0, limit).map((item) => item.entry);
}

export function formatKnowledgeBaseForPrompt(entries: KnowledgeBaseRecord[]): string {
  if (entries.length === 0) return '';

  const blocks = entries.map((entry, index) => {
    const approvedStory = entry.fullOriginalText.trim() || entry.cleanTemplate.trim();
    const lines = [
      `### Reference ${index + 1}: ${entry.title} (${entry.category}, ${entry.source})`,
      `Tags: ${entry.tags.join(', ')}`,
      '',
      'APPROVED FINAL STORY (primary style reference — mirror tone, sequencing, and technician voice):',
      approvedStory,
    ];

    if (entry.generatedText?.trim()) {
      lines.push(
        '',
        'GROK DRAFT BEFORE TECHNICIAN EDITS (shows what was refined — prefer final story phrasing, learn from edits):',
        entry.generatedText
      );
    }

    lines.push('', 'CLEAN INSERT TEMPLATE:', entry.cleanTemplate);
    return lines.join('\n');
  });

  return [
    'KNOWLEDGE BASE — GROWING DEALERSHIP WARRANTY WRITING LIBRARY',
    'These are real approved stories from this dealership. Prioritize user-saved entries when present.',
    'Mirror professional phrasing, workflow sequencing, and 3 C\'s structure.',
    'Never import codes, measurements, parts, or findings unless the same facts appear in the current repair line data.',
    'When both a Grok draft and final edited story are shown, follow the FINAL story style — the edits reflect technician-approved language.',
    '',
    ...blocks,
  ].join('\n');
}

export async function recordTemplateUsage(templateId: string, dealershipId: string): Promise<void> {
  await prisma.template.updateMany({
    where: { id: templateId, OR: [{ dealershipId }, { dealershipId: GLOBAL_DEALERSHIP_ID }] },
    data: { useCount: { increment: 1 }, lastUsedAt: new Date() },
  });
}

export function getSeedPreview(): StoryTemplateSeed[] {
  return STORY_TEMPLATE_SEEDS;
}

export { listLoadedKnowledgeBaseOriginals };