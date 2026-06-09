import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

function requireEnv(name: string, minLength = 1): string {
  const value = process.env[name]?.trim();
  if (!value || value.length < minLength) {
    throw new Error(
      `${name} must be set${minLength > 1 ? ` (min ${minLength} characters)` : ''} before running db:seed.`
    );
  }
  return value;
}

async function main() {
  const managerEmail = (process.env.ADMIN_SEED_EMAIL?.trim() || 'admin@dealership.com').toLowerCase();
  const managerPassword = requireEnv('ADMIN_SEED_PASSWORD', 8);
  const techEmail = (process.env.TECH_SEED_EMAIL?.trim() || 'tech@dealership.com').toLowerCase();
  const techPassword = process.env.TECH_SEED_PASSWORD?.trim() || 'changeme123';

  const dealership = await prisma.dealership.upsert({
    where: { id: 'seed-dealership' },
    update: {},
    create: {
      id: 'seed-dealership',
      name: 'Mercedes-Benz Service Center',
    },
  });

  const managerPasswordHash = await bcrypt.hash(managerPassword, 12);
  const techPasswordHash = await bcrypt.hash(techPassword, 12);

  await prisma.technician.upsert({
    where: { email: managerEmail },
    update: { passwordHash: managerPasswordHash, role: 'manager', isActive: true, dealershipId: dealership.id },
    create: {
      email: managerEmail,
      name: 'Service Manager',
      passwordHash: managerPasswordHash,
      role: 'manager',
      isActive: true,
      dealershipId: dealership.id,
      consentAt: new Date(),
      consentVersion: '2026-06-07-v1',
    },
  });

  await prisma.technician.upsert({
    where: { email: techEmail },
    update: { passwordHash: techPasswordHash, role: 'technician', isActive: true, dealershipId: dealership.id },
    create: {
      email: techEmail,
      name: 'Alex Technician',
      passwordHash: techPasswordHash,
      role: 'technician',
      isActive: true,
      dealershipId: dealership.id,
      consentAt: new Date(),
      consentVersion: '2026-06-07-v1',
    },
  });

  console.log('Seed complete.');
  console.log(`  ${managerEmail} (manager) — password from ADMIN_SEED_PASSWORD`);
  console.log(`  ${techEmail} (technician) — password from TECH_SEED_PASSWORD or default changeme123`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());