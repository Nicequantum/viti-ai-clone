import { writeAuditLog } from '@/lib/audit';
import { withAuth } from '@/lib/apiRoute';
import {
  captureAdvisorIntelligence,
  type AdvisorExtractionSource,
} from '@/lib/advisorIntelligence';
import { prisma } from '@/lib/db';
import {
  dbToRepairOrder,
  normalizeImageAttachments,
  repairLineToDbFields,
  repairOrderToDbFields,
  type RepairOrderInput,
} from '@/lib/roMapper';
import { collectRepairOrderImagePathnames, findForbiddenImagePathname } from '@/lib/imageAccess';
import { apiError, FORBIDDEN_ERROR, VALIDATION_ERROR } from '@/lib/errors';
import { getRequestIp } from '@/lib/rate-limit';
import { LARGE_JSON_BODY_LIMIT_BYTES } from '@/lib/requestBody';
import { createRepairOrderSchema, parseRequestBody } from '@/lib/validation';
import { emptyExtractedData } from '@/utils/diagnosticParser';
import { createRepairOrderFromScan } from '@/utils/repairOrderFactory';

export async function GET(request: Request) {
  return withAuth(
    request,
    async (session) => {
      const where =
        session.role === 'manager'
          ? { dealershipId: session.dealershipId }
          : { technicianId: session.technicianId };

      const orders = await prisma.repairOrder.findMany({
        where,
        include: {
          repairLines: true,
          technician: { select: { name: true } },
          serviceAdvisor: { select: { id: true, displayName: true } },
        },
        orderBy: { updatedAt: 'desc' },
      });

      const repairOrders = orders.map((ro) => {
        const mapped = dbToRepairOrder(ro);
        mapped.technicianName = ro.technician.name;
        return mapped;
      });

      return { repairOrders };
    },
    { rateLimitKey: 'ros.list' }
  );
}

export async function POST(request: Request) {
  return withAuth(
    request,
    async (session) => {
      const parsed = await parseRequestBody(request, createRepairOrderSchema, LARGE_JSON_BODY_LIMIT_BYTES);
      if ('error' in parsed) return parsed.error;

      const data = parsed.data;
      let input: RepairOrderInput;

      if (data.fromExtraction) {
        const ro = createRepairOrderFromScan({
          roNumber: data.roNumber || `R-${Date.now().toString().slice(-6)}`,
          vehicle: {
            vin: data.vehicle?.vin || '',
            year: data.vehicle?.year || '',
            make: data.vehicle?.make || '',
            model: data.vehicle?.model || '',
            engine: data.vehicle?.engine || '',
            mileageIn: data.vehicle?.mileageIn || '',
            mileageOut: data.vehicle?.mileageOut || '',
          },
          customerName: data.customerName || data.customer?.name || '',
          complaints: data.complaints || [],
          complaintLabels: data.complaintLabels,
          serviceAdvisorName: data.serviceAdvisorName,
        });
        input = {
          roNumber: ro.roNumber,
          vehicle: ro.vehicle,
          customer: ro.customer,
          complaints: ro.complaints,
          complaintLabels: ro.complaintLabels,
          xentryImages: ro.xentryImages,
          xentryOcrTexts: ro.xentryOcrTexts,
          repairLines: ro.repairLines,
        };
      } else {
        input = {
          roNumber: data.roNumber || `R-${Date.now().toString().slice(-6)}`,
          vehicle: {
            vin: data.vehicle?.vin || '',
            year: data.vehicle?.year || '',
            make: data.vehicle?.make || '',
            model: data.vehicle?.model || '',
            engine: data.vehicle?.engine || '',
            mileageIn: data.vehicle?.mileageIn || '',
            mileageOut: data.vehicle?.mileageOut || '',
          },
          customer: { name: data.customer?.name || '' },
          complaints: data.complaints || [],
          xentryImages: normalizeImageAttachments(data.xentryImages),
          xentryOcrTexts: data.xentryOcrTexts || [],
          repairLines: (data.repairLines || []).map((l, i) => ({
            id: l.id || `temp-${i}`,
            lineNumber: l.lineNumber || i + 1,
            description: l.description || 'Enter repair description',
            customerConcern: l.customerConcern || '',
            technicianNotes: l.technicianNotes || '',
            xentryImages: normalizeImageAttachments(l.xentryImages),
            xentryOcrTexts: l.xentryOcrTexts || [],
            extractedData: { ...emptyExtractedData(), ...l.extractedData },
            warrantyStory: l.warrantyStory,
          })),
        };

        if (input.repairLines.length === 0) {
          input.repairLines = [
            {
              id: 'temp',
              lineNumber: 1,
              description: 'Enter repair description',
              customerConcern: '',
              technicianNotes: '',
              xentryImages: [],
              extractedData: emptyExtractedData(),
            },
          ];
        }
      }

      const forbiddenPathname = await findForbiddenImagePathname(
        session,
        collectRepairOrderImagePathnames(input)
      );
      if (forbiddenPathname) {
        return apiError(FORBIDDEN_ERROR, 403);
      }

      const extractionSource: AdvisorExtractionSource =
        data.advisorExtractionSource || (data.fromExtraction ? 'grok' : 'manual');

      const { created, advisorCapture } = await prisma.$transaction(async (tx) => {
        const ro = await tx.repairOrder.create({
          data: {
            ...repairOrderToDbFields(input),
            technicianId: session.technicianId,
            dealershipId: session.dealershipId,
            repairLines: {
              create: input.repairLines.map((line) => repairLineToDbFields(line)),
            },
          },
          include: { repairLines: true, serviceAdvisor: { select: { id: true, displayName: true } } },
        });

        const capture = data.serviceAdvisorName
          ? await captureAdvisorIntelligence(
              {
                dealershipId: session.dealershipId,
                repairOrderId: ro.id,
                serviceAdvisorName: data.serviceAdvisorName,
                complaints: input.complaints,
                complaintLabels: input.complaintLabels,
                vehicle: {
                  make: input.vehicle.make,
                  model: input.vehicle.model,
                },
                extractionSource,
              },
              tx
            )
          : null;

        const createdRo = await tx.repairOrder.findUniqueOrThrow({
          where: { id: ro.id },
          include: { repairLines: true, serviceAdvisor: { select: { id: true, displayName: true } } },
        });

        return { created: createdRo, advisorCapture: capture };
      });

      if (advisorCapture?.serviceAdvisor) {
        await writeAuditLog({
          action: 'advisor.capture',
          dealershipId: session.dealershipId,
          technicianId: session.technicianId,
          entityType: 'serviceAdvisor',
          entityId: advisorCapture.serviceAdvisor.id,
          metadata: {
            repairOrderId: created.id,
            roNumber: created.roNumber,
            observationCount: input.complaints.length,
            isNewAdvisor: advisorCapture.serviceAdvisor.isNew,
          },
          ipAddress: getRequestIp(request),
        });
      }

      await writeAuditLog({
        action: 'ro.create',
        dealershipId: session.dealershipId,
        technicianId: session.technicianId,
        entityType: 'repairOrder',
        entityId: created.id,
        metadata: { roNumber: created.roNumber },
        ipAddress: getRequestIp(request),
      });

      return { repairOrder: dbToRepairOrder(created) };
    },
    { rateLimitKey: 'ros.create' }
  );
}