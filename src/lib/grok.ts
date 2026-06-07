import { RO_EXTRACTION_PROMPT } from '@/prompts/roExtraction';
import {
  SYSTEM_PROMPT,
  WARRANTY_STORY_TEMPERATURE,
  buildWarrantyStoryUserMessage,
} from '@/prompts/warrantyStory';
import type { RepairLine, RepairOrder } from '@/types';
import { parseStructuredROText } from '@/utils/roExtractor';

const GROK_API_URL = 'https://api.x.ai/v1/chat/completions';

function getApiKey(): string {
  const key = process.env.GROK_API_KEY;
  if (!key) throw new Error('GROK_API_KEY is not configured on the server');
  return key;
}

async function grokChat(
  messages: Array<{
    role: string;
    content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
  }>,
  options: { temperature: number; max_tokens: number }
): Promise<string> {
  const response = await fetch(GROK_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'grok-3',
      messages,
      temperature: options.temperature,
      max_tokens: options.max_tokens,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Grok API error: ${response.status} ${err}`);
  }

  const apiResponse = await response.json();
  return apiResponse.choices?.[0]?.message?.content?.trim() || '';
}

export async function generateWarrantyStory(
  ro: RepairOrder,
  line: RepairLine,
  historyContext = ''
): Promise<string> {
  const userMessage = buildWarrantyStoryUserMessage(ro, line, historyContext);
  const story = await grokChat(
    [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userMessage },
    ],
    { temperature: WARRANTY_STORY_TEMPERATURE, max_tokens: 900 }
  );
  return story || 'No story generated.';
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
    { temperature: 0.05, max_tokens: 700 }
  );
  return parseStructuredROText(extractedText);
}