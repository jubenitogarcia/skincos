import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const email = process.env.SEED_EMAIL || 'demo@local.test';
  const password = process.env.SEED_PASSWORD || 'password123';
  const orgName = process.env.SEED_ORG || 'Demo Org';

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log('Seed user already exists');
    return;
  }

  const org = await prisma.org.create({ data: { name: orgName } });
  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      memberships: {
        create: { orgId: org.id, role: 'ADMIN' },
      },
    },
  });

  await prisma.alertRule.createMany({
    data: [
      { orgId: org.id, type: 'PACING_FAST', isActive: true, config: { pacingUpper: 1.3 } },
      { orgId: org.id, type: 'NO_SPEND', isActive: true, config: { noSpendHours: 6 } },
    ],
  });

  console.log('Seeded org', org.id, 'user', user.email);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
