const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS stock_raw_materials;');
}
main().catch(console.error).finally(() => prisma.$disconnect());
