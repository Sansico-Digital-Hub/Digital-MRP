import re

with open(r'apps\web\src\hooks\useStockRawMaterial.ts', 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace('description: string;', 'itemDesc: string;')
content = content.replace('keterangan: string | null;', 'supplier: string | null;')
content = content.replace('eiType: string;', 'unit: string;')
content = content.replace('eiAmount: number;\n  eiKg: number;', 'qty: number;')
content = content.replace('description: string; keterangan: string; eiType: string; eiAmount: number; eiKg: number;', 'itemDesc: string; supplier: string; unit: string; qty: number;')

with open(r'apps\web\src\hooks\useStockRawMaterial.ts', 'w', encoding='utf-8', newline='\n') as f:
    f.write(content)
