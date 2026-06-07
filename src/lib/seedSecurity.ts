import { verifyPassword } from './auth';
import { prisma } from './db';

/** Known default password used for the technician seed account. */
export const DEFAULT_TECH_SEED_PASSWORD = 'changeme123';

const SEED_ACCOUNTS = ['admin@dealership.com', 'tech@dealership.com'] as const;

export interface SeedSecurityStatus {
  usingDefaultSeedPasswords: boolean;
  warnings: string[];
  accountsUsingDefaults: string[];
}

export async function checkSeedPasswordSecurity(): Promise<SeedSecurityStatus> {
  const accounts = await prisma.technician.findMany({
    where: { email: { in: [...SEED_ACCOUNTS] } },
    select: { email: true, passwordHash: true, role: true },
  });

  const accountsUsingDefaults: string[] = [];
  const warnings: string[] = [];

  for (const account of accounts) {
    if (account.email === 'tech@dealership.com') {
      const isDefault = await verifyPassword(DEFAULT_TECH_SEED_PASSWORD, account.passwordHash);
      if (isDefault) {
        accountsUsingDefaults.push(account.email);
        warnings.push('Technician demo account still uses the default seed password (changeme123).');
      }
    }

    if (account.email === 'admin@dealership.com') {
      const adminSeedPassword = process.env.ADMIN_SEED_PASSWORD;
      if (adminSeedPassword) {
        const matchesSeed = await verifyPassword(adminSeedPassword, account.passwordHash);
        if (matchesSeed) {
          accountsUsingDefaults.push(account.email);
          warnings.push(
            'Manager account password matches ADMIN_SEED_PASSWORD — change it before a public demo or production use.'
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