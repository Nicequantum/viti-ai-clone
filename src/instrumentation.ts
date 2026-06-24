export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { getRuntimeConfig, validateEnvironment } = await import('./lib/env');
    const { PROMPT_VERSION } = await import('./prompts/version');
    const result = validateEnvironment({
      throwOnError: process.env.NODE_ENV === 'production',
      production: process.env.NODE_ENV === 'production',
    });
    const config = getRuntimeConfig(PROMPT_VERSION);
    console.log(
      `[merlin:startup] v${config.appVersion} prompt=${config.promptVersion} commit=${config.buildCommit} maintenance=${config.maintenanceMode}`
    );
    if (!result.valid) {
      console.error('[merlin:startup] Environment validation failed — see logs above');
    }
  }
}