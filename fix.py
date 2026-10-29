import re

with open(r'apps/web/src/hooks/useOutstandingPO.ts', 'r', encoding='utf-8') as f:
    content = f.read()
content = content.replace('const queryClient = useQueryClient();', '// const queryClient = useQueryClient();')
with open(r'apps/web/src/hooks/useOutstandingPO.ts', 'w', encoding='utf-8') as f:
    f.write(content)

with open(r'apps/web/src/routes/NpofMaterials.tsx', 'r', encoding='utf-8') as f:
    content = f.read()
content = content.replace('item.material.toLowerCase()', 'item.material?.toLowerCase()')
with open(r'apps/web/src/routes/NpofMaterials.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

with open(r'apps/web/src/stores/authStore.ts', 'r', encoding='utf-8') as f:
    content = f.read()
content = content.replace('const module =', '// const module =')
with open(r'apps/web/src/stores/authStore.ts', 'w', encoding='utf-8') as f:
    f.write(content)
