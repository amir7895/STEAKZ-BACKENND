const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

async function hashAllPasswords() {
  try {
    const users = await prisma.user.findMany();
    console.log(`Found ${users.length} users`);

    for (const user of users) {
      // Check if password is already hashed (bcrypt hashes start with $2a$, $2b$, or $2y$)
      const isHashed = /^\$2[aby]\$/.test(user.password);
      
      if (isHashed) {
        console.log(`✓ ${user.email} - already hashed`);
      } else {
        console.log(`Hashing ${user.email}...`);
        const hashedPassword = await bcrypt.hash(user.password, 10);
        await prisma.user.update({
          where: { id: user.id },
          data: { password: hashedPassword }
        });
        console.log(`✓ ${user.email} - hashed`);
      }
    }

    console.log('\nAll passwords hashed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Error hashing passwords:', error);
    process.exit(1);
  }
}

hashAllPasswords();
