import bcrypt from 'bcryptjs';
import { internalEmailForD7 } from './d7Number';
import { prisma } from './db';
import { seedTemplateLibraryIfEmpty } from './templateLibrary';

function requireEnv(name: string, minLength = 1): string {
  const value = process.env[name]?.trim();
  if (!value || value.length < minLength) {
    throw new Error(
      `${name} must be set${minLength > 1 ? ` (min ${minLength} characters)` : ''} before running db:seed.`
    );
  }
  return value;
}

export interface SeedResult {
  managerD7: string;
  techD7: string;
  templates: number;
  knowledgeBase: number;
}

export async function runDatabaseSeed(): Promise<SeedResult> {
  const managerD7 = (process.env.ADMIN_SEED_D7?.trim() || 'D7HARRIH').toUpperCase();
  const techD7 = (process.env.TECH_SEED_D7?.trim() || 'D7TECH001').toUpperCase();
  const managerPassword = requireEnv('ADMIN_SEED_PASSWORD', 8);
  // H11: no hardcoded default technician password in source — require explicit env.
  const techPassword = requireEnv('TECH_SEED_PASSWORD', 8);

  const dealership = await prisma.dealership.upsert({
    where: { id: 'seed-dealership' },
    update: { name: 'Mercedes-Benz of Tiverton' },
    create: {
      id: 'seed-dealership',
      name: 'Mercedes-Benz of Tiverton',
    },
  });

  const managerPasswordHash = await bcrypt.hash(managerPassword, 12);
  const techPasswordHash = await bcrypt.hash(techPassword, 12);

  const legacyManagerEmail = (process.env.ADMIN_SEED_EMAIL?.trim() || 'admin@dealership.com').toLowerCase();
  const legacyTechEmail = (process.env.TECH_SEED_EMAIL?.trim() || 'tech@dealership.com').toLowerCase();

  const legacyManager = await prisma.technician.findFirst({ where: { email: legacyManagerEmail } });
  if (legacyManager && legacyManager.d7Number !== managerD7) {
    await prisma.technician.update({
      where: { id: legacyManager.id },
      data: {
        d7Number: managerD7,
        email: internalEmailForD7(managerD7),
        passwordHash: managerPasswordHash,
        role: 'manager',
        isAdmin: true,
        isActive: true,
        dealershipId: dealership.id,
      },
    });
  } else {
    await prisma.technician.upsert({
      where: { d7Number: managerD7 },
      update: {
        passwordHash: managerPasswordHash,
        role: 'manager',
        isAdmin: true,
        isActive: true,
        dealershipId: dealership.id,
        email: internalEmailForD7(managerD7),
      },
      create: {
        d7Number: managerD7,
        email: internalEmailForD7(managerD7),
        name: 'Service Manager',
        passwordHash: managerPasswordHash,
        role: 'manager',
        isAdmin: true,
        isActive: true,
        dealershipId: dealership.id,
        consentAt: new Date(),
        consentVersion: '2026-06-07-v1',
      },
    });
  }

  const legacyTech = await prisma.technician.findFirst({ where: { email: legacyTechEmail } });
  if (legacyTech && legacyTech.d7Number !== techD7) {
    await prisma.technician.update({
      where: { id: legacyTech.id },
      data: {
        d7Number: techD7,
        email: internalEmailForD7(techD7),
        passwordHash: techPasswordHash,
        role: 'technician',
        isActive: true,
        dealershipId: dealership.id,
      },
    });
  } else {
    await prisma.technician.upsert({
      where: { d7Number: techD7 },
      update: {
        passwordHash: techPasswordHash,
        role: 'technician',
        isActive: true,
        dealershipId: dealership.id,
        email: internalEmailForD7(techD7),
      },
      create: {
        d7Number: techD7,
        email: internalEmailForD7(techD7),
        name: 'Alex Technician',
        passwordHash: techPasswordHash,
        role: 'technician',
        isActive: true,
        dealershipId: dealership.id,
        consentAt: new Date(),
        consentVersion: '2026-06-07-v1',
      },
    });
  }

  const library = await seedTemplateLibraryIfEmpty();

  return {
    managerD7,
    techD7,
    templates: library.templates,
    knowledgeBase: library.knowledgeBase,
  };
}