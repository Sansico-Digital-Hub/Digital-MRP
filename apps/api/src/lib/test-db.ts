/**
 * Script untuk test koneksi database dan query dasar
 * Run dengan: pnpm --filter @pdits/api tsx src/lib/test-db.ts
 */

import prisma from './prisma';

async function testDatabase() {
  console.log('🧪 Testing database connection...\n');

  try {
    // Test 1: Raw query
    console.log('1️⃣ Testing raw query...');
    const result = await prisma.$queryRaw`SELECT 1 as test`;
    console.log('✅ Raw query success:', result);

    // Test 2: Count users
    console.log('\n2️⃣ Counting users...');
    const userCount = await prisma.user.count();
    console.log(`✅ Found ${userCount} users`);

    // Test 3: List users
    console.log('\n3️⃣ Listing users...');
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
      },
    });
    console.table(users);

    // Test 4: Count items
    console.log('\n4️⃣ Counting items...');
    const itemCount = await prisma.item.count();
    console.log(`✅ Found ${itemCount} items`);

    // Test 5: List items
    console.log('\n5️⃣ Listing items...');
    const items = await prisma.item.findMany({
      take: 5,
    });
    console.table(items);

    // Test 6: Count daily schedules
    console.log('\n6️⃣ Counting daily schedules...');
    const scheduleCount = await prisma.dailySchedule.count();
    console.log(`✅ Found ${scheduleCount} daily schedules`);

    // Test 7: Count FG stocks
    console.log('\n7️⃣ Counting FG stocks...');
    const fgCount = await prisma.fGStock.count();
    console.log(`✅ Found ${fgCount} FG stock records`);

    // Test 8: Count WIPs
    console.log('\n8️⃣ Counting WIPs...');
    const wipCount = await prisma.wIP.count();
    console.log(`✅ Found ${wipCount} WIP records`);

    // Test 9: Complex query with relations
    console.log('\n9️⃣ Testing complex query with relations...');
    const itemsWithStock = await prisma.item.findMany({
      take: 3,
      include: {
        fgStocks: true,
        wips: true,
        dailySchedules: {
          take: 1,
          orderBy: { date: 'desc' },
        },
      },
    });

    console.log('\n📊 Items with stock and schedules:');
    itemsWithStock.forEach((item) => {
      console.log(`\n${item.itemName} (${item.partNumber}):`);
      console.log(`  - FG Stock: ${item.fgStocks.length} records`);
      console.log(`  - WIP: ${item.wips.length} records`);
      console.log(`  - Daily Schedules: ${item.dailySchedules.length} records`);
    });

    console.log('\n✅ All database tests passed!');
  } catch (error) {
    console.error('\n❌ Database test failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

testDatabase();
