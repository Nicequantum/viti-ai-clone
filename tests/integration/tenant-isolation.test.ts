import { webcrypto } from 'node:crypto';
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

if (!globalThis.crypto) {
  globalThis.crypto = webcrypto as Crypto;
}
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { GET as getRepairOrder } from '../../src/app/api/repair-orders/[id]/route';
import { GET as listRepairOrders } from '../../src/app/api/repair-orders/route';
import { createSessionToken } from '../../src/lib/auth';
import { repairLineToDbFields, repairOrderToDbFields } from '../../src/lib/roMapper';
import { buildAuthenticatedRequest, readJsonResponse } from '../helpers/routeTest';

const prisma = new PrismaClient();

describe('tenant isolation (route handlers)', () => {
  let dealershipAId = '';
  let dealershipBId = '';
  let techAId = '';
  let techBId = '';
  let techAToken = '';
  let techBToken = '';
  let roAId = '';

  before(async () => {
    const passwordHash = await bcrypt.hash('changeme123', 12);

    const dealershipA = await prisma.dealership.upsert({
      where: { id: 'tenant-test-a' },
      update: {},
      create: { id: 'tenant-test-a', name: 'Tenant Test Dealership A' },
    });
    dealershipAId = dealershipA.id;

    const dealershipB = await prisma.dealership.upsert({
      where: { id: 'tenant-test-b' },
      update: {},
      create: { id: 'tenant-test-b', name: 'Tenant Test Dealership B' },
    });
    dealershipBId = dealershipB.id;

    const techA = await prisma.technician.upsert({
      where: { email: 'tenant-a@dealership.com' },
      update: { dealershipId: dealershipAId },
      create: {
        email: 'tenant-a@dealership.com',
        name: 'Tenant Tech A',
        passwordHash,
        role: 'technician',
        isActive: true,
        dealershipId: dealershipAId,
        consentAt: new Date(),
        consentVersion: '2026-06-07-v1',
      },
    });
    techAId = techA.id;

    const techB = await prisma.technician.upsert({
      where: { email: 'tenant-b@dealership.com' },
      update: { dealershipId: dealershipBId },
      create: {
        email: 'tenant-b@dealership.com',
        name: 'Tenant Tech B',
        passwordHash,
        role: 'technician',
        isActive: true,
        dealershipId: dealershipBId,
        consentAt: new Date(),
        consentVersion: '2026-06-07-v1',
      },
    });
    techBId = techB.id;

    techAToken = await createSessionToken({
      technicianId: techA.id,
      email: techA.email,
      name: techA.name,
      role: techA.role,
      dealershipId: dealershipAId,
      dealershipName: dealershipA.name,
      consentAt: techA.consentAt?.toISOString() ?? null,
      sessionVersion: techA.sessionVersion,
    });

    techBToken = await createSessionToken({
      technicianId: techB.id,
      email: techB.email,
      name: techB.name,
      role: techB.role,
      dealershipId: dealershipBId,
      dealershipName: dealershipB.name,
      consentAt: techB.consentAt?.toISOString() ?? null,
      sessionVersion: techB.sessionVersion,
    });

    const roInput = {
      roNumber: `TENANT-${Date.now().toString().slice(-5)}`,
      vehicle: {
        vin: 'WDDWF4KB0FR123456',
        year: '2019',
        make: 'Mercedes-Benz',
        model: 'C300',
        engine: '',
        mileageIn: '10000',
        mileageOut: '',
      },
      customer: { name: 'Tenant Test Customer' },
      complaints: ['Test complaint'],
      repairLines: [
        {
          id: 'tenant-line-1',
          lineNumber: 1,
          description: 'Tenant isolation test line',
          customerConcern: 'Test concern',
          technicianNotes: 'Test notes',
          xentryImages: [],
        },
      ],
    };

    const created = await prisma.repairOrder.create({
      data: {
        ...repairOrderToDbFields(roInput),
        technicianId: techAId,
        dealershipId: dealershipAId,
        repairLines: {
          create: roInput.repairLines.map((line) => repairLineToDbFields(line)),
        },
      },
    });
    roAId = created.id;
  });

  after(async () => {
    if (roAId) {
      await prisma.repairOrder.delete({ where: { id: roAId } }).catch(() => undefined);
    }
    await prisma.technician.deleteMany({
      where: { email: { in: ['tenant-a@dealership.com', 'tenant-b@dealership.com'] } },
    });
    await prisma.dealership.deleteMany({
      where: { id: { in: ['tenant-test-a', 'tenant-test-b'] } },
    });
    await prisma.$disconnect();
  });

  test('technician B cannot read dealership A repair order by id', async () => {
    const request = buildAuthenticatedRequest(`http://localhost/api/repair-orders/${roAId}`, techBToken);
    const response = await getRepairOrder(request, { params: Promise.resolve({ id: roAId }) });
    const { status } = await readJsonResponse<{ error?: string }>(response);

    assert.equal(status, 404, 'Cross-tenant RO access must return 404 (not found)');
  });

  test('technician A can read own dealership repair order by id', async () => {
    const request = buildAuthenticatedRequest(`http://localhost/api/repair-orders/${roAId}`, techAToken);
    const response = await getRepairOrder(request, { params: Promise.resolve({ id: roAId }) });
    const { status, body } = await readJsonResponse<{ repairOrder: { id: string } }>(response);

    assert.equal(status, 200);
    assert.equal(body.repairOrder.id, roAId);
  });

  test('repair order list is scoped to the signed-in dealership', async () => {
    const requestA = buildAuthenticatedRequest('http://localhost/api/repair-orders', techAToken);
    const responseA = await listRepairOrders(requestA);
    const { body: bodyA } = await readJsonResponse<{ repairOrders: Array<{ id: string; dealershipId?: string }> }>(
      responseA
    );

    const requestB = buildAuthenticatedRequest('http://localhost/api/repair-orders', techBToken);
    const responseB = await listRepairOrders(requestB);
    const { body: bodyB } = await readJsonResponse<{ repairOrders: Array<{ id: string }> }>(responseB);

    assert.ok(bodyA.repairOrders.some((ro) => ro.id === roAId), 'Tech A should see own dealership RO');
    assert.ok(
      !bodyB.repairOrders.some((ro) => ro.id === roAId),
      'Tech B must not see dealership A RO in list'
    );
  });
});