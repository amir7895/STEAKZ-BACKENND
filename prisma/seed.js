const { PrismaClient, UserRole } = require('@prisma/client');
const prisma = new PrismaClient();
const bcrypt = require('bcrypt');

async function main() {
  // Create Branches
  const branchA = await prisma.branch.create({
    data: {
      name: 'Branch A',
      location: 'New York, USA'
    }
  });

  const branchB = await prisma.branch.create({
    data: {
      name: 'Branch B',
      location: 'London, UK'
    }
  });

  // Create test users for Branch A
  const password = await bcrypt.hash('password123', 10);

  const users = await Promise.all([
    prisma.user.create({
      data: {
        email: 'admin@steakz.com',
        password,
        role: UserRole.ADMIN,
        branchId: branchA.id
      }
    }),
    prisma.user.create({
      data: {
        email: 'manager@steakz.com',
        password,
        role: UserRole.MANAGER,
        branchId: branchA.id
      }
    }),
    prisma.user.create({
      data: {
        email: 'chef@steakz.com',
        password,
        role: UserRole.CHEF,
        branchId: branchA.id
      }
    }),
    prisma.user.create({
      data: {
        email: 'staff@steakz.com',
        password,
        role: UserRole.STAFF,
        branchId: branchA.id
      }
    }),
    prisma.user.create({
      data: {
        email: 'customer@email.com',
        password,
        role: UserRole.CUSTOMER,
        branchId: branchA.id
      }
    })
  ]);

  // Create menu items and inventory for Branch A
  const menuItems = [
    {
      name: 'Ribeye Steak',
      description: 'Prime cut ribeye steak, aged 28 days',
      price: 45.99,
      category: 'Mains',
      quantity: 50
    },
    {
      name: 'Filet Mignon',
      description: 'Tender center cut beef tenderloin',
      price: 52.99,
      category: 'Mains',
      quantity: 40
    },
    {
      name: 'T-Bone Steak',
      description: 'Classic T-bone cut with tenderloin and strip',
      price: 48.99,
      category: 'Mains',
      quantity: 8  // Low stock for testing
    },
    {
      name: 'Wagyu Burger',
      description: 'Premium wagyu beef burger with truffle mayo',
      price: 28.99,
      category: 'Burgers',
      quantity: 30
    },
    {
      name: 'Lobster Tail',
      description: 'Grilled lobster tail with garlic butter',
      price: 42.99,
      category: 'Seafood',
      quantity: 25
    }
  ];

  for (const item of menuItems) {
    const menuItem = await prisma.menuItem.create({
      data: {
        name: item.name,
        description: item.description,
        price: item.price,
        category: item.category,
        branchId: branchA.id
      }
    });

    await prisma.inventoryItem.create({
      data: {
        menuItemId: menuItem.id,
        quantity: item.quantity,
        branchId: branchA.id
      }
    });
  }

  console.log('Seed data created successfully!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });