import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seed...');

  // Create default users
  const hashedPassword = await bcrypt.hash('password123', 12);

  const superAdmin = await prisma.user.upsert({
    where: { email: 'admin@pdits.com' },
    update: {},
    create: {
      email: 'admin@pdits.com',
      password: hashedPassword,
      name: 'Super Admin',
      role: 'SUPER_ADMIN',
      isActive: true,
    },
  });

  const admin = await prisma.user.upsert({
    where: { email: 'dataentry@pdits.com' },
    update: {},
    create: {
      email: 'dataentry@pdits.com',
      password: hashedPassword,
      name: 'Data Entry Admin',
      role: 'ADMIN',
      isActive: true,
    },
  });

  const user = await prisma.user.upsert({
    where: { email: 'user@pdits.com' },
    update: {},
    create: {
      email: 'user@pdits.com',
      password: hashedPassword,
      name: 'Regular User',
      role: 'USER',
      isActive: true,
    },
  });

  console.log('✅ Created users:', {
    superAdmin: superAdmin.email,
    admin: admin.email,
    user: user.email,
  });

  // Create sample items
  const items = [
    { partNumber: 'PROD-A001', itemName: 'Produk A', unit: 'pcs' },
    { partNumber: 'PROD-B002', itemName: 'Produk B', unit: 'pcs' },
    { partNumber: 'PROD-C003', itemName: 'Produk C', unit: 'kg' },
    { partNumber: 'PROD-D004', itemName: 'Produk D', unit: 'pcs' },
    { partNumber: 'PROD-E005', itemName: 'Produk E', unit: 'box' },
  ];

  for (const item of items) {
    await prisma.item.upsert({
      where: { partNumber: item.partNumber },
      update: {},
      create: item,
    });
  }

  console.log(`✅ Created ${items.length} sample items`);

  // Create sample daily schedules (today)
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const itemRecords = await prisma.item.findMany();

  for (const item of itemRecords.slice(0, 3)) {
    for (let shift = 1; shift <= 3; shift++) {
      await prisma.dailySchedule.upsert({
        where: {
          date_shift_itemId: {
            date: today,
            shift,
            itemId: item.id,
          },
        },
        update: {},
        create: {
          date: today,
          shift,
          itemId: item.id,
          quantity: Math.floor(Math.random() * 200) + 100,
        },
      });
    }
  }

  console.log('✅ Created sample daily schedules');

  // Create sample FG stocks
  for (const item of itemRecords.slice(0, 3)) {
    await prisma.fGStock.upsert({
      where: { itemId: item.id },
      update: {},
      create: {
        itemId: item.id,
        quantity: Math.floor(Math.random() * 150) + 50,
        date: today,
        shift: 1,
        updatedBy: admin.id,
      },
    });
  }

  console.log('✅ Created sample FG stocks');

  // Create sample WIPs
  const locations = ['Mesin-01', 'Mesin-02', 'Assembly Line', 'QC Station'];

  for (const item of itemRecords.slice(0, 2)) {
    for (let i = 0; i < 2; i++) {
      await prisma.wIP.upsert({
        where: {
          itemId_location: {
            itemId: item.id,
            location: locations[i],
          },
        },
        update: {},
        create: {
          itemId: item.id,
          location: locations[i],
          quantity: Math.floor(Math.random() * 50) + 10,
          progressPercent: Math.floor(Math.random() * 80) + 10,
          date: today,
          shift: 1,
          status: 'IN_PROGRESS',
          updatedBy: admin.id,
        },
      });
    }
  }

  console.log('✅ Created sample WIPs');

  console.log('🎉 Database seed completed!');
}

main()
  .catch((e) => {
    console.error('❌ Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
