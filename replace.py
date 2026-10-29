import re
with open(r'apps\api\prisma\schema.prisma', 'r', encoding='utf-8') as f:
    content = f.read()

content = re.sub(r'model StockRawMaterial \{.*?\n\}', '''model StockRawMaterial {
  id        String   @id @default(cuid())
  itemDesc  String
  date      DateTime @db.Date
  supplier  String?
  qty       Float
  unit      String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([date])
  @@map("stock_raw_materials")
}''', content, flags=re.DOTALL)

with open(r'apps\api\prisma\schema.prisma', 'w', encoding='utf-8', newline='\n') as f:
    f.write(content)
