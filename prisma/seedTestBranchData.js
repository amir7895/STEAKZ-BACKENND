// SAFE TEST ONLY / Multi-Branch Enhancement
// Idempotent seed for test BranchPrice, BranchInventory, Staff records.
// Does NOT modify production InventoryItem or MenuItem tables beyond reading them.

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('[TEST SEED] Starting test seed...');

  // Fetch a couple of branches & menu items for linkage; fallback to ids if missing
  const branches = await prisma.branch.findMany({ take: 2 });
  if (branches.length === 0) {
    console.warn('[TEST SEED] No branches found; aborting. Run branch seed first.');
    return;
  }
  const menuItems = await prisma.menuItem.findMany({ take: 3 });
  if (menuItems.length === 0) {
    console.warn('[TEST SEED] No menu items found; create some MenuItem records first.');
  }

  // BranchPrice seeds
  for (const b of branches) {
    for (const m of menuItems) {
      const existing = await prisma.branchPrice.findUnique({ where: { branchId_menuItemId: { branchId: b.id, menuItemId: m.id } } });
      if (existing) continue;
      await prisma.branchPrice.create({
        data: {
          branchId: b.id,
          menuItemId: m.id,
            overridePrice: parseFloat((m.price * (1 + Math.random() * 0.2 - 0.1)).toFixed(2)),
          currency: 'USD',
          notes: 'Auto-seeded test override'
        }
      });
    }
  }

  // BranchInventory seeds (synthetic items)
  for (const b of branches) {
    const syntheticNames = ['Test Flour', 'Test Beef', 'Test Spices'];
    for (const name of syntheticNames) {
      const existing = await prisma.branchInventory.findFirst({ where: { branchId: b.id, name } });
      if (existing) continue;
      await prisma.branchInventory.create({
        data: {
          branchId: b.id,
          name,
          quantity: Math.floor(Math.random() * 50 + 10),
          minQuantity: 10,
          unit: 'kg',
          status: 'OK',
          notes: 'Synthetic test inventory'
        }
      });
    }
  }

  // Staff seeds
  const testStaff = [
    { name: 'Test Chef Alice', role: 'CHEF' },
    { name: 'Test Server Bob', role: 'SERVER' },
    { name: 'Test Host Carol', role: 'HOST' }
  ];
  for (const b of branches) {
    for (const st of testStaff) {
      const existing = await prisma.staff.findFirst({ where: { branchId: b.id, name: st.name } });
      if (existing) continue;
      await prisma.staff.create({
        data: {
          branchId: b.id,
          name: st.name,
          role: st.role,
          active: true,
          hourlyRate: 20 + Math.random() * 10,
          notes: 'Seeded test staff'
        }
      });
    }
  }

  console.log('[TEST SEED] Completed.');
}

main().catch(e => {
  console.error(e);
}).finally(async () => {
  await prisma.$disconnect();
});
