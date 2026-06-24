import { verifyPassword } from './auth';
import { prisma } from './db';

function getSeedD7Numbers(): { managerD7: string; techD7: string } {
  return {
    managerD7: (process.env.ADMIN_SEED_D7?.trim() || 'D7HARRIH').toUpperCase(),
    techD7: (process.env.TECH_SEED_D7?.trim() || 'D7TECH001').toUpperCase(),
  };
}

export interface SeedSecurityStatus {
  usingDefaultSeedPasswords: boolean;
  warnings: string[];
  accountsUsingDefaults: string[];
}

export async function checkSeedPasswordSecurity(): Promise<SeedSecurityStatus> {
  const { managerD7, techD7 } = getSeedD7Numbers();
  const techSeedPassword = process.env.TECH_SEED_PASSWORD?.trim();

  const accounts = await prisma.technician.findMany({
    where: { d7Number: { in: [managerD7, techD7] } },
    select: { d7Number: true, passwordHash: true, role: true },
  });

  const accountsUsingDefaults: string[] = [];
  const warnings: string[] = [];

  for (const account of accounts) {
    if (account.d7Number === techD7 && techSeedPassword) {
      const matchesTechSeed = await verifyPassword(techSeedPassword, account.passwordHash);
      if (matchesTechSeed) {
        accountsUsingDefaults.push(account.d7Number);
        warnings.push(
          'Technician account password still matches TECH_SEED_PASSWORD — change it before production use.'
        );
      }
    }

    if (account.d7Number === managerD7) {
      const adminSeedPassword = process.env.ADMIN_SEED_PASSWORD;
      if (adminSeedPassword) {
        const matchesSeed = await verifyPassword(adminSeedPassword, account.passwordHash);
        if (matchesSeed) {
          accountsUsingDefaults.push(account.d7Number);
          warnings.push(
            'Manager account password matches ADMIN_SEED_PASSWORD — change it before production use.'
          );
        }
      }
    }
  }

  return {
    usingDefaultSeedPasswords: accountsUsingDefaults.length > 0,
    warnings: [...new Set(warnings)],
    accountsUsingDefaults: [...new Set(accountsUsingDefaults)],
  };
}