# Merlin — Mercedes-Benz Warranty Story Generator

**Secure AI-Powered Warranty Documentation Platform for Mercedes-Benz Dealerships**

[![Next.js](https://img.shields.io/badge/Next.js-15-black?style=for-the-badge&logo=next.js&logoColor=white)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Prisma](https://img.shields.io/badge/Prisma-ORM-2D3748?style=for-the-badge&logo=prisma&logoColor=white)](https://www.prisma.io/)
[![Security](https://img.shields.io/badge/Security-Enterprise_Grade-22c55e?style=for-the-badge)](https://github.com/Nicequantum/viti-ai-clone)

A secure, enterprise-grade platform that enables Mercedes-Benz service technicians to generate accurate, professional warranty narratives using Grok AI — complete with voice input, field-level encryption, and a tamper-evident audit trail.

---

## Who This Is For

| Role | What You Get |
|------|--------------|
| **Technicians** | Fast voice-to-story workflow and professional PDF output |
| **Service Managers** | Full visibility, audit logs, user management, and compliance tools |
| **Fixed Ops Directors** | A secure, auditable, and scalable warranty documentation system |

---

## Key Features

- Voice-first input with stable text editing during dictation
- Grok AI-powered intelligent warranty story generation
- AES-256-GCM encryption for all sensitive data
- Immutable SHA-256 hash-chained audit trail
- Client-side image compression and secure blob storage
- Professional branded PDF generation
- Role-based access control with instant session revocation

---

## Architecture Overview

```mermaid
flowchart TD
    subgraph Frontend["Frontend — Next.js 15 + React 19"]
        A[Voice + Stable Text Editing]
    end

    subgraph Backend["Backend — Next.js API Routes"]
        B[JWT Auth + Session Revocation]
        C[Server-side AES-256 Encryption]
        D[Grok AI Story Generation]
    end

    subgraph Audit["Audit Trail"]
        E[SHA-256 Hash-Chained Logging]
    end

    subgraph Output["Output"]
        F[Branded PDF Export]
    end

    A --> B
    B --> C
    C --> D
    D --> E
    D --> F
```

---

## Common Failure Modes & Troubleshooting

| Issue | Symptom / Error | Recommended Fix |
|-------|-----------------|-----------------|
| **Grok API Timeout** | Long loading spinner or timeout message | Shorten input and click **Regenerate** |
| **Voice Input Not Working** | Microphone does not respond | Allow microphone permission in Chrome or Edge |
| **PDF Generation Failed** | "Failed to generate PDF" | Fill all required fields first, then regenerate |
| **Frequent Logouts** | Getting logged out often | Check device clock or clear browser cache |

---

## Getting Started

```bash
git clone https://github.com/Nicequantum/viti-ai-clone.git
cd viti-ai-clone
npm install
cp .env.example .env.local
npm run dev
```

---

**Note:** The application UI still uses "Benz Tech" branding in several places. Let me know if you want me to help you rebrand the actual app to "Merlin" next.

Built for Mercedes-Benz Fixed Operations teams.