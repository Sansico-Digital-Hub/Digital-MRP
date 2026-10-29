import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasourceUrl: 'mysql://root:@localhost:3306/planner_project',
});

// ── Salinan persis dari materialCalc.ts ────────────────────────────────────
function buildNpofDescriptor(gramatur: string, sheetedSize: string): string {
  return `${gramatur} ${sheetedSize}`.toLowerCase().replace(/\s+/g, ' ').trim();
}

function fuzzyMatch(itemDesc: string, npofDescriptor: string): boolean {
  const desc = itemDesc.toLowerCase();
  const tokens = npofDescriptor.split(/[\s,x×\/]+/).filter((t) => t.length >= 2);
  if (tokens.length === 0) return false;
  return tokens.every((token) => desc.includes(token));
}

// ── Parser alternatif: pecah jadi komponen terstruktur ────────────────────
function parseStructured(text: string) {
  const s = String(text || '').toLowerCase().replace(/,/g, '.');
  const gsm = s.match(/(\d{3,4})\s*gsm/)?.[1] ?? s.match(/^\s*(\d{3,4})\b/)?.[1] ?? null;
  const nums = [...s.matchAll(/(\d+(?:\.\d+)?)/g)].map((m) => parseFloat(m[1]));
  // buang angka yang sama dengan gsm
  const dims = nums.filter((n) => String(n) !== String(gsm) && n > 20);
  const type = ['duplex', 'r-pet', 'pet', 'flute', 'duplek', 'kraft', 'artpaper', 'paper']
    .find((t) => s.includes(t)) ?? null;
  return { gsm: gsm ? Number(gsm) : null, dims, type };
}

async function main() {
  const npof = await prisma.npofMaterial.findMany();
  const stocks = await prisma.stockRawMaterial.findMany();
  const pos = await prisma.outstandingPO.findMany();

  // Kelompokkan stok per itemDesc+supplier (di-JUMLAH, sesuai keputusan user)
  const stockAgg = new Map<string, { qty: number; lots: number; desc: string; supplier: string }>();
  for (const s of stocks) {
    const key = `${s.itemDesc}||${s.supplier || ''}`;
    const cur = stockAgg.get(key) || { qty: 0, lots: 0, desc: s.itemDesc, supplier: s.supplier || '' };
    cur.qty += s.qty;
    cur.lots += 1;
    stockAgg.set(key, cur);
  }

  console.log('=== A. APAKAH FUZZY MATCH SEKARANG MENEMUKAN STOK? ===');
  let matchedCount = 0;
  const matchedSamples: string[] = [];
  const unmatchedSamples: string[] = [];

  for (const n of npof) {
    if (!n.gramatur || !n.sheetedSize) continue;
    const desc = buildNpofDescriptor(n.gramatur, n.sheetedSize);
    let found: string | null = null;
    for (const [key, st] of stockAgg.entries()) {
      if (fuzzyMatch(st.desc, desc)) {
        found = key;
        break;
      }
    }
    if (found) {
      matchedCount++;
      if (matchedSamples.length < 10) {
        matchedSamples.push(`✅ ${n.partNumber} | NPOF:"${n.gramatur} ${n.sheetedSize}" → STOK:"${found}"`);
      }
    } else if (unmatchedSamples.length < 15) {
      unmatchedSamples.push(`❌ ${n.partNumber} | NPOF gramatur="${n.gramatur}" size="${n.sheetedSize}" (material=${n.material})`);
    }
  }

  console.log(`NPOF dengan gramatur+size lengkap : ${npof.filter((n) => n.gramatur && n.sheetedSize).length}`);
  console.log(`Yang BERHASIL match ke stok       : ${matchedCount}`);
  console.log('\n-- contoh yang match --');
  matchedSamples.forEach((s) => console.log('  ' + s));
  console.log('\n-- contoh yang TIDAK match --');
  unmatchedSamples.forEach((s) => console.log('  ' + s));

  console.log('\n=== B. SEMUA ITEM DESC STOK YANG ADA (56 grup) ===');
  console.table(
    [...stockAgg.entries()]
      .map(([k, v]) => ({
        itemDesc: v.desc,
        supplier: v.supplier,
        lots: v.lots,
        totalQty: Math.round(v.qty),
      }))
      .sort((a, b) => b.totalQty - a.totalQty)
      .slice(0, 30),
  );

  console.log('\n=== C. SEMUA ITEM DESC PO YANG ADA ===');
  console.table(
    pos.map((p) => ({
      itemDesc: p.itemDesc,
      supplier: p.supplierName,
      qty: p.qtyOrder,
      unit: p.qtyOrderUnit,
    })),
  );

  console.log('\n=== D. APAKAH MASALAHNYA GSM BERBEDA? (uji match longgar) ===');
  const stockList = [...stockAgg.values()];
  const posList = pos;

  let looseGsmOnly = 0;
  let looseWidthOnly = 0;
  let looseTypeOnly = 0;
  const samples: string[] = [];

  for (const n of npof) {
    if (!n.gramatur || !n.sheetedSize) continue;
    const np = parseStructured(`${n.gramatur} ${n.sheetedSize}`);
    const width = np.dims[0];

    const gsmHit = stockList.some((s) => {
      const sp = parseStructured(s.desc);
      return np.gsm && sp.gsm && np.gsm === sp.gsm;
    });
    const widthHit = stockList.some((s) => {
      const sp = parseStructured(s.desc);
      return width && sp.dims.some((d) => Math.abs(d - width) < 0.6);
    });
    const typeHit = stockList.some((s) => {
      const sp = parseStructured(s.desc);
      return np.type && sp.type && np.type === sp.type;
    });

    if (gsmHit) looseGsmOnly++;
    if (widthHit) looseWidthOnly++;
    if (typeHit) looseTypeOnly++;

    if (samples.length < 8) {
      samples.push(
        `NPOF ${n.partNumber}: gsm=${np.gsm} dims=[${np.dims.join(',')}] type=${np.type} || stok → gsm:${gsmHit ? 'ya' : 'tidak'} lebar:${widthHit ? 'ya' : 'tidak'} jenis:${typeHit ? 'ya' : 'tidak'}`,
      );
    }
  }

  console.log('Dari NPOF yang lengkap, berapa yang punya KEMIRIPAN dengan stok:');
  console.table([
    { kriteria: 'GSM sama persis', jumlah: looseGsmOnly },
    { kriteria: 'Lebar sama (±0.6 cm)', jumlah: looseWidthOnly },
    { kriteria: 'Jenis material sama', jumlah: looseTypeOnly },
    { kriteria: 'TOTAL NPOF lengkap', jumlah: npof.filter((n) => n.gramatur && n.sheetedSize).length },
  ]);
  console.log('\n-- detail contoh --');
  samples.forEach((s) => console.log('  ' + s));

  console.log('\n=== E. STOK: BERAPA GRUP YANG PUNYA >1 TANGGAL? ===');
  const dateAgg = new Map<string, Set<string>>();
  for (const s of stocks) {
    const key = `${s.itemDesc}||${s.supplier || ''}`;
    const set = dateAgg.get(key) || new Set<string>();
    set.add(new Date(s.date).toISOString().slice(0, 10));
    dateAgg.set(key, set);
  }
  const multiDate = [...dateAgg.entries()].filter(([, v]) => v.size > 1);
  console.log(`Grup dengan >1 tanggal stok: ${multiDate.length} dari ${dateAgg.size}`);
  console.table(
    multiDate.map(([k, v]) => ({
      itemDesc: k.split('||')[0].slice(0, 35),
      supplier: k.split('||')[1],
      tanggal: [...v].join(', '),
    })),
  );

  console.log('\n=== F. PO: APAKAH itemDesc PO MENEMUKAN NPOF? ===');
  const poMatch = pos.map((p) => {
    let hit: string | null = null;
    for (const n of npof) {
      if (!n.gramatur || !n.sheetedSize) continue;
      if (fuzzyMatch(p.itemDesc, buildNpofDescriptor(n.gramatur, n.sheetedSize))) {
        hit = `${n.partNumber} (${n.gramatur} ${n.sheetedSize})`;
        break;
      }
    }
    return { itemDesc: p.itemDesc, supplier: p.supplierName, unit: p.qtyOrderUnit, qty: p.qtyOrder, matchNpof: hit ?? '— TIDAK ADA' };
  });
  console.table(poMatch);

  console.log('\n=== G. PROYEKSI DAMPAK: STOK SEBELUM vs SESUDAH (jumlah lot) ===');
  const beforeAfter = [...stockAgg.entries()]
    .map(([k, v]) => ({
      itemDesc: v.desc.slice(0, 35),
      supplier: v.supplier,
      lots: v.lots,
      jumlahSemuaLot: Math.round(v.qty),
    }))
    .sort((a, b) => b.jumlahSemuaLot - a.jumlahSemuaLot)
    .slice(0, 12);
  console.table(beforeAfter);
}

main()
  .catch((e) => {
    console.error('ERROR:', e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
