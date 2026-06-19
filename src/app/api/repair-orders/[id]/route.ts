import { writeAuditLog } from '@/lib/audit';
import { withAuth } from '@/lib/apiRoute';
import {
  captureAdvisorIntelligence,
  type AdvisorExtractionSource,
} from '@/lib/advisorIntelligence';
import { prisma } from '@/lib/db';
import { dbToRepairOrder, normalizeImageAttachments, repairLineToDbFields, repairOrderToDbFields } from '@/lib/roMapper';
import { collectRepairOrderImagePathnames, findForbiddenImagePathname } from '@/lib/imageAccess';
import { apiError, FORBIDDEN_ERROR, NOT_FOUND_ERROR, VALIDATION_ERROR } from '@/lib/errors';
import { getRequestIp } from '@/lib/rate-limit';
import { parseBody, updateRepairOrderSchema } from '@/lib/validation';
import { emptyExtractedData } from '@/utils/diagnosticParser';

async function canAccess(session: { technicianId: string; role: string; dealershipId: string }, roId: string) {
  const ro = await prisma.repairOrder.findUnique({ where: { id: roId }, include: { repairLines: true } });
  if (!ro) return null;
  if (session.role === 'manager' && ro.dealershipId === session.dealershipId) return ro;
  if (ro.technicianId === session.technicianId) return ro;
  return null;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withAuth(
    request,
    async (session) => {
      const ro = await canAccess(session, id);
      if (!ro) return apiError(NOT_FOUND_ERROR, 404);

      const full = await prisma.repairOrder.findUnique({
        where: { id },
        include: {
          repairLines: true,
          serviceAdvisor: { select: { id: true, displayName: true } },
        },
      });

      return { repairOrder: dbToRepairOrder(full!) };
    },
    { rateLimitKey: 'ros.get' }
  );
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withAuth(
    request,
    async (session) => {
      const existing = await canAccess(session, id);
      if (!existing) return apiError(NOT_FOUND_ERROR, 404);

      const body = await request.json();
      const parsed = parseBody(updateRepairOrderSchema, body);
      if ('error' in parsed) {
        return apiError(VALIDATION_ERROR, 400);
      }

      const data = parsed.data;
      const existingMapped = dbToRepairOrder(existing);
      const input = {
        roNumber: data.roNumber ?? existing.roNumber,
        vehicle: {
          vin: data.vehicle?.vin ?? existingMapped.vehicle.vin,
          year: data.vehicle?.year ?? existing.year,
          make: data.vehicle?.make ?? existing.make,
          model: data.vehicle?.model ?? existing.model,
          engine: data.vehicle?.engine ?? existing.engine,
          mileageIn: data.vehicle?.mileageIn ?? existing.mileageIn,
          mileageOut: data.vehicle?.mileageOut ?? existing.mileageOut,
        },
        customer: data.customer ?? { name: existingMapped.customer.name },
        complaints: data.complaints ?? existingMapped.complaints,
        complaintLabels: data.complaintLabels ?? existingMapped.complaintLabels,
        xentryImages: data.xentryImages ? normalizeImageAttachments(data.xentryImages) : undefined,
        xentryOcrTexts: data.xentryOcrTexts,
        repairLines: data.repairLines,
      };

      const pathnamesToValidate: string[] = [];
      if (data.xentryImages) {
        pathnamesToValidate.push(
          ...collectRepairOrderImagePathnames({ xentryImages: normalizeImageAttachments(data.xentryImages) })
        );
      }
      if (data.repairLines) {
        for (const line of data.repairLines) {
          if (line.xentryImages) {
            pathnamesToValidate.push(
              ...collectRepairOrderImagePathnames({
                xentryImages: normalizeImageAttachments(line.xentryImages),
              })
            );
          }
        }
      }
      const forbiddenPathname = await findForbiddenImagePathname(session, pathnamesToValidate);
      if (forbiddenPathname) {
        return apiError(FORBIDDEN_ERROR, 403);
      }

      const storyEdits: Array<{ lineId: string; lineNumber: number }> = [];
      if (data.repairLines) {
        for (const line of data.repairLines) {
          if (!line.id || line.warrantyStory === undefined) continue;
          const prev = existing.repairLines.find((l) => l.id === line.id);
          if (prev && prev.warrantyStory !== line.warrantyStory) {
            storyEdits.push({ lineId: line.id, lineNumber: prev.lineNumber });
          }
        }
      }

      const extractionSource: AdvisorExtractionSource = data.advisorExtractionSource || 'manual';
      const advisorNameToCapture = data.serviceAdvisorName || existingMapped.serviceAdvisorName;

      const advisorCapture = await prisma.$transaction(async (tx) => {
        await tx.repairOrder.update({
          where: { id },
          data: repairOrderToDbFields(input as Parameters<typeof repairOrderToDbFields>[0]),
        });

        if (data.repairLines && Array.isArray(data.repairLines)) {
          for (const line of data.repairLines) {
            if (line.id) {
              const lineFields = repairLineToDbFields({
                id: line.id,
                lineNumber: line.lineNumber || 1,
                description: line.description || 'Enter repair description',
                customerConcern: line.customerConcern || '',
                technicianNotes: line.technicianNotes || '',
                xentryImages: normalizeImageAttachments(line.xentryImages),
                xentryOcrTexts: line.xentryOcrTexts || [],
                extractedData: { ...emptyExtractedData(), ...line.extractedData },
                warrantyStory: line.warrantyStory,
              });

              await tx.repairLine.upsert({
                where: { id: line.id },
                update: lineFields,
                create: {
                  id: line.id,
                  repairOrderId: id,
                  ...lineFields,
                },
              });
            }
          }

          const incomingIds = new Set(data.repairLines.map((l) => l.id).filter(Boolean));
          const dbLines = await tx.repairLine.findMany({ where: { repairOrderId: id } });
          for (const dbLine of dbLines) {
            if (!incomingIds.has(dbLine.id)) {
              await tx.repairLine.delete({ where: { id: dbLine.id } });
            }
          }
        }

        if (!advisorNameToCapture) {
          return null;
        }

        return captureAdvisorIntelligence(
          {
            dealershipId: session.dealershipId,
            repairOrderId: id,
            serviceAdvisorName: advisorNameToCapture,
            complaints: input.complaints,
            complaintLabels: input.complaintLabels,
            vehicle: {
              make: input.vehicle.make,
              model: input.vehicle.model,
            },
            extractionSource,
            wasCorrected: data.complaintsWereCorrected ?? false,
          },
          tx
        );
      });

      if (advisorCapture?.serviceAdvisor) {
        await writeAuditLog({
          action: 'advisor.capture',
          dealershipId: session.dealershipId,
          technicianId: session.technicianId,
          entityType: 'serviceAdvisor',
          entityId: advisorCapture.serviceAdvisor.id,
          metadata: {
            repairOrderId: id,
            roNumber: input.roNumber,
            observationCount: input.complaints.length,
            wasCorrected: data.complaintsWereCorrected ?? false,
          },
          ipAddress: getRequestIp(request),
        });
      }

      const updated = await prisma.repairOrder.findUnique({
        where: { id },
        include: {
          repairLines: true,
          serviceAdvisor: { select: { id: true, displayName: true } },
        },
      });

      await writeAuditLog({
        action: 'ro.update',
        dealershipId: session.dealershipId,
        technicianId: session.technicianId,
        entityType: 'repairOrder',
        entityId: id,
        metadata: { roNumber: updated!.roNumber },
        ipAddress: getRequestIp(request),
      });

      for (const edit of storyEdits) {
        await writeAuditLog({
          action: 'story.edit',
          dealershipId: session.dealershipId,
          technicianId: session.technicianId,
          entityType: 'repairLine',
          entityId: edit.lineId,
          metadata: { repairOrderId: id, lineNumber: edit.lineNumber },
          ipAddress: getRequestIp(request),
        });
      }

      return { repairOrder: dbToRepairOrder(updated!) };
    },
    { rateLimitKey: 'ros.update' }
  );
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withAuth(
    request,
    async (session) => {
      const existing = await canAccess(session, id);
      if (!existing) return apiError(NOT_FOUND_ERROR, 404);

      await prisma.repairOrder.delete({ where: { id } });

      await writeAuditLog({
        action: 'ro.delete',
        dealershipId: session.dealershipId,
        technicianId: session.technicianId,
        entityType: 'repairOrder',
        entityId: id,
        metadata: { roNumber: existing.roNumber },
        ipAddress: getRequestIp(request),
      });

      return { ok: true };
    },
    { rateLimitKey: 'ros.delete' }
  );
}