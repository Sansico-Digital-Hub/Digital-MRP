with open(r'apps\api\prisma\schema.prisma', 'r', encoding='utf-8-sig') as f:
    content = f.read()
with open(r'apps\api\prisma\schema.prisma', 'w', encoding='utf-8', newline='\n') as f:
    f.write(content)
