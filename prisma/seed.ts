import { PrismaClient } from '@prisma/client';
import { runDatabaseSeed } from '../src/lib/seedDatabase';

const prisma = new PrismaClient();

async function main() {
  const result = await runDatabaseSeed();
  console.log(`  Template library: ${result.templates} templates, ${result.knowledgeBase} knowledge-base entries`);
  console.log('Seed complete.');
  console.log(`  ${result.managerD7} (manager) — password from ADMIN_SEED_PASSWORD`);
  console.log(`  ${result.techD7} (technician) — password from TECH_SEED_PASSWORD or default changeme123`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());