import re

with open(r'apps/web/src/routes/StockRawMaterial.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Replace variables in state and hooks
content = content.replace("description: '',", "itemDesc: '',")
content = content.replace("keterangan: '',", "supplier: '',")
content = content.replace("eiType: 'ROLL',", "unit: '',")
content = content.replace("eiAmount: '',", "qty: '',")
content = re.sub(r'\s*eiKg:\s*\'\',', '', content)

content = content.replace("description: record.description", "itemDesc: record.itemDesc")
content = content.replace("keterangan: record.keterangan || ''", "supplier: record.supplier || ''")
content = content.replace("eiType: record.eiType", "unit: record.unit")
content = content.replace("eiAmount: record.eiAmount.toString()", "qty: record.qty.toString()")
content = re.sub(r'\s*eiKg:\s*record\.eiKg\.toString\(\),', '', content)

content = content.replace("!previewEditForm.description || !previewEditForm.eiAmount || !previewEditForm.eiKg", "!previewEditForm.itemDesc || !previewEditForm.qty")
content = content.replace("description: previewEditForm.description", "itemDesc: previewEditForm.itemDesc")
content = content.replace("keterangan: previewEditForm.keterangan", "supplier: previewEditForm.supplier")
content = content.replace("eiType: previewEditForm.eiType", "unit: previewEditForm.unit")
content = content.replace("eiAmount: parseFloat(previewEditForm.eiAmount)", "qty: parseFloat(previewEditForm.qty)")
content = re.sub(r'\s*eiKg:\s*parseFloat\(previewEditForm\.eiKg\),', '', content)

content = content.replace("!manualForm.description || !manualForm.date || !manualForm.eiAmount || !manualForm.eiKg", "!manualForm.itemDesc || !manualForm.date || !manualForm.qty")
content = content.replace("description: manualForm.description", "itemDesc: manualForm.itemDesc")
content = content.replace("keterangan: manualForm.keterangan", "supplier: manualForm.supplier")
content = content.replace("eiType: manualForm.eiType", "unit: manualForm.unit")
content = content.replace("eiAmount: parseFloat(manualForm.eiAmount)", "qty: parseFloat(manualForm.qty)")
content = re.sub(r'\s*eiKg:\s*parseFloat\(manualForm\.eiKg\),', '', content)

content = content.replace("!editForm.description || !editForm.date || !editForm.eiAmount || !editForm.eiKg", "!editForm.itemDesc || !editForm.date || !editForm.qty")
content = content.replace("description: editForm.description", "itemDesc: editForm.itemDesc")
content = content.replace("keterangan: editForm.keterangan", "supplier: editForm.supplier")
content = content.replace("eiType: editForm.eiType", "unit: editForm.unit")
content = content.replace("eiAmount: parseFloat(editForm.eiAmount)", "qty: parseFloat(editForm.qty)")
content = re.sub(r'\s*eiKg:\s*parseFloat\(editForm\.eiKg\),', '', content)

content = content.replace("record.description.toLowerCase().includes", "record.itemDesc.toLowerCase().includes")
content = content.replace("record.keterangan && record.keterangan.toLowerCase().includes", "record.supplier && record.supplier.toLowerCase().includes")

# HTML / JSX changes
content = content.replace('<th className="px-6 py-4 font-semibold w-1/3">Description</th>', '<th className="px-6 py-4 font-semibold w-1/3">Item Desc</th>')
content = content.replace('<th className="px-6 py-4 font-semibold">Keterangan</th>', '<th className="px-6 py-4 font-semibold">Supplier</th>')
content = content.replace('<th className="px-6 py-4 font-semibold text-center">Type</th>', '<th className="px-6 py-4 font-semibold text-center">Unit</th>')
content = content.replace('<th className="px-6 py-4 font-semibold text-right">Amount</th>', '<th className="px-6 py-4 font-semibold text-right">Qty</th>')
content = content.replace('<th className="px-6 py-4 font-semibold text-right">KG</th>', '')

content = content.replace('previewEditForm.description', 'previewEditForm.itemDesc')
content = content.replace('previewEditForm.keterangan', 'previewEditForm.supplier')
content = content.replace('previewEditForm.eiType', 'previewEditForm.unit')
content = content.replace('previewEditForm.eiAmount', 'previewEditForm.qty')

content = content.replace('record.description', 'record.itemDesc')
content = content.replace('record.keterangan', 'record.supplier')
content = content.replace('record.eiType', 'record.unit')
content = content.replace('record.eiAmount', 'record.qty')

content = content.replace('manualForm.description', 'manualForm.itemDesc')
content = content.replace('manualForm.keterangan', 'manualForm.supplier')
content = content.replace('manualForm.eiType', 'manualForm.unit')
content = content.replace('manualForm.eiAmount', 'manualForm.qty')

content = content.replace('editForm.description', 'editForm.itemDesc')
content = content.replace('editForm.keterangan', 'editForm.supplier')
content = content.replace('editForm.eiType', 'editForm.unit')
content = content.replace('editForm.eiAmount', 'editForm.qty')

content = re.sub(r'<td className="px-6 py-3"><input type="number".*?previewEditForm\.eiKg.*?</td>', '', content)
content = re.sub(r'<td className="px-6 py-3 text-right font-bold">\{record\.eiKg\}</td>', '', content)
content = re.sub(r'<div className="space-y-1.5 md:col-span-1">\s*<label className="text-xs font-semibold text-muted-foreground uppercase">KG</label>.*?</div>', '', content, flags=re.DOTALL)
content = re.sub(r'<td className="px-6 py-3"><input type="number".*?editForm\.eiKg.*?</td>', '', content)

# Replace <select> for unit with input text because unit can be sht, roll, etc.
content = re.sub(r'<select.*?editForm\.unit.*?</select>', '<input type="text" className="w-full h-8 px-2 border rounded text-sm" value={editForm.unit} onChange={(e) => setEditForm({ ...editForm, unit: e.target.value })} />', content, flags=re.DOTALL)
content = re.sub(r'<select.*?previewEditForm\.unit.*?</select>', '<input type="text" className="w-full h-8 px-2 border rounded text-sm" value={previewEditForm.unit} onChange={(e) => setPreviewEditForm({ ...previewEditForm, unit: e.target.value })} />', content, flags=re.DOTALL)
content = re.sub(r'<select.*?manualForm\.unit.*?</select>', '<input type="text" className="w-full h-10 px-3 border rounded-md text-sm" placeholder="Unit" value={manualForm.unit} onChange={(e) => setManualForm({ ...manualForm, unit: e.target.value })} />', content, flags=re.DOTALL)

# Ensure labels are updated
content = content.replace('<label className="text-xs font-semibold text-muted-foreground uppercase">EI Type</label>', '<label className="text-xs font-semibold text-muted-foreground uppercase">Unit</label>')
content = content.replace('<label className="text-xs font-semibold text-muted-foreground uppercase">Description</label>', '<label className="text-xs font-semibold text-muted-foreground uppercase">Item Desc</label>')
content = content.replace('<label className="text-xs font-semibold text-muted-foreground uppercase">Keterangan</label>', '<label className="text-xs font-semibold text-muted-foreground uppercase">Supplier</label>')
content = content.replace('<label className="text-xs font-semibold text-muted-foreground uppercase">Amount</label>', '<label className="text-xs font-semibold text-muted-foreground uppercase">Qty</label>')

with open(r'apps/web/src/routes/StockRawMaterial.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
