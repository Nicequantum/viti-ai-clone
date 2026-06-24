import { GROK_UNAVAILABLE_ERROR } from './errors';

/** Maps Grok failures to technician-friendly API responses with correct HTTP status. */
export function mapGrokRouteError(error: unknown, featureLabel: string): { message: string; status: number } {
  const message = error instanceof Error ? error.message : `${featureLabel} failed`;

  if (message.includes('GROK_API_KEY') || message.includes('not configured')) {
    return {
      message: `${featureLabel} is temporarily unavailable. Contact your service manager.`,
      status: 503,
    };
  }
  if (message.toLowerCase().includes('timed out') || message.includes('AbortError')) {
    return {
      message: `${featureLabel} timed out — try again in a moment.`,
      status: 504,
    };
  }
  if (message.includes('Grok API error: 429')) {
    return {
      message: 'AI service is busy. Wait a moment and try again.',
      status: 429,
    };
  }
  if (message.includes('Grok API error: 5') || message.toLowerCase().includes('unreachable')) {
    return {
      message: GROK_UNAVAILABLE_ERROR,
      status: 503,
    };
  }

  return {
    message: `${featureLabel} failed — try again in a moment.`,
    status: 502,
  };
}