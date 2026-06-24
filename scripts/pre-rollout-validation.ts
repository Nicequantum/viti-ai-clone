#!/usr/bin/env npx tsx
/**
 * Merlin Pre-Rollout Validation Suite
 *
 * Run before every dealership deployment to confirm environment, security,
 * core systems, and feature readiness. Safe to run against staging or production
 * credentials — does not mutate customer data (read-only DB probe + in-memory tests).
 *
 * Usage:
 *   cp .env.example .env.local   # first-time setup
 *   npm run validate:pre-rollout
 *   MERLIN_BASE_URL=https://your-deployment.example npm run validate:pre-rollout
 *
 * This script depends on `.env.local` at the repo root (same as `npm run dev`).
 * DATABASE_URL and other secrets must never be hardcoded here.
 */

import { execSync } from 'node:child_process';
import { config as loadDotenv } from 'dotenv';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { jsPDF } from 'jspdf';

import {
  AUDIT_GENESIS_HASH,
  computeAuditEntryHash,
  verifyAuditChain,
  type AuditChainPayload,
} from '../src/lib/auditChain';
import { VOICE_INPUT_SETTINGS } from '../src/lib/constants';
import { encryptPII, decryptPII } from '../src/lib/encryption';
import {
  getAppVersion,
  getBuildCommit,
  getBuildDate,
  getRuntimeConfig,
  isMaintenanceModeEnabled,
  validateEnvironment,
} from '../src/lib/env';
import { PrismaClient } from '@prisma/client';
import { isKvConfigured, RATE_LIMITS } from '../src/lib/rate-limit';
import { SYSTEM_PROMPT, buildWarrantyStoryUserMessage } from '../src/prompts/warrantyStory';
import { PROMPT_VERSION } from '../src/prompts/version';
import { CUSTOMER_PAY_TEMPLATES } from '../src/prompts/templates/customerPayTemplates';
import { CRITICAL_AUDIT_ACTIONS, CUSTOMER_PAY_AUDIT_ACTIONS, STORY_PROMPT_AUDIT_ACTIONS } from '../src/lib/audit';
import { AUDIT_CUSTOMER_PAY_SENTINEL } from '../src/lib/auditChain';
import { normalizeWarrantyStoryText } from '../src/utils/pdfExport';
import { createRepairOrderFromScan } from '../src/utils/repairOrderFactory';

let prisma: PrismaClient | null = null;
let databaseConfigError: string | null = null;
let resolvedDatabaseUrl: string | null = null;

interface DatabaseTarget {
  hostname: string;
  port: string;
  database: string;
  sslmode: string;
  protocol: string;
}

// ─── Console styling ───────────────────────────────────────────────────────────

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
};

type CheckStatus = 'pass' | 'fail' | 'warn';

interface CheckResult {
  section: string;
  name: string;
  status: CheckStatus;
  detail: string;
  critical: boolean;
}

const results: CheckResult[] = [];

function record(
  section: string,
  name: string,
  status: CheckStatus,
  detail: string,
  critical = true
): void {
  results.push({ section, name, status, detail, critical });
  const icon = status === 'pass' ? `${c.green}✔ PASS${c.reset}` : status === 'warn' ? `${c.yellow}⚠ WARN${c.reset}` : `${c.red}✖ FAIL${c.reset}`;
  console.log(`  ${icon}  ${name}`);
  if (detail) console.log(`         ${c.dim}${detail}${c.reset}`);
}

function section(title: string): void {
  console.log(`\n${c.bold}${c.cyan}▸ ${title}${c.reset}`);
}

// ─── Environment bootstrap ─────────────────────────────────────────────────────

/** Load `.env` then `.env.local` (overrides) — mirrors Next.js / local dev conventions. */
function loadEnvironment(): void {
  const root = process.cwd();
  loadDotenv({ path: resolve(root, '.env') });
  const localPath = resolve(root, '.env.local');
  if (!existsSync(localPath)) {
    console.warn(
      `${c.yellow}⚠ .env.local not found — copy .env.example to .env.local and configure DATABASE_URL.${c.reset}`
    );
  }
  loadDotenv({ path: localPath, override: true });
  loadDotenv({ path: resolve(root, '.env.production'), override: true });
}

/** Strip optional wrapping quotes from a dotenv value. */
function stripEnvQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

/**
 * Validate and normalize DATABASE_URL from `.env.local`.
 * - Accepts postgres:// and postgresql:// (Prisma prefers postgresql://)
 * - Fixes common typos (textpostgres://)
 * - Adds sslmode=require for remote hosts (db.prisma.io, Neon, etc.)
 */
function normalizeDatabaseUrl(rawInput: string): string {
  let url = stripEnvQuotes(rawInput);
  if (!url) {
    throw new Error(
      'DATABASE_URL is empty. Set it in .env.local (see .env.example). ' +
        'Example: postgresql://USER:PASSWORD@db.prisma.io:5432/postgres?sslmode=require'
    );
  }

  url = url.replace(/^textpostgres:\/\//i, 'postgresql://');
  if (/^postgres:\/\//i.test(url) && !/^postgresql:\/\//i.test(url)) {
    url = url.replace(/^postgres:\/\//i, 'postgresql://');
  }

  if (!/^postgresql:\/\//i.test(url)) {
    throw new Error(
      'DATABASE_URL must use postgres:// or postgresql://. ' +
        'Check .env.local for typos (e.g. textpostgres://).'
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(
      'DATABASE_URL is malformed — verify username, password, host, and port in .env.local.'
    );
  }

  if (!parsed.hostname) {
    throw new Error('DATABASE_URL is missing a hostname. Example host: db.prisma.io');
  }

  const isLocal =
    parsed.hostname === 'localhost' ||
    parsed.hostname === '127.0.0.1' ||
    parsed.hostname === '::1';

  if (!isLocal && !parsed.searchParams.has('sslmode')) {
    parsed.searchParams.set('sslmode', 'require');
  }

  return parsed.toString();
}

function resolveDatabaseUrlFromEnv(): string {
  const raw = process.env.DATABASE_URL;
  if (!raw?.trim()) {
    throw new Error(
      'DATABASE_URL is not set. Add it to .env.local (see .env.example). ' +
        'Remote Prisma example: postgresql://USER:PASSWORD@db.prisma.io:5432/postgres?sslmode=require'
    );
  }
  return normalizeDatabaseUrl(raw);
}

/** Safe connection summary — never includes credentials. */
function describeDatabaseTarget(connectionUrl: string): DatabaseTarget {
  const parsed = new URL(connectionUrl);
  return {
    protocol: parsed.protocol.replace(':', ''),
    hostname: parsed.hostname,
    port: parsed.port || '5432',
    database: parsed.pathname.replace(/^\//, '') || 'postgres',
    sslmode: parsed.searchParams.get('sslmode') ?? 'not set',
  };
}

function formatDatabaseTarget(target: DatabaseTarget): string {
  return `${target.protocol}://${target.hostname}:${target.port}/${target.database} (sslmode=${target.sslmode})`;
}

async function initPrismaFromEnvironment(): Promise<PrismaClient | null> {
  try {
    resolvedDatabaseUrl = resolveDatabaseUrlFromEnv();
    process.env.DATABASE_URL = resolvedDatabaseUrl;

    const target = describeDatabaseTarget(resolvedDatabaseUrl);
    console.log(
      `  ${c.dim}Database target: ${target.hostname}:${target.port}/${target.database} · sslmode=${target.sslmode}${c.reset}`
    );

    // Dedicated client with explicit datasource — avoids stale singleton from src/lib/db.
    return new PrismaClient({
      datasources: { db: { url: resolvedDatabaseUrl } },
      log: ['error'],
    });
  } catch (error) {
    databaseConfigError =
      error instanceof Error ? error.message : 'DATABASE_URL is missing or invalid';
    console.log(`  ${c.red}Database config error: ${databaseConfigError}${c.reset}`);
    return null;
  }
}

function listRouteFiles(dir: string): string[] {
  const entries: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = resolve(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) entries.push(...listRouteFiles(full));
    else if (name === 'route.ts') entries.push(full);
  }
  return entries;
}

// ─── Check implementations ─────────────────────────────────────────────────────

async function checkEnvironment(): Promise<void> {
  section('Environment Validation');

  const env = validateEnvironment({ production: true });
  if (env.valid) {
    record('Environment', 'Required environment variables', 'pass', 'DATABASE_URL, ENCRYPTION_KEY, SESSION_SECRET present');
  } else {
    record('Environment', 'Required environment variables', 'fail', `Missing: ${env.missing.join(', ')}`);
  }

  const blockingWarnings = env.warnings.filter(
    (w) => w.includes('NEXT_PUBLIC_*') || w.includes('shorter than')
  );
  if (blockingWarnings.length === 0 && env.warnings.length === 0) {
    record('Environment', 'Environment warnings', 'pass', 'No configuration warnings');
  } else if (blockingWarnings.length > 0) {
    record('Environment', 'Environment warnings', 'fail', blockingWarnings.join('; '), true);
  } else {
    record('Environment', 'Environment warnings', 'warn', env.warnings.join('; '), false);
  }

  if (isMaintenanceModeEnabled()) {
    record('Environment', 'Maintenance mode disabled', 'fail', 'MERLIN_MAINTENANCE_MODE is enabled — disable before rollout');
  } else {
    record('Environment', 'Maintenance mode disabled', 'pass', 'MERLIN_MAINTENANCE_MODE is off');
  }

  const commit = getBuildCommit();
  const buildDate = getBuildDate();
  const parsedDate = Date.parse(buildDate);
  if (!commit || commit === 'unknown') {
    record('Environment', 'Build commit stamped', 'warn', `Commit is "${commit}" — set NEXT_PUBLIC_BUILD_COMMIT or deploy from git`, false);
  } else {
    record('Environment', 'Build commit stamped', 'pass', `Commit: ${commit}`);
  }

  if (Number.isNaN(parsedDate)) {
    record('Environment', 'Build date stamped', 'fail', `Invalid build date: ${buildDate}`);
  } else if (commit === 'dev') {
    record('Environment', 'Build date stamped', 'warn', `Date: ${buildDate} (local dev build)`, false);
  } else {
    record('Environment', 'Build date stamped', 'pass', `Built: ${new Date(parsedDate).toISOString()}`);
  }

  if (resolvedDatabaseUrl) {
    const target = describeDatabaseTarget(resolvedDatabaseUrl);
    const isLocal = target.hostname === 'localhost' || target.hostname === '127.0.0.1';
    if (isLocal) {
      record(
        'Environment',
        'DATABASE_URL target host',
        'warn',
        `${target.hostname}:${target.port} — use db.prisma.io (or production host) for rollout`,
        false
      );
    } else {
      record(
        'Environment',
        'DATABASE_URL target host',
        'pass',
        `${target.hostname}:${target.port}/${target.database} (sslmode=${target.sslmode})`
      );
    }
  } else if (databaseConfigError) {
    record('Environment', 'DATABASE_URL target host', 'fail', databaseConfigError);
  }
}

async function checkCoreSystems(): Promise<void> {
  section('Core System Health');

  if (!prisma) {
    record(
      'Core Systems',
      'Database connection',
      'fail',
      databaseConfigError ??
        'DATABASE_URL not configured — add a valid PostgreSQL URL to .env.local'
    );
  } else {
    const target = resolvedDatabaseUrl
      ? describeDatabaseTarget(resolvedDatabaseUrl)
      : null;
    const targetLabel = target ? `${target.hostname}:${target.port}` : 'unknown host';

    try {
      console.log(`  ${c.dim}Connecting to ${targetLabel}…${c.reset}`);
      const started = Date.now();
      const result = await prisma.$queryRaw<Array<{ ok: number }>>`SELECT 1 AS ok`;
      const elapsed = Date.now() - started;
      const ok = result?.[0]?.ok === 1;
      if (!ok) {
        record('Core Systems', 'Database connection', 'fail', `Query to ${targetLabel} returned unexpected result`);
      } else {
        record(
          'Core Systems',
          'Database connection',
          'pass',
          `Connected to ${targetLabel}/${target?.database ?? 'postgres'} in ${elapsed}ms (sslmode=${target?.sslmode ?? 'n/a'})`
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Connection failed';
      console.log(`  ${c.red}Connection to ${targetLabel} failed${c.reset}`);
      let hint = ' Check DATABASE_URL in .env.local.';
      if (message.includes('localhost') || target?.hostname === 'localhost') {
        hint = ' DATABASE_URL still points at localhost — set your remote db.prisma.io URL in .env.local.';
      } else if (target?.hostname.includes('prisma.io')) {
        hint = ' Confirm Prisma Data Platform credentials and that the database is active.';
      } else if (!resolvedDatabaseUrl?.includes('sslmode=')) {
        hint = ' Remote hosts need ?sslmode=require on DATABASE_URL.';
      }
      record('Core Systems', 'Database connection', 'fail', `${message}${hint}`);
    }
  }

  try {
    const sample = `merlin-pre-rollout-${Date.now()}`;
    const encrypted = encryptPII(sample);
    const decrypted = decryptPII(encrypted);
    if (decrypted !== sample) {
      record('Core Systems', 'AES-256 encryption round-trip', 'fail', 'Decrypt mismatch');
    } else {
      record('Core Systems', 'AES-256 encryption round-trip', 'pass', 'encryptPII / decryptPII OK');
    }
  } catch (error) {
    record(
      'Core Systems',
      'AES-256 encryption round-trip',
      'fail',
      error instanceof Error ? error.message : 'Encryption failed'
    );
  }

  try {
    const first: AuditChainPayload = {
      id: 'pre-rollout-audit-1',
      action: 'story.generate',
      entityType: 'repairLine',
      entityId: 'line-pre-rollout',
      technicianId: 'tech-pre-rollout',
      dealershipId: 'dealer-pre-rollout',
      metadata: JSON.stringify({ repairOrderId: 'ro-pre-rollout', promptVersion: PROMPT_VERSION }),
      ipAddress: '127.0.0.1',
      createdAt: new Date().toISOString(),
      previousHash: AUDIT_GENESIS_HASH,
      promptVersion: PROMPT_VERSION,
    };
    const firstHash = computeAuditEntryHash(first);
    const second: AuditChainPayload = {
      ...first,
      id: 'pre-rollout-audit-2',
      previousHash: firstHash,
      createdAt: new Date(Date.now() + 1000).toISOString(),
    };
    const secondHash = computeAuditEntryHash(second);
    const chain = verifyAuditChain([
      { ...first, entryHash: firstHash },
      { ...second, entryHash: secondHash },
    ]);
    if (!chain.valid) {
      record('Core Systems', 'Audit chain integrity', 'fail', `Chain broken at index ${chain.brokenAt}`);
    } else {
      record('Core Systems', 'Audit chain integrity', 'pass', 'Hash chain create → verify OK');
    }

    const tampered = { ...first, entryHash: firstHash, promptVersion: 'tampered' };
    const bad = verifyAuditChain([tampered]);
    if (bad.valid) {
      record('Core Systems', 'Audit tamper detection', 'fail', 'Tampered entry was accepted');
    } else {
      record('Core Systems', 'Audit tamper detection', 'pass', 'Tampered promptVersion correctly rejected');
    }
  } catch (error) {
    record(
      'Core Systems',
      'Audit chain integrity',
      'fail',
      error instanceof Error ? error.message : 'Audit chain test failed'
    );
  }

  if (PROMPT_VERSION && /^\d+\.\d+\.\d+$/.test(PROMPT_VERSION)) {
    const config = getRuntimeConfig(PROMPT_VERSION);
    record(
      'Core Systems',
      'Prompt version loaded',
      'pass',
      `PROMPT_VERSION=${PROMPT_VERSION} (app v${config.appVersion})`
    );
  } else {
    record('Core Systems', 'Prompt version loaded', 'fail', `Invalid PROMPT_VERSION: ${PROMPT_VERSION}`);
  }

  if (SYSTEM_PROMPT.includes(PROMPT_VERSION)) {
    record('Core Systems', 'Prompt version in SYSTEM_PROMPT', 'pass', 'Warranty story system prompt references version');
  } else {
    record('Core Systems', 'Prompt version in SYSTEM_PROMPT', 'fail', 'SYSTEM_PROMPT missing PROMPT_VERSION');
  }
}

async function checkCustomerPayTemplates(): Promise<void> {
  section('Customer Pay Templates');

  if (CUSTOMER_PAY_TEMPLATES.length >= 12) {
    record(
      'Customer Pay',
      'Template library size',
      'pass',
      `${CUSTOMER_PAY_TEMPLATES.length} instant Customer Pay templates defined`
    );
  } else {
    record(
      'Customer Pay',
      'Template library size',
      'fail',
      `Expected ≥12 Customer Pay templates, found ${CUSTOMER_PAY_TEMPLATES.length}`
    );
  }

  const sample = CUSTOMER_PAY_TEMPLATES[0];
  const hasStructure =
    !!sample?.preWrittenStory?.trim().startsWith('Performed') &&
    CUSTOMER_PAY_TEMPLATES.every((t) => t.preWrittenStory.trim().length > 80);
  if (hasStructure) {
    record('Customer Pay', 'Template story structure', 'pass', 'Polished correction narratives on pre-written stories');
  } else {
    record('Customer Pay', 'Template story structure', 'fail', 'Missing polished pre-written story content');
  }

  if (
    CUSTOMER_PAY_AUDIT_ACTIONS.has('customerPayTemplateApplied') &&
    !STORY_PROMPT_AUDIT_ACTIONS.has('customerPayTemplateApplied')
  ) {
    record(
      'Customer Pay',
      'Audit action separation',
      'pass',
      `customerPayTemplateApplied uses sentinel (not Merlin prompt) — ${AUDIT_CUSTOMER_PAY_SENTINEL}`
    );
  } else {
    record(
      'Customer Pay',
      'Audit action separation',
      'fail',
      'customerPayTemplateApplied must bypass Merlin story prompt audit actions'
    );
  }

  const cpModule = readFileSync(
    resolve(process.cwd(), 'src/lib/customerPayTemplate.ts'),
    'utf8'
  );
  if (cpModule.includes('No Grok') || cpModule.includes('bypasses Grok')) {
    record(
      'Customer Pay',
      'AI bypass documented in code',
      'pass',
      'customerPayTemplate.ts documents compliance bypass'
    );
  } else {
    record('Customer Pay', 'AI bypass documented in code', 'warn', 'Add bypass comments to customerPayTemplate.ts', false);
  }
}

async function checkCriticalAuditFixes(): Promise<void> {
  section('Critical Audit Fixes (C1–C7)');

  const validationSrc = readFileSync(resolve(process.cwd(), 'src/lib/validation.ts'), 'utf8');
  if (validationSrc.includes('isCustomerPay: z.boolean().optional()')) {
    record('Critical Fixes', 'C1 repairLineSchema isCustomerPay', 'pass', 'Schema preserves Customer Pay flag');
  } else {
    record('Critical Fixes', 'C1 repairLineSchema isCustomerPay', 'fail', 'Missing isCustomerPay on repairLineSchema');
  }

  const roPutSrc = readFileSync(
    resolve(process.cwd(), 'src/app/api/repair-orders/[id]/route.ts'),
    'utf8'
  );
  if (roPutSrc.includes('existingLine?.isCustomerPay') && roPutSrc.includes('isCustomerPay,')) {
    record('Critical Fixes', 'C1 PUT merges isCustomerPay', 'pass', 'RO update merges persisted Customer Pay flag');
  } else {
    record('Critical Fixes', 'C1 PUT merges isCustomerPay', 'fail', 'PUT handler does not merge isCustomerPay from DB');
  }

  const auditSrc = readFileSync(resolve(process.cwd(), 'src/lib/audit.ts'), 'utf8');
  const criticalActionsOk =
    CRITICAL_AUDIT_ACTIONS.has('story.generate') &&
    CRITICAL_AUDIT_ACTIONS.has('customerPayTemplateApplied') &&
    auditSrc.includes('CRITICAL_AUDIT_ACTIONS.has(input.action)');
  if (criticalActionsOk) {
    record('Critical Fixes', 'C2 critical audit rethrow', 'pass', 'Compliance-critical audit failures abort operation');
  } else {
    record('Critical Fixes', 'C2 critical audit rethrow', 'fail', 'writeAuditLog must rethrow for CRITICAL_AUDIT_ACTIONS');
  }

  const generateSrc = readFileSync(
    resolve(
      process.cwd(),
      'src/app/api/repair-orders/[id]/lines/[lineId]/generate-story/route.ts'
    ),
    'utf8'
  );
  const auditBeforeUpdate =
    generateSrc.indexOf("action: 'story.generate'") !== -1 &&
    generateSrc.indexOf('repairLine.update') !== -1 &&
    generateSrc.indexOf("action: 'story.generate'") < generateSrc.indexOf('repairLine.update');
  if (auditBeforeUpdate) {
    record('Critical Fixes', 'C3 audit before story persist', 'pass', 'story.generate audit precedes repairLine.update');
  } else {
    record('Critical Fixes', 'C3 audit before story persist', 'fail', 'Generate route must audit before DB story write');
  }

  const securityStatusSrc = readFileSync(
    resolve(process.cwd(), 'src/app/api/auth/security-status/route.ts'),
    'utf8'
  );
  if (securityStatusSrc.includes('withAuth(') && securityStatusSrc.includes('requireManager: true')) {
    record('Critical Fixes', 'C4 security-status auth', 'pass', 'Seed password status requires manager session');
  } else {
    record('Critical Fixes', 'C4 security-status auth', 'fail', '/api/auth/security-status must use withAuth + requireManager');
  }

  const healthSrc = readFileSync(resolve(process.cwd(), 'src/app/api/health/route.ts'), 'utf8');
  const healthChecksSrc = readFileSync(resolve(process.cwd(), 'src/lib/healthChecks.ts'), 'utf8');
  const healthOk =
    healthSrc.includes('withAuth(') &&
    healthSrc.includes('runAuthenticatedHealthChecks') &&
    !healthChecksSrc.includes('api.x.ai/v1/chat/completions');
  if (healthOk) {
    record('Critical Fixes', 'C5 health endpoint hardened', 'pass', 'Manager auth + no live Grok probe in health');
  } else {
    record('Critical Fixes', 'C5 health endpoint hardened', 'fail', 'Health route must be authenticated without live Grok calls');
  }

  const voiceCoordSrc = readFileSync(
    resolve(process.cwd(), 'src/lib/voice/voiceSessionCoordinator.ts'),
    'utf8'
  );
  const voiceServiceSrc = readFileSync(resolve(process.cwd(), 'src/lib/voice/VoiceInputService.ts'), 'utf8');
  if (voiceCoordSrc.includes('claimVoiceSession') && voiceServiceSrc.includes('claimVoiceSession')) {
    record('Critical Fixes', 'C6 voice session mutex', 'pass', 'Global coordinator stops competing mic sessions');
  } else {
    record('Critical Fixes', 'C6 voice session mutex', 'fail', 'Missing voice session coordinator integration');
  }

  const errorsSrc = readFileSync(resolve(process.cwd(), 'src/lib/voice/errors.ts'), 'utf8');
  const voiceLifecycleOk =
    voiceServiceSrc.includes('disposeRecognition') &&
    voiceServiceSrc.includes('supersedingRecognition') &&
    !errorsSrc.includes("code === 'no-speech' || code === 'network' || code === 'aborted'");
  if (voiceLifecycleOk) {
    record('Critical Fixes', 'C7 voice lifecycle cleanup', 'pass', 'Handlers detached before abort; no aborted auto-restart');
  } else {
    record('Critical Fixes', 'C7 voice lifecycle cleanup', 'fail', 'VoiceInputService lifecycle fixes incomplete');
  }
}

async function checkHighPriorityAuditFixes(): Promise<void> {
  section('High Priority Audit Fixes (H1–H15)');

  const customerPayLineSrc = readFileSync(resolve(process.cwd(), 'src/lib/customerPayLine.ts'), 'utf8');
  if (customerPayLineSrc.includes('isCustomerPayRepairLine')) {
    record('High Priority', 'H1 shared Customer Pay helper', 'pass', 'client/server use isCustomerPayRepairLine');
  } else {
    record('High Priority', 'H1 shared Customer Pay helper', 'fail', 'Missing customerPayLine helper');
  }

  const queueSrc = readFileSync(resolve(process.cwd(), 'src/lib/repairOrderSaveQueue.ts'), 'utf8');
  if (queueSrc.includes('enqueueRepairOrderSave') && readFileSync(resolve(process.cwd(), 'src/hooks/useRepairOrders.ts'), 'utf8').includes('await flushPendingSave()')) {
    record('High Priority', 'H2 save queue serialization', 'pass', 'Awaitable flush + serialized RO saves');
  } else {
    record('High Priority', 'H2 save queue serialization', 'fail', 'Save race around Customer Pay apply not fixed');
  }

  const auditSrc = readFileSync(resolve(process.cwd(), 'src/lib/audit.ts'), 'utf8');
  const putSrc = readFileSync(resolve(process.cwd(), 'src/app/api/repair-orders/[id]/route.ts'), 'utf8');
  if (auditSrc.includes('customerPayStory.edit') && putSrc.includes("action: 'customerPayStory.edit'")) {
    record('High Priority', 'H3 CP story edit audit', 'pass', 'customerPayStory.edit replaces Merlin story.edit for CP lines');
  } else {
    record('High Priority', 'H3 CP story edit audit', 'fail', 'Customer Pay edits still use story.edit');
  }

  const latestSrc = readFileSync(resolve(process.cwd(), 'src/app/api/audit-logs/latest/route.ts'), 'utf8');
  const pdfSrc = readFileSync(resolve(process.cwd(), 'src/app/api/audit-logs/pdf-export/route.ts'), 'utf8');
  if (latestSrc.includes('customerPayTemplateApplied') && pdfSrc.includes('customerPayStory.pdf_export')) {
    record('High Priority', 'H4 CP PDF/latest audit', 'pass', 'Latest hash + PDF export respect Customer Pay actions');
  } else {
    record('High Priority', 'H4 CP PDF/latest audit', 'fail', 'Customer Pay PDF/latest audit incomplete');
  }

  if (auditSrc.includes('pg_advisory_xact_lock')) {
    record('High Priority', 'H5 audit chain locking', 'pass', 'Per-dealership advisory lock on audit append');
  } else {
    record('High Priority', 'H5 audit chain locking', 'fail', 'Missing audit chain concurrency guard');
  }

  const encSrc = readFileSync(resolve(process.cwd(), 'src/lib/encryption.ts'), 'utf8');
  if (encSrc.includes('encryption.decrypt_failed') && encSrc.includes('getScryptSalt')) {
    record('High Priority', 'H6/H7 encryption hardening', 'pass', 'Loud decrypt failures + derived scrypt salt');
  } else {
    record('High Priority', 'H6/H7 encryption hardening', 'fail', 'Encryption fixes incomplete');
  }

  const envSrc = readFileSync(resolve(process.cwd(), 'src/lib/env.ts'), 'utf8');
  const rateSrc = readFileSync(resolve(process.cwd(), 'src/lib/rate-limit.ts'), 'utf8');
  if (envSrc.includes('PRODUCTION_REQUIRED_ENV_VARS') && rateSrc.includes('effectiveRateLimitConfig')) {
    record('High Priority', 'H8 KV rate limiting', 'pass', 'KV required in production + stricter memory fallback');
  } else {
    record('High Priority', 'H8 KV rate limiting', 'fail', 'Rate limit production hardening incomplete');
  }

  const imageSrc = readFileSync(resolve(process.cwd(), 'src/lib/imageAccess.ts'), 'utf8');
  if (imageSrc.includes('repairOrderContainsPathname') && imageSrc.includes('findFirst')) {
    record('High Priority', 'H9 image access query', 'pass', 'Targeted pathname lookup (no full RO scan)');
  } else {
    record('High Priority', 'H9 image access query', 'fail', 'Image access still scans all repair orders');
  }

  const listSrc = readFileSync(resolve(process.cwd(), 'src/app/api/repair-orders/route.ts'), 'utf8');
  if (listSrc.includes('nextCursor') && listSrc.includes('hasMore')) {
    record('High Priority', 'H10 RO list pagination', 'pass', 'Cursor-based repair order listing');
  } else {
    record('High Priority', 'H10 RO list pagination', 'fail', 'Repair order list still unbounded');
  }

  const seedDb = readFileSync(resolve(process.cwd(), 'src/lib/seedDatabase.ts'), 'utf8');
  if (!seedDb.includes('changeme123')) {
    record('High Priority', 'H11 seed credentials', 'pass', 'No hardcoded default technician password');
  } else {
    record('High Priority', 'H11 seed credentials', 'fail', 'Hardcoded seed password still present');
  }

  const noiseSrc = readFileSync(resolve(process.cwd(), 'src/lib/voice/noiseMonitor.ts'), 'utf8');
  if (noiseSrc.includes('EMIT_INTERVAL_MS = 250')) {
    record('High Priority', 'H12 noise throttle', 'pass', 'Noise monitor emits at 4 Hz max');
  } else {
    record('High Priority', 'H12 noise throttle', 'fail', 'Noise monitor not throttled');
  }

  const voiceSrc = readFileSync(resolve(process.cwd(), 'src/lib/voice/VoiceInputService.ts'), 'utf8');
  if (voiceSrc.includes('if (!started)') && voiceSrc.includes('noiseMonitor.stop')) {
    record('High Priority', 'H13 voice cleanup', 'pass', 'Noise monitor stopped when recognition fails');
  } else {
    record('High Priority', 'H13 voice cleanup', 'fail', 'Voice start failure cleanup incomplete');
  }

  const cpTpl = readFileSync(resolve(process.cwd(), 'src/lib/customerPayTemplate.ts'), 'utf8');
  if (cpTpl.includes('if (!template.isCustomerPay)')) {
    record('High Priority', 'H14 template eligibility', 'pass', 'Customer Pay bypass requires isCustomerPay=true');
  } else {
    record('High Priority', 'H14 template eligibility', 'fail', 'Loose template eligibility still present');
  }

  const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as {
    scripts?: { build?: string; 'db:migrate:deploy'?: string };
  };
  const buildScript = pkg.scripts?.build ?? '';
  if (
    !buildScript.includes('prisma migrate deploy') &&
    pkg.scripts?.['db:migrate:deploy']?.includes('prisma migrate deploy')
  ) {
    record('High Priority', 'H15 build migrations', 'pass', 'Build no longer runs prisma migrate deploy');
  } else {
    record('High Priority', 'H15 build migrations', 'fail', 'Build still auto-runs migrations');
  }
}

async function checkCoreFeatures(): Promise<void> {
  section('Core Feature Tests');

  try {
    const sampleStory = normalizeWarrantyStoryText(
      'Customer states check engine light is on.\n\nPerformed source voltage check and connected battery charger. ' +
        'Connected XENTRY and performed Quick Test. Found fault code P0300. Replaced ignition coils and cleared codes. ' +
        'Final test drive confirmed repair.'
    );
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text('Merlin Pre-Rollout PDF Test', 45, 45);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    const lines = doc.splitTextToSize(sampleStory, 500);
    doc.text(lines, 45, 70);
    const output = doc.output('arraybuffer') as ArrayBuffer;
    if (output.byteLength < 400) {
      record('Core Features', 'PDF generation', 'fail', `PDF buffer too small (${output.byteLength} bytes)`);
    } else {
      record('Core Features', 'PDF generation', 'pass', `jsPDF produced ${output.byteLength} byte document`);
    }
  } catch (error) {
    record('Core Features', 'PDF generation', 'fail', error instanceof Error ? error.message : 'PDF build failed');
  }

  if (VOICE_INPUT_SETTINGS.enabled) {
    record(
      'Core Features',
      'Voice input configuration',
      'pass',
      `Enabled (${VOICE_INPUT_SETTINGS.language}, timeout ${VOICE_INPUT_SETTINGS.listeningTimeoutMs}ms)`
    );
  } else {
    record('Core Features', 'Voice input configuration', 'warn', 'Voice disabled in dealership settings', false);
  }

  record(
    'Core Features',
    'Voice browser support (Node runtime)',
    'warn',
    'Web Speech API requires Chrome/Edge on tablet — verify mic permission manually on shop floor',
    false
  );

  {
    const nextCfg = existsSync(resolve(process.cwd(), 'next.config.mjs'))
      ? readFileSync(resolve(process.cwd(), 'next.config.mjs'), 'utf8')
      : '';
    const micOk = nextCfg.includes('microphone=(self)');
    record(
      'Core Features',
      'Voice microphone CSP policy',
      micOk ? 'pass' : 'fail',
      micOk
        ? 'Permissions-Policy allows microphone=(self) for shop-floor tablets'
        : 'Add microphone=(self) to Permissions-Policy in next.config.mjs'
    );
  }

  try {
    const ro = createRepairOrderFromScan({
      roNumber: 'PRE-ROLLOUT',
      vehicle: { vin: 'WDDGF4HB0CA000000', year: '2022', make: 'Mercedes-Benz', model: 'C300', mileageIn: '45000', mileageOut: '' },
      customerName: 'PRE-ROLLOUT TEST',
      complaints: ['CHECK ENGINE LIGHT ON'],
      complaintLabels: ['A'],
    });
    const line = ro.repairLines[0];
    line.technicianNotes = 'Quick Test found P0300. Replaced coils.';
    const userMessage = buildWarrantyStoryUserMessage(ro, line);
    if (!userMessage.includes('CHECK ENGINE') || userMessage.length < 200) {
      record('Core Features', 'Story prompt assembly', 'fail', 'buildWarrantyStoryUserMessage output incomplete');
    } else {
      record('Core Features', 'Story prompt assembly', 'pass', `User prompt ${userMessage.length} chars with complaint context`);
    }

    if (RATE_LIMITS.generate.limit === 20 && RATE_LIMITS.generate.windowMs === 60_000) {
      record(
        'Core Features',
        'AI rate limiting configuration',
        'pass',
        `Per-IP: ${RATE_LIMITS.generate.limit}/min · Daily cap enforced via UsageLog`
      );
    } else {
      record('Core Features', 'AI rate limiting configuration', 'fail', 'Rate limit constants misconfigured');
    }
  } catch (error) {
    record(
      'Core Features',
      'Story prompt assembly',
      'fail',
      error instanceof Error ? error.message : 'Prompt build failed'
    );
  }

  try {
    // Lightweight in-process service matrix (avoids server-only Grok ping from healthChecks bundle).
    const serviceChecks: Record<string, { status: string; detail: string }> = {
      environment: validateEnvironment({ production: true }).valid
        ? { status: 'ok', detail: 'required env present' }
        : { status: 'error', detail: 'missing required env' },
      database: { status: 'pending', detail: '' },
      encryption: { status: 'pending', detail: '' },
      voice: VOICE_INPUT_SETTINGS.enabled
        ? { status: 'ok', detail: `voice enabled (${VOICE_INPUT_SETTINGS.language})` }
        : { status: 'warn', detail: 'voice disabled in config' },
      maintenance: isMaintenanceModeEnabled()
        ? { status: 'warn', detail: 'maintenance mode active' }
        : { status: 'ok', detail: 'normal operation' },
      grok: process.env.GROK_API_KEY?.trim()
        ? { status: 'ok', detail: 'GROK_API_KEY configured' }
        : { status: 'warn', detail: 'GROK_API_KEY not set — AI disabled' },
      kv: isKvConfigured()
        ? { status: 'ok', detail: 'KV configured' }
        : { status: 'warn', detail: 'KV not configured' },
    };

    if (!prisma) {
      serviceChecks.database = {
        status: 'error',
        detail: databaseConfigError ?? 'DATABASE_URL not configured',
      };
    } else {
      try {
        await prisma.$queryRaw`SELECT 1`;
        serviceChecks.database = { status: 'ok', detail: 'SELECT 1 OK' };
      } catch (error) {
        serviceChecks.database = {
          status: 'error',
          detail: error instanceof Error ? error.message : 'DB failed',
        };
      }
    }

    try {
      const probe = encryptPII('health-probe');
      decryptPII(probe);
      serviceChecks.encryption = { status: 'ok', detail: 'round-trip OK' };
    } catch (error) {
      serviceChecks.encryption = {
        status: 'error',
        detail: error instanceof Error ? error.message : 'encryption failed',
      };
    }

    const errors = Object.entries(serviceChecks).filter(([, v]) => v.status === 'error');
    const warns = Object.entries(serviceChecks).filter(([, v]) => v.status === 'warn');

    if (errors.length > 0) {
      record(
        'Core Features',
        'In-process health checks',
        'fail',
        errors.map(([k, v]) => `${k}=${v.detail}`).join('; ')
      );
    } else if (warns.length > 0) {
      record(
        'Core Features',
        'In-process health checks',
        'warn',
        warns.map(([k, v]) => `${k}=${v.detail}`).join('; '),
        false
      );
    } else {
      record('Core Features', 'In-process health checks', 'pass', 'All in-process services OK');
    }

    const baseUrl = process.env.MERLIN_BASE_URL?.replace(/\/$/, '');
    if (baseUrl) {
      const started = Date.now();
      const res = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(20_000) });
      const body = (await res.json()) as {
        status?: string;
        services?: Record<string, string>;
      };
      if (!res.ok || body.status === 'error') {
        record(
          'Core Features',
          'Live /api/health endpoint',
          'fail',
          `HTTP ${res.status} status=${body.status ?? 'unknown'}`
        );
      } else if (body.status === 'degraded') {
        record(
          'Core Features',
          'Live /api/health endpoint',
          'warn',
          `HTTP ${res.status} degraded in ${Date.now() - started}ms`,
          false
        );
      } else {
        const svc = body.services ? Object.entries(body.services).map(([k, v]) => `${k}=${v}`).join(', ') : 'n/a';
        record(
          'Core Features',
          'Live /api/health endpoint',
          'pass',
          `${baseUrl}/api/health → ${body.status} (${Date.now() - started}ms) [${svc}]`
        );
      }
    } else {
      record(
        'Core Features',
        'Live /api/health endpoint',
        'warn',
        'Set MERLIN_BASE_URL to test deployed /api/health (in-process checks ran above)',
        false
      );
    }
  } catch (error) {
    record(
      'Core Features',
      'Health endpoint check',
      'fail',
      error instanceof Error ? error.message : 'Health check failed'
    );
  }
}

const REQUIRED_ROLLOUT_DOCS = [
  'Master-Rollout-Document.md',
  'Technician-Quick-Start.md',
  'Bay-Reference-Card.md',
  'Bay-Reference-Card-Front.md',
  'Bay-Reference-Card-Back.md',
  'Admin-Setup-Guide.md',
  'Rollout-Checklist.md',
  'Training-Outline.md',
  'Go-Live-Checklist.md',
  'Go-Live-Email-Template.md',
  'Go-Live-Summary.md',
  'Support-Playbook.md',
];

const RECOMMENDED_DOC_IMAGES = [
  'technician-login-ro-list.png',
  'technician-voice-modes.png',
  'technician-voice-panel.png',
  'technician-notes-voice.png',
  'technician-generate-story.png',
  'technician-story-actions.png',
];

async function checkDocumentation(): Promise<void> {
  section('Rollout Documentation');

  const docsDir = resolve(process.cwd(), 'docs');
  const missingDocs = REQUIRED_ROLLOUT_DOCS.filter((name) => !existsSync(resolve(docsDir, name)));

  if (missingDocs.length === 0) {
    record(
      'Documentation',
      'Required rollout documents',
      'pass',
      `${REQUIRED_ROLLOUT_DOCS.length} files present in docs/`
    );
  } else {
    record(
      'Documentation',
      'Required rollout documents',
      'fail',
      `Missing: ${missingDocs.join(', ')}`
    );
  }

  const readmePath = resolve(process.cwd(), 'README.md');
  if (existsSync(readmePath)) {
    const readme = readFileSync(readmePath, 'utf8');
    const linksMaster = readme.includes('Master-Rollout-Document.md');
    const linksBayCard = readme.includes('Bay-Reference-Card.md');
    if (linksMaster && linksBayCard) {
      record(
        'Documentation',
        'README documentation index',
        'pass',
        'README links Master Rollout Document and Bay Reference Card'
      );
    } else {
      record(
        'Documentation',
        'README documentation index',
        'fail',
        'README missing links to key rollout documents'
      );
    }
  } else {
    record('Documentation', 'README documentation index', 'fail', 'README.md not found');
  }

  const imagesDir = resolve(docsDir, 'images');
  if (!existsSync(imagesDir)) {
    record(
      'Documentation',
      'Technician guide screenshots',
      'warn',
      'docs/images/ not found — add screenshots before printing Technician Quick Start',
      false
    );
  } else {
    const missingImages = RECOMMENDED_DOC_IMAGES.filter(
      (name) => !existsSync(resolve(imagesDir, name))
    );
    if (missingImages.length === 0) {
      record(
        'Documentation',
        'Technician guide screenshots',
        'pass',
        `All ${RECOMMENDED_DOC_IMAGES.length} recommended images present`
      );
    } else {
      record(
        'Documentation',
        'Technician guide screenshots',
        'warn',
        `Missing ${missingImages.length}/${RECOMMENDED_DOC_IMAGES.length} images — OK for launch; add before print distribution`,
        false
      );
    }
  }
}

async function checkSecurityAndConfig(): Promise<void> {
  section('Security & Configuration');

  const nextConfigPath = resolve(process.cwd(), 'next.config.mjs');
  const nextConfig = existsSync(nextConfigPath) ? readFileSync(nextConfigPath, 'utf8') : '';

  const cspRequirements = [
    "default-src 'self'",
    'frame-ancestors \'none\'',
    "object-src 'none'",
    'microphone=(self)',
    'Strict-Transport-Security',
  ];
  const missingCsp = cspRequirements.filter((req) => !nextConfig.includes(req));
  if (missingCsp.length === 0) {
    record('Security', 'CSP & security headers config', 'pass', 'next.config.mjs includes required directives');
  } else {
    record('Security', 'CSP & security headers config', 'fail', `Missing in next.config.mjs: ${missingCsp.join(', ')}`);
  }

  const grokRoutes = [
    'src/app/api/repair-orders/[id]/lines/[lineId]/generate-story/route.ts',
    'src/app/api/repair-orders/[id]/lines/[lineId]/review-story/route.ts',
    'src/app/api/repair-orders/extract/route.ts',
    'src/app/api/diagnostics/extract/route.ts',
  ];
  const rateLimitFailures: string[] = [];
  for (const rel of grokRoutes) {
    const content = readFileSync(resolve(process.cwd(), rel), 'utf8');
    if (!content.includes('trackUsage: true')) {
      rateLimitFailures.push(`${rel} missing trackUsage`);
    }
    if (!content.includes('RATE_LIMITS.generate') && !content.includes('rateLimit:')) {
      rateLimitFailures.push(`${rel} missing rate limit config`);
    }
  }
  if (rateLimitFailures.length === 0) {
    record(
      'Security',
      'Grok route rate limiting',
      'pass',
      `All ${grokRoutes.length} AI routes have trackUsage + per-IP limits`
    );
  } else {
    record('Security', 'Grok route rate limiting', 'fail', rateLimitFailures.join('; '));
  }

  if (isKvConfigured()) {
    record('Security', 'Distributed rate limiting (KV)', 'pass', 'KV_REST_API_URL and token configured');
  } else {
    record(
      'Security',
      'Distributed rate limiting (KV)',
      'warn',
      'KV not configured — rate limits are per-instance only in serverless',
      false
    );
  }

  const apiRoot = resolve(process.cwd(), 'src/app/api');
  const routeFiles = listRouteFiles(apiRoot);
  const publicAllowlist = new Set([
    'status/route.ts',
    'auth/login/route.ts',
    'auth/logout/route.ts',
    'auth/me/route.ts',
    'setup/seed/route.ts',
  ]);
  const unauthenticated: string[] = [];
  for (const file of routeFiles) {
    const rel = file.replace(apiRoot + '\\', '').replace(apiRoot + '/', '').replace(/\\/g, '/');
    const content = readFileSync(file, 'utf8');
    const isPublic = [...publicAllowlist].some((allowed) => rel.endsWith(allowed));
    const hasWithAuth = content.includes('withAuth(');
    const hasManualAuth =
      rel.includes('images/route.ts') && content.includes('getSession');
    if (!isPublic && !hasWithAuth && !hasManualAuth) {
      unauthenticated.push(rel);
    }
  }
  if (unauthenticated.length === 0) {
    record('Security', 'Sensitive route authentication', 'pass', `${routeFiles.length} API routes audited — all protected`);
  } else {
    record('Security', 'Sensitive route authentication', 'fail', `Routes without withAuth: ${unauthenticated.join(', ')}`);
  }

  if (!process.env.NEXT_PUBLIC_GROK_API_KEY && !process.env.NEXT_PUBLIC_XAI_API_KEY) {
    record('Security', 'Grok API key exposure', 'pass', 'No NEXT_PUBLIC_* xAI keys detected');
  } else {
    record('Security', 'Grok API key exposure', 'fail', 'Remove NEXT_PUBLIC_GROK_API_KEY / NEXT_PUBLIC_XAI_API_KEY');
  }
}

// ─── Summary report ────────────────────────────────────────────────────────────

function printSummary(): void {
  const passed = results.filter((r) => r.status === 'pass').length;
  const warned = results.filter((r) => r.status === 'warn').length;
  const failed = results.filter((r) => r.status === 'fail').length;
  const criticalFails = results.filter((r) => r.status === 'fail' && r.critical).length;

  console.log(`\n${c.bold}${'═'.repeat(64)}${c.reset}`);
  console.log(`${c.bold}  MERLIN PRE-ROLLOUT VALIDATION REPORT${c.reset}`);
  console.log(`${c.dim}  ${new Date().toISOString()} · v${getAppVersion()} · prompt ${PROMPT_VERSION}${c.reset}`);
  console.log(`${c.bold}${'═'.repeat(64)}${c.reset}\n`);

  const sections = [...new Set(results.map((r) => r.section))];
  for (const sec of sections) {
    console.log(`${c.bold}${sec}${c.reset}`);
    for (const r of results.filter((x) => x.section === sec)) {
      const color = r.status === 'pass' ? c.green : r.status === 'warn' ? c.yellow : c.red;
      const label = r.status.toUpperCase().padEnd(4);
      console.log(`  ${color}${label}${c.reset} ${r.name}`);
      if (r.detail) console.log(`       ${c.dim}${r.detail}${c.reset}`);
    }
    console.log('');
  }

  console.log(`${c.bold}Totals:${c.reset}  ${c.green}${passed} passed${c.reset}  ${c.yellow}${warned} warnings${c.reset}  ${c.red}${failed} failed${c.reset}`);

  if (criticalFails > 0) {
    console.log(`\n${c.red}${c.bold}✖ ROLLOUT BLOCKED — ${criticalFails} critical check(s) failed.${c.reset}`);
    console.log(`${c.dim}  Fix failures above before deploying to dealership tablets.${c.reset}\n`);
  } else if (warned > 0) {
    console.log(`\n${c.yellow}${c.bold}⚠ ROLLOUT PROCEED WITH CAUTION — ${warned} warning(s).${c.reset}`);
    console.log(`${c.dim}  Review warnings; complete manual tablet tests (voice, PDF, offline).${c.reset}\n`);
  } else {
    console.log(`\n${c.green}${c.bold}✔ ALL CHECKS PASSED — ready for dealership rollout.${c.reset}\n`);
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`\n${c.bold}${c.cyan}Merlin Pre-Rollout Validation${c.reset}`);
  console.log(`${c.dim}Validating deployment readiness for dealership IT…${c.reset}`);

  loadEnvironment();

  if (!process.env.NEXT_PUBLIC_BUILD_COMMIT) {
    try {
      process.env.NEXT_PUBLIC_BUILD_COMMIT = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
    } catch {
      process.env.NEXT_PUBLIC_BUILD_COMMIT = 'dev';
    }
  }
  if (!process.env.NEXT_PUBLIC_BUILD_DATE) {
    process.env.NEXT_PUBLIC_BUILD_DATE = new Date().toISOString();
  }

  prisma = await initPrismaFromEnvironment();

  await checkEnvironment();
  await checkCoreSystems();
  await checkCustomerPayTemplates();
  await checkCriticalAuditFixes();
  await checkHighPriorityAuditFixes();
  await checkCoreFeatures();
  await checkDocumentation();
  await checkSecurityAndConfig();

  printSummary();

  const criticalFails = results.filter((r) => r.status === 'fail' && r.critical).length;
  await prisma?.$disconnect().catch(() => undefined);
  process.exit(criticalFails > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(`\n${c.red}${c.bold}Pre-rollout validation crashed:${c.reset}`, error);
  process.exit(1);
});