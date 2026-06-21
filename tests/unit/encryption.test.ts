import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';
import {
  decryptOptionalSensitiveText,
  decryptSensitiveText,
  decryptStringArray,
  encryptOptionalSensitiveText,
  encryptPII,
  encryptSensitiveText,
  encryptStringArray,
} from '../../src/lib/encryption';

describe('sensitive field encryption', () => {
  before(() => {
    process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'test-encryption-key-with-32-chars-minimum';
  });

  test('encrypts and decrypts technician notes', () => {
    const notes = 'Quick Test found P0300. Performed coil swap test.';
    const encrypted = encryptSensitiveText(notes);
    assert.notEqual(encrypted, notes);
    assert.equal(decryptSensitiveText(encrypted), notes);
  });

  test('reads legacy plaintext technician notes', () => {
    const legacy = 'Legacy plaintext notes before migration';
    assert.equal(decryptSensitiveText(legacy), legacy);
  });

  test('encrypts and decrypts OCR text arrays', () => {
    const ocrTexts = ['P0300 Random Misfire', 'Cylinder 3 misfire count: 42'];
    const encrypted = encryptStringArray(ocrTexts);
    assert.notEqual(encrypted, JSON.stringify(ocrTexts));
    assert.deepEqual(decryptStringArray(encrypted), ocrTexts);
  });

  test('reads legacy plaintext OCR JSON arrays', () => {
    const legacy = JSON.stringify(['Legacy OCR block 1', 'Legacy OCR block 2']);
    assert.deepEqual(decryptStringArray(legacy), ['Legacy OCR block 1', 'Legacy OCR block 2']);
  });

  test('encrypts and decrypts optional warranty stories', () => {
    const story = 'Customer Complaint: Check engine light on.\nCause: P0300.\nCorrection: Replaced coil.';
    const encrypted = encryptOptionalSensitiveText(story);
    assert.ok(encrypted);
    assert.notEqual(encrypted, story);
    assert.equal(decryptOptionalSensitiveText(encrypted!), story);
  });

  test('returns empty values for blank sensitive fields', () => {
    assert.equal(encryptStringArray([]), '');
    assert.deepEqual(decryptStringArray(''), []);
    assert.equal(decryptSensitiveText(''), '');
    assert.equal(decryptOptionalSensitiveText(null), undefined);
    assert.equal(encryptOptionalSensitiveText(undefined), null);
  });
});