import { NextResponse } from 'next/server';
import { logger } from './logger';

export const GENERIC_ERROR = 'Something went wrong. Please try again or contact your administrator.';
export const UNAUTHORIZED_ERROR = 'You must be signed in to perform this action.';
export const FORBIDDEN_ERROR = 'You do not have permission to perform this action.';
export const NOT_FOUND_ERROR = 'The requested resource was not found.';
export const VALIDATION_ERROR = 'Invalid request. Please check your input and try again.';
export const RATE_LIMIT_ERROR = 'Too many requests. Please wait a moment and try again.';
export const DAILY_USAGE_LIMIT_ERROR =
  'Daily AI usage limit reached (50 requests per technician). Try again tomorrow.';
export const SESSION_EXPIRED_ERROR = 'Your session has expired. Please sign in again.';
export const CONSENT_REQUIRED_ERROR =
  'Data and privacy consent is required before using Benz Tech. Please accept the consent terms to continue.';

export function apiError(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

export function handleRouteError(error: unknown, context: string): NextResponse {
  if (error instanceof Error && error.message === 'Unauthorized') {
    logger.warn('route.unauthorized', { context });
    return apiError(SESSION_EXPIRED_ERROR, 401);
  }
  logger.error('route.error', {
    context,
    error: error instanceof Error ? error.message : 'unknown',
  });
  return apiError(GENERIC_ERROR, 500);
}