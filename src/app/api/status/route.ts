import { VOICE_INPUT_SETTINGS } from '@/lib/constants';
import { getRuntimeConfig, isMaintenanceModeEnabled } from '@/lib/env';
import { isGrokConfigured } from '@/lib/grok';
import { PROMPT_VERSION } from '@/prompts/version';

export const dynamic = 'force-dynamic';

/** Lightweight public status for client maintenance/offline banners and footer version display. */
export async function GET() {
  const config = getRuntimeConfig(PROMPT_VERSION);

  return Response.json(
    {
      maintenance: isMaintenanceModeEnabled(),
      version: config.appVersion,
      promptVersion: config.promptVersion,
      buildCommit: config.buildCommit,
      buildDate: config.buildDate,
      grokConfigured: isGrokConfigured(),
      voiceEnabled: VOICE_INPUT_SETTINGS.enabled,
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}