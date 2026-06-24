import { NextResponse } from 'next/server';
import { writeAuditLog } from '@/lib/audit';
import { createSessionToken, loginTechnician, setSessionCookie } from '@/lib/auth';
import { apiError, handleRouteError } from '@/lib/errors';
import { checkRateLimit, getRequestIp, RATE_LIMITS } from '@/lib/rate-limit';
import { loginSchema, parseRequestBody } from '@/lib/validation';

export async function POST(request: Request) {
  const rateLimited = await checkRateLimit(request, 'auth.login', RATE_LIMITS.auth);
  if (rateLimited) return rateLimited;

  try {
    const parsed = await parseRequestBody(request, loginSchema);
    if ('error' in parsed) return parsed.error;

    const { d7Number, password } = parsed.data;
    const session = await loginTechnician(d7Number, password);
    if (!session) {
      return apiError('Invalid D7 number or password.', 401);
    }

    const token = await createSessionToken(session);
    await setSessionCookie(token);

    await writeAuditLog({
      action: 'auth.login',
      dealershipId: session.dealershipId,
      technicianId: session.technicianId,
      ipAddress: getRequestIp(request),
    });

    return NextResponse.json({ session });
  } catch (error) {
    return handleRouteError(error, 'auth.login');
  }
}