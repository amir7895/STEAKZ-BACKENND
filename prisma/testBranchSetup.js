// Multi-Branch Enhancement: Test script to verify branches and user setup
// Run with: node prisma/testBranchSetup.js

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('\n=== Multi-Branch Enhancement: Database Setup Check ===\n');

  // Check branches
  const branches = await prisma.branch.findMany({
    select: {
      id: true,
      name: true,
      city: true,
      country: true,
      location: true
    }
  });
  console.log(`✓ Total branches in database: ${branches.length}`);
  if (branches.length > 0) {
    console.log('  Branches:');
    branches.forEach(b => console.log(`    - ${b.name} (ID: ${b.id}, ${b.city || b.location})`));
  } else {
    console.log('  ⚠ No branches found! Run: node prisma/seedBranches.js');
  }

  // Check users with MANAGER/ADMIN role
  const managers = await prisma.user.findMany({
    where: {
      role: { in: ['MANAGER', 'ADMIN'] }
    },
    select: {
      id: true,
      email: true,
      role: true,
      branchId: true,
      activeBranchId: true
    }
  });
  console.log(`\n✓ Total MANAGER/ADMIN users: ${managers.length}`);
  if (managers.length > 0) {
    managers.forEach(m => {
      console.log(`  - ${m.email} (${m.role}) - Branch: ${m.branchId}, Active: ${m.activeBranchId || 'none'}`);
    });
  } else {
    console.log('  ⚠ No MANAGER/ADMIN users found! Create one or update a user role.');
  }

  // Example Prisma query for GET /api/branches endpoint
  console.log('\n=== Recommended Prisma Query (already in server.js) ===\n');
  console.log(`
const branches = await prisma.branch.findMany({
  select: {
    id: true,
    name: true,
    location: true,
    country: true,
    city: true,
    address: true,
    postalCode: true,
    phone: true,
    email: true,
    timezone: true,
    latitude: true,
    longitude: true,
    openingTime: true,
    closingTime: true
  },
  orderBy: { name: 'asc' }
});
  `);

  console.log('\n=== Action Items ===\n');
  if (branches.length === 0) {
    console.log('1. Run: node prisma/seedBranches.js');
    console.log('   OR call: POST http://localhost:3001/api/branches/seed-sample (ADMIN token required)');
  }
  if (managers.length === 0) {
    console.log('2. Update a user to MANAGER role using Prisma Studio or SQL:');
    console.log('   UPDATE "User" SET role = \'MANAGER\' WHERE email = \'your@email.com\';');
  }
  console.log('\n');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
