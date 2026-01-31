// Multi-Branch Enhancement
// Safe, idempotent seeding of sample branches for testing
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const samples = [
    {
      name: 'Steakz London',
      city: 'London',
      country: 'UK',
      timezone: 'Europe/London',
      address: '10 Downing St',
      postalCode: 'SW1A 2AA',
      phone: '+44 20 7946 0000',
      email: 'london@steakz.example',
      latitude: 51.5034,
      longitude: -0.1276,
      openingTime: '09:00',
      closingTime: '22:00'
    },
    {
      name: 'Steakz Paris',
      city: 'Paris',
      country: 'France',
      timezone: 'Europe/Paris',
      address: '5 Avenue Anatole France',
      postalCode: '75007',
      phone: '+33 1 2345 6789',
      email: 'paris@steakz.example',
      latitude: 48.8584,
      longitude: 2.2945,
      openingTime: '09:00',
      closingTime: '22:00'
    },
    {
      name: 'Steakz Madrid',
      city: 'Madrid',
      country: 'Spain',
      timezone: 'Europe/Madrid',
      address: 'Plaza Mayor',
      postalCode: '28012',
      phone: '+34 91 123 4567',
      email: 'madrid@steakz.example',
      latitude: 40.4168,
      longitude: -3.7038,
      openingTime: '09:00',
      closingTime: '22:00'
    }
  ];

  let created = 0, skipped = 0;

  for (const s of samples) {
    // No unique on name/city; do a findFirst to avoid duplicates
    const existing = await prisma.branch.findFirst({ where: { name: s.name, city: s.city } });
    if (existing) {
      skipped++;
      continue;
    }
    await prisma.branch.create({ data: s });
    created++;
  }

  console.info(`[Multi-Branch Enhancement] Sample branches seeding complete. created=${created}, skipped=${skipped}`);
}

main()
  .catch((e) => {
    console.error('[Multi-Branch Enhancement] Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
