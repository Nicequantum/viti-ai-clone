/** Bump when making breaking or major prompt changes. */
export const PROMPT_VERSION = '2.1.0';

/** Optional dealership-specific rules (set MERLIN_DEALERSHIP_PROMPT_RULES in env). */
export function getDealershipPromptRules(): string {
  return process.env.MERLIN_DEALERSHIP_PROMPT_RULES?.trim() || '';
}