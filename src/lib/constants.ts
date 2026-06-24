export { CONSENT_VERSION, WARRANTY_STORY_MAX_CHARS, WARRANTY_STORY_WARN_CHARS } from '@/types';

/** Override per deployment via env — defaults for local dev only. */
export const DEALERSHIP_DISPLAY_NAME =
  process.env.DEALERSHIP_DISPLAY_NAME?.trim() || 'Mercedes-Benz of Tiverton';
export const DEALERSHIP_CODE = process.env.DEALERSHIP_CODE?.trim() || 'VITI';

/** Dealership voice input tuning — edit per site for bay noise and technician preference. */
export { DEFAULT_VOICE_INPUT_SETTINGS as VOICE_INPUT_SETTINGS } from '@/lib/voice/voiceSettings';