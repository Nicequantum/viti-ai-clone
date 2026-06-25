import 'server-only';

import { getGrokApiKey } from '@/lib/grokApiKey';
import { DIAGNOSTIC_EXTRACTION_PROMPT } from '@/prompts/diagnosticExtraction';
import { RO_EXTRACTION_PROMPT } from '@/prompts/roExtraction';
import {
  STORY_REVIEW_SYSTEM_PROMPT,
  STORY_SCORE_SYSTEM_PROMPT,
  buildStoryReviewUserMessage,
  buildStoryScoreUserMessage,
  parseStoryQualityResponse,
  parseStoryReviewResponse,
  type StoryQualityResult,
  type StoryReviewResult,
} from '@/prompts/storyQuality';
import { PROMPT_VERSION } from '@/prompts/version';
import {
  SYSTEM_PROMPT,
  WARRANTY_STORY_TEMPERATURE,
  buildWarrantyStoryUserMessage,
} from '@/prompts/warrantyStory';

export { PROMPT_VERSION };
import type { ExtractedData, RepairLine, RepairOrder } from '@/types';
import { normalizeExtractedData, parseDiagnosticExtractionJson } from '@/utils/diagnosticParser';
import { logPerformance } from '@/lib/perf';
import { DIAGNOSTIC_EXTRACT_GROK_MS, RO_EXTRACT_GROK_MS } from '@/lib/timeouts';
import { parseStructuredROText } from '@/utils/roExtractor';

const GROK_API_URL = 'https://api.x.ai/v1/chat/completions';

/** xAI chat model — Grok 4.3 for story generation, scoring, and vision extraction. */
export const GROK_CHAT_MODEL = 'grok-4.3';

export function isGrokConfigured(): boolean {
  try {
    getGrokApiKey();
    return true;
  } catch {
    return false;
  }
}

async function grokChat(
  messages: Array<{
    role: string;
    content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
  }>,
  options: { temperature: number; max_tokens: number; timeoutMs?: number; perfLabel?: string }
): Promise<string> {
  const timeoutMs = options.timeoutMs ?? 55_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();

  try {
    const response = await fetch(GROK_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${getGrokApiKey()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: GROK_CHAT_MODEL,
        messages,
        temperature: options.temperature,
        max_tokens: options.max_tokens,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Grok API error: ${response.status} ${err}`);
    }

    const apiResponse = await response.json();
    const content = apiResponse.choices?.[0]?.message?.content?.trim() || '';
    logPerformance(options.perfLabel || 'grok.chat', Date.now() - startedAt, {
      model: GROK_CHAT_MODEL,
      maxTokens: options.max_tokens,
      outcome: 'ok',
    });
    return content;
  } catch (error) {
    logPerformance(options.perfLabel || 'grok.chat', Date.now() - startedAt, {
      model: GROK_CHAT_MODEL,
      outcome: 'error',
      error: error instanceof Error ? error.message : 'unknown',
    });
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Grok API timed out after ${Math.round(timeoutMs / 1000)}s`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function generateWarrantyStory(
  ro: RepairOrder,
  line: RepairLine,
  historyContext = '',
  advisorContext = '',
  knowledgeBaseContext = ''
): Promise<string> {
  // PROMPT_VERSION is stamped on story.generate audit entries for warranty compliance traceability.
  const systemPrompt = knowledgeBaseContext
    ? `${SYSTEM_PROMPT}\n\n${knowledgeBaseContext}`
    : SYSTEM_PROMPT;
  const userMessage = buildWarrantyStoryUserMessage(ro, line, historyContext, undefined, advisorContext);
  const story = await grokChat(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    { temperature: WARRANTY_STORY_TEMPERATURE, max_tokens: 1200, timeoutMs: 110_000, perfLabel: 'grok.story.generate' }
  );
  return story || 'No story generated.';
}

export async function scoreWarrantyStory(
  ro: RepairOrder,
  line: RepairLine,
  warrantyStory: string
): Promise<StoryQualityResult> {
  const raw = await grokChat(
    [
      { role: 'system', content: STORY_SCORE_SYSTEM_PROMPT },
      { role: 'user', content: buildStoryScoreUserMessage(ro, line, warrantyStory) },
    ],
    { temperature: 0.1, max_tokens: 900, timeoutMs: 60_000, perfLabel: 'grok.story.score' }
  );
  return parseStoryQualityResponse(raw);
}

export async function reviewWarrantyStory(
  ro: RepairOrder,
  line: RepairLine,
  warrantyStory: string
): Promise<StoryReviewResult> {
  const raw = await grokChat(
    [
      { role: 'system', content: STORY_REVIEW_SYSTEM_PROMPT },
      { role: 'user', content: buildStoryReviewUserMessage(ro, line, warrantyStory) },
    ],
    { temperature: 0.15, max_tokens: 1400, timeoutMs: 90_000, perfLabel: 'grok.story.review' }
  );
  return parseStoryReviewResponse(raw);
}

export async function extractDiagnosticsFromImage(imageDataUrl: string): Promise<ExtractedData> {
  const raw = await grokChat(
    [
      {
        role: 'user',
        content: [
          { type: 'text', text: DIAGNOSTIC_EXTRACTION_PROMPT },
          { type: 'image_url', image_url: { url: imageDataUrl } },
        ],
      },
    ],
    { temperature: 0.05, max_tokens: 900, timeoutMs: DIAGNOSTIC_EXTRACT_GROK_MS, perfLabel: 'grok.diagnostics.extract' }
  );

  const parsed = parseDiagnosticExtractionJson(raw);
  if (!parsed) {
    throw new Error('Could not parse diagnostic extraction from Grok response');
  }
  return normalizeExtractedData(parsed);
}

export async function extractROFromImages(imageDataUrls: string[]) {
  const imageContents = imageDataUrls.map((url) => ({ type: 'image_url', image_url: { url } }));
  const extractedText = await grokChat(
    [
      {
        role: 'user',
        content: [{ type: 'text', text: RO_EXTRACTION_PROMPT }, ...imageContents],
      },
    ],
    { temperature: 0.05, max_tokens: 1800, timeoutMs: RO_EXTRACT_GROK_MS, perfLabel: 'grok.ro.extract' }
  );
  return parseStructuredROText(extractedText);
}