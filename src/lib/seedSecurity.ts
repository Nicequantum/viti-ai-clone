import { verifyPassword } from './auth';
import { prisma } from './db';

/** Known default password used for the technician seed account when TECH_SEED_PASSWORD is unset. */
export const DEFAULT_TECH_SEED_PASSWORD = 'changeme123';

function getSeedAccountEmails(): { managerEmail: string; techEmail: string } {
  return {
    managerEmail: process.env.ADMIN_SEED_EMAIL?.trim() || 'admin@dealership.com',
    techEmail: process.env.TECH_SEED_EMAIL?.trim() || 'tech@dealership.com',
  };
}

export interface SeedSecurityStatus {
  usingDefaultSeedPasswords: boolean;
  warnings: string[];
  accountsUsingDefaults: string[];
}

export async function checkSeedPasswordSecurity(): Promise<SeedSecurityStatus> {
  const { managerEmail, techEmail } = getSeedAccountEmails();
  const techSeedPassword = process.env.TECH_SEED_PASSWORD?.trim() || DEFAULT_TECH_SEED_PASSWORD;

  const accounts = await prisma.technician.findMany({
    where: { email: { in: [managerEmail, techEmail] } },
    select: { email: true, passwordHash: true, role: true },
  });

  const accountsUsingDefaults: string[] = [];
  const warnings: string[] = [];

  for (const account of accounts) {
    if (account.email === techEmail) {
      const matchesTechSeed = await verifyPassword(techSeedPassword, account.passwordHash);
      if (matchesTechSeed) {
        accountsUsingDefaults.push(account.email);
        warnings.push(
          techSeedPassword === DEFAULT_TECH_SEED_PASSWORD
            ? 'Technician seed account still uses the default password (changeme123).'
            : 'Technician account password matches TECH_SEED_PASSWORD — change it before production use.'
        );
      }
    }

    if (account.email === managerEmail) {
      const adminSeedPassword = process.env.ADMIN_SEED_PASSWORD;
      if (adminSeedPassword) {
        const matchesSeed = await verifyPassword(adminSeedPassword, account.passwordHash);
        if (matchesSeed) {
          accountsUsingDefaults.push(account.email);
          warnings.push(
            'Manager account password matches ADMIN_SEED_PASSWORD — change it before production use.'
          );
        }
      }

      const stillDefaultTech = await verifyPassword(DEFAULT_TECH_SEED_PASSWORD, account.passwordHash);
      if (stillDefaultTech) {
        accountsUsingDefaults.push(account.email);
        warnings.push('Manager account still uses a known default password.');
      }
    }
  }

  return {
    usingDefaultSeedPasswords: accountsUsingDefaults.length > 0,
    warnings: [...new Set(warnings)],
    accountsUsingDefaults: [...new Set(accountsUsingDefaults)],
  };
}