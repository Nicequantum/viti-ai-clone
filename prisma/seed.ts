import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const TECH_PASSWORD = 'changeme123';

async function main() {
  const managerPassword = process.env.ADMIN_SEED_PASSWORD;
  if (!managerPassword || managerPassword.length < 8) {
    throw new Error(
      'ADMIN_SEED_PASSWORD must be set (min 8 characters) before running db:seed.\n' +
        'Example: ADMIN_SEED_PASSWORD="your-secure-password" npm run db:seed'
    );
  }

  const dealership = await prisma.dealership.upsert({
    where: { id: 'seed-dealership' },
    update: {},
    create: {
      id: 'seed-dealership',
      name: 'Mercedes-Benz of Demo City',
    },
  });

  const managerPasswordHash = await bcrypt.hash(managerPassword, 12);
  const techPasswordHash = await bcrypt.hash(TECH_PASSWORD, 12);

  await prisma.technician.upsert({
    where: { email: 'admin@dealership.com' },
    update: { passwordHash: managerPasswordHash },
    create: {
      email: 'admin@dealership.com',
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
    where: { email: 'tech@dealership.com' },
    update: {},
    create: {
      email: 'tech@dealership.com',
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
  console.log('  admin@dealership.com (manager) — password from ADMIN_SEED_PASSWORD');
  console.log('  tech@dealership.com (technician) — default demo password still in use; rotate before production');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());