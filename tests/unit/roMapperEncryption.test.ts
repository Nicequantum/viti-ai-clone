import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';
import { dbToRepairLine, dbToRepairOrder, repairLineToDbFields, repairOrderToDbFields } from '../../src/lib/roMapper';
import type { RepairLine, RepairOrder } from '../../src/types';

const sampleRo: RepairOrder = {
  id: 'ro-1',
  roNumber: '482910',
  vehicle: {
    vin: 'W1N4N4HB5NJ123456',
    year: '2022',
    make: 'Mercedes-Benz',
    model: 'GLE 350',
    mileageIn: '28450',
    mileageOut: '28458',
  },
  customer: { name: 'John Smith' },
  complaints: ['# A CHECK ENGINE LIGHT ON'],
  xentryOcrTexts: ['RO-level Quick Test OCR block'],
  repairLines: [],
};

const sampleLine: RepairLine = {
  id: 'line-1',
  lineNumber: 1,
  description: 'Engine diagnosis',
  customerConcern: 'CHECK ENGINE LIGHT ON',
  technicianNotes: 'Found P0300. Source voltage 12.4V.',
  xentryImages: [],
  xentryOcrTexts: ['P0300 Random Misfire', 'Cylinder 3 misfire count elevated'],
  extractedData: {
    codes: ['P0300'],
    faultCodes: [{ code: 'P0300', description: 'Random/multiple cylinder misfire detected' }],
    guidedTests: [],
    measurements: [],
    components: [],
    circuits: [],
  },
  warrantyStory: 'Customer presented with check engine light. Verified P0300 and replaced coil.',
};

describe('roMapper sensitive field encryption', () => {
  before(() => {
    process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'test-encryption-key-with-32-chars-minimum';
  });

  test('repairOrderToDbFields encrypts RO-level OCR text arrays', () => {
    const fields = repairOrderToDbFields({
      roNumber: sampleRo.roNumber,
      vehicle: sampleRo.vehicle,
      customer: sampleRo.customer,
      complaints: sampleRo.complaints,
      xentryOcrTexts: sampleRo.xentryOcrTexts,
      repairLines: [],
    });

    assert.notEqual(fields.xentryOcrTextsEncrypted, JSON.stringify(sampleRo.xentryOcrTexts));
    assert.ok(fields.xentryOcrTextsEncrypted.length > 0);
  });

  test('repairLineToDbFields encrypts technician notes, OCR texts, and warranty stories', () => {
    const fields = repairLineToDbFields(sampleLine);

    assert.notEqual(fields.technicianNotesEncrypted, sampleLine.technicianNotes);
    assert.notEqual(fields.xentryOcrTextsEncrypted, JSON.stringify(sampleLine.xentryOcrTexts));
    assert.notEqual(fields.warrantyStoryEncrypted, sampleLine.warrantyStory);
    assert.ok(fields.technicianNotesEncrypted.length > 0);
    assert.ok(fields.xentryOcrTextsEncrypted.length > 0);
    assert.ok(fields.warrantyStoryEncrypted && fields.warrantyStoryEncrypted.length > 0);
  });

  test('db mappers decrypt sensitive fields back to plaintext for API/UI', () => {
    const roFields = repairOrderToDbFields({
      roNumber: sampleRo.roNumber,
      vehicle: sampleRo.vehicle,
      customer: sampleRo.customer,
      complaints: sampleRo.complaints,
      xentryOcrTexts: sampleRo.xentryOcrTexts,
      repairLines: [],
    });
    const lineFields = repairLineToDbFields(sampleLine);

    const mappedRo = dbToRepairOrder({
      id: 'ro-1',
      roNumber: sampleRo.roNumber,
      technicianId: 'tech-1',
      dealershipId: 'dealer-1',
      serviceAdvisorId: null,
      serviceAdvisorNameEncrypted: '',
      advisorMatchConfidence: null,
      advisorIdentifiedAt: null,
      vinEncrypted: roFields.vinEncrypted,
      year: roFields.year,
      make: roFields.make,
      model: roFields.model,
      engine: roFields.engine,
      mileageIn: roFields.mileageIn,
      mileageOut: roFields.mileageOut,
      customerNameEncrypted: roFields.customerNameEncrypted,
      complaintsEncrypted: roFields.complaintsEncrypted,
      xentryImageUrls: roFields.xentryImageUrls,
      xentryOcrTextsEncrypted: roFields.xentryOcrTextsEncrypted,
      createdAt: new Date(),
      updatedAt: new Date(),
      repairLines: [
        {
          id: sampleLine.id,
          repairOrderId: 'ro-1',
          lineNumber: sampleLine.lineNumber,
          description: sampleLine.description,
          customerConcernEncrypted: lineFields.customerConcernEncrypted,
          technicianNotesEncrypted: lineFields.technicianNotesEncrypted,
          xentryImageUrls: lineFields.xentryImageUrls,
          xentryOcrTextsEncrypted: lineFields.xentryOcrTextsEncrypted,
          extractedData: lineFields.extractedData,
          warrantyStoryEncrypted: lineFields.warrantyStoryEncrypted,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      serviceAdvisor: null,
    });

    const mappedLine = mappedRo.repairLines[0];
    assert.deepEqual(mappedRo.xentryOcrTexts, sampleRo.xentryOcrTexts);
    assert.equal(mappedLine.technicianNotes, sampleLine.technicianNotes);
    assert.deepEqual(mappedLine.xentryOcrTexts, sampleLine.xentryOcrTexts);
    assert.equal(mappedLine.warrantyStory, sampleLine.warrantyStory);
  });
});