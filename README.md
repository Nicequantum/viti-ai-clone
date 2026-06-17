# Benz Tech — Dealership Warranty Documentation Platform

Benz Tech helps authorized Mercedes-Benz dealership service teams create audit-safe warranty stories from repair order data, XENTRY diagnostic evidence, and technician notes. Built for Fixed Operations leadership who need visibility, accountability, and controlled AI assistance — not another clipboard app.

## Who This Is For

| Role | What you get |
|------|----------------|
| **Technician** | Scan ROs, capture diagnostics, generate draft warranty stories, export to clipboard/PDF |
| **Service Manager** | Dealership-wide RO visibility, user administration, audit log with hash-chain integrity, CSV export |
| **Fixed Ops Director** | Pilot-ready platform with encrypted PII, session controls, structured logging, and health monitoring |

## UI Stability (v2.3+)

The dealership UI uses several patterns to keep text editing reliable during voice input and rapid typing:

| Feature | Purpose |
|---------|---------|
| **StableTextarea / StableInput** | Local draft state while a field is focused — prevents parent re-renders from resetting deleted or in-progress text |
| **VoiceInputButton** | Web SpeechRecognition with interim results and cursor preservation on complaints, notes, and warranty story fields |
| **Debounced RO saves** | Editable fields update optimistically in memory; PostgreSQL writes are debounced (~450ms) to reduce lag and race conditions |
| **Sonner toasts** | User-friendly notifications instead of blocking browser dialogs |
| **ErrorBoundary** | Graceful retry UI if a view throws an unexpected error |
| **Image compression** | Photos are resized/compressed client-side before Vercel Blob upload |

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│  Browser (React 19 + Next.js 15)                          │
│  • Tesseract OCR preprocessing (client-side)                │
│  • No API keys in browser                                   │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTPS + httpOnly session cookie
┌──────────────────────────▼──────────────────────────────────┐
│  Next.js API Routes                                         │
│  • JWT sessions with server-side version revocation         │
│  • Zod validation + rate limiting (Vercel KV)               │
│  • Structured JSON logging                                  │
└─────┬──────────┬────────────┬────────────┬──────────────────┘
      │          │            │            │
      ▼          ▼            ▼            ▼
 PostgreSQL  Vercel Blob   xAI Grok    NHTSA vPIC
 (Prisma)    (private)     (server)    (VIN decode)
```

### Security controls

- **Encrypted at rest (AES-256-GCM):** customer name, VIN, RO complaints, per-line customer concerns
- **Private diagnostic images:** stored in Vercel Blob; served only through session-gated `/api/images` proxy
- **Session revocation:** password change, manager reset, deactivation, and logout increment `sessionVersion` — stale cookies stop working immediately
- **Audit hash chain:** each log entry is SHA-256 linked to the prior entry per dealership (tamper-evident, not tamper-proof)
- **Audit-safe AI prompts:** warranty stories use `[NOT DOCUMENTED]` / `[NOT PROVIDED]` instead of fabricated test data

## Quick Start (Development)

### 1. Clone and install

```bash
git clone https://github.com/Nicequantum/Benz-Tech-v2.git
cd Benz-Tech-v2
git checkout v2.3-dealership
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `SESSION_SECRET` | Yes | `openssl rand -base64 32` |
| `ENCRYPTION_KEY` | Yes | `openssl rand -hex 32` (64 hex chars) |
| `GROK_API_KEY` | For AI | xAI key — server-side only |
| `BLOB_READ_WRITE_TOKEN` | For uploads | Vercel Blob private storage |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Production | Vercel KV for distributed rate limiting |
| `ADMIN_SEED_PASSWORD` | For seed | Manager password for `npm run db:seed` — **never commit** |

### 3. Database setup (migrations)

**Fresh database:**

```bash
npm run db:migrate:deploy
ADMIN_SEED_PASSWORD="your-secure-password" npm run db:seed
```

**Existing database created with `db push`:**

```bash
npx prisma migrate resolve --applied 20250607120000_init
npm run db:migrate:deploy
```

> Use `npm run db:migrate` during development to create new migrations. Do not use `prisma db push` in production.

### 4. Run locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

**Seed accounts** (from `npm run db:seed`):

| Email | Password | Role |
|-------|----------|------|
| `admin@dealership.com` | Value of `ADMIN_SEED_PASSWORD` at seed time | Manager |
| `tech@dealership.com` | Value of `TECH_SEED_PASSWORD` or `changeme123` | Technician |

Set `ADMIN_SEED_PASSWORD` in your environment before seeding. The login screen warns if default seed passwords are still active.

## Production Deployment (Vercel)

1. Connect the repo and select branch `v2.3-dealership`
2. Add a **PostgreSQL** database (Vercel Postgres, Neon, or Supabase)
3. Set all environment variables from `.env.example`
4. Build command: `npm run build` (runs `prisma generate` automatically)
5. Deploy, then run migrations against production:

```bash
npx prisma migrate deploy
```

6. Seed once (or provision accounts manually):

```bash
npm run db:seed
```

7. Verify health: `GET /api/health` should return `"status": "ok"` or `"degraded"` (missing optional keys)

## Pre-Production Checklist

Complete this list before going live with real customer data:

- [ ] **Environment configured** — `DATABASE_URL`, `SESSION_SECRET`, `ENCRYPTION_KEY`, `ADMIN_SEED_PASSWORD` set on host
- [ ] **Database migrated** — `npm run db:migrate:deploy` completed without errors
- [ ] **Accounts provisioned** — `ADMIN_SEED_PASSWORD="…" npm run db:seed` run once; all seed passwords rotated via Settings
- [ ] **Health check green** — `GET /api/health` returns `"status": "ok"` (configure `GROK_API_KEY` and `BLOB_READ_WRITE_TOKEN` for scanning)
- [ ] **Audit chain valid** — Audit Log shows hash-chain integrity **VALID**
- [ ] **xAI DPA executed** — business account and data processing agreement finalized before production PII
- [ ] **CI passing** — GitHub Actions workflow green on `v2.3-dealership`

## API Endpoints

| Endpoint | Auth | Description |
|----------|------|-------------|
| `GET /api/health` | Public | Service health and live dependency probes |
| `GET /api/auth/security-status` | Public | Detects if default seed passwords are still in use |
| `GET /api/dashboard/summary` | Session | Manager/tech dashboard metrics |
| `GET /api/audit-logs/summary` | Manager | Audit stats + chain verification |
| `GET /api/audit-logs` | Manager | Filtered log list or CSV export |

## Current Limitations

> **Do not process real customer data until the pending xAI business account and Data Processing Agreement (DPA) are finalized.**

| Limitation | Impact | Mitigation |
|------------|--------|------------|
| **Pending xAI DPA** | RO text, VINs, diagnostic images, and OCR content are sent to xAI Grok for extraction and warranty story generation. Without a signed DPA, this is not approved for production customer data. | Complete xAI business onboarding and execute DPA before processing live customer data. |
| **Partial encryption** | OCR text, technician notes, and warranty stories remain plaintext in PostgreSQL. | Encrypt additional fields in a future release; restrict DB access; enable backups with encryption at rest. |
| **Hash chain scope** | Audit log chain verifies append-only integrity per dealership, but a privileged DBA could rewrite the full table. | Pair with CSV exports, least-privilege DB access, and off-site backup retention. |
| **Human review required** | AI-generated warranty stories are drafts only. | Technicians and managers must verify every story before Mercedes-Benz warranty submission. |
| **Rate limiting fallback** | Without Vercel KV, rate limits are per-instance only on multi-node deployments. | Configure `KV_REST_API_URL` and `KV_REST_API_TOKEN` in production. |

### Pre-production checklist

- [ ] xAI business account active and DPA executed
- [ ] All seed/default passwords rotated
- [ ] `npm run db:migrate:deploy` run against production database
- [ ] `GET /api/health` returns `"status": "ok"` (or acceptable `"degraded"` with documented gaps)
- [ ] `npm test` passes in CI/staging

## Project Structure

```
prisma/migrations/     # Versioned schema migrations (use migrate deploy)
src/app/api/           # REST API routes
src/components/        # UI views + StableTextarea, VoiceInputButton, ErrorBoundary
src/lib/               # Auth, encryption, audit chain, logging
src/prompts/           # Audit-safe AI prompt templates
src/services/          # Client-side OCR (Tesseract.js)
```

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Local development server |
| `npm run build` | Production build |
| `npm run db:migrate` | Create/apply migrations (dev) |
| `npm run db:migrate:deploy` | Apply migrations (production) |
| `npm run db:seed` | Seed dealership and initial accounts |
| `npm test` | Run unit + integration tests |
| `npm run test:integration` | Run integration tests only |

## License

Proprietary — for authorized Mercedes-Benz dealership use.