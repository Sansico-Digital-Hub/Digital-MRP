import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasourceUrl: 'mysql://root:@localhost:3306/planner_project',
});

const norm = (s: string) => String(s || '').replace(/,/g, '.').toLowerCase();

/** Ambil gramatur dari teks ("DUPLEX 450GSM/ 68.5CM" -> 450) */
function parseGsm(text: string): number | null {
  const s = norm(text);
  const m = s.match(/(\d{3,4})\s*gsm/) ?? s.match(/^\s*(\d{3,4})\b/);
  return m ? Number(m[1]) : null;
}

/** Ambil semua angka > 20 yang BUKAN gramatur (dimensi dalam cm) */
function parseDims(text: string): number[] {
  const s = norm(text);
  const gsm = parseGsm(text);
  return [...s.matchAll(/(\d+(?:\.\d+)?)/g)]
    .map((m) => parseFloat(m[1]))
    .filter((n) => n > 20 && n !== gsm);
}

interface Req {
  partNumber: string;
  gsm: number;
  w: number;        // lebar yang dibutuhkan (dimensi pertama)
  l: number | null; // panjang (kalau ada)
  sheetedSize: string;
}

async function main() {
  const npof = await prisma.npofMaterial.findMany();
  const stocks = await prisma.stockRawMaterial.findMany();

  // ── Stok: jumlahkan semua lot per itemDesc+supplier ──────────────────────
  const stockAgg = new Map<string, { desc: string; supplier: string; qty: number; lots: number }>();
  for (const s of stocks) {
    const key = `${s.itemDesc}||${s.supplier || ''}`;
    const cur = stockAgg.get(key) || { desc: s.itemDesc, supplier: s.supplier || '', qty: 0, lots: 0 };
    cur.qty += s.qty;
    cur.lots += 1;
    stockAgg.set(key, cur);
  }

  const stockList = [...stockAgg.entries()].map(([key, v]) => {
    const dims = parseDims(v.desc);
    return {
      key,
      desc: v.desc,
      supplier: v.supplier,
      gsm: parseGsm(v.desc),
      dims,
      isRoll: dims.length === 1,
      qty: v.qty,
    };
  });

  // ── Permintaan dari NPOF ─────────────────────────────────────────────────
  const reqs: Req[] = [];
  for (const n of npof) {
    if (!n.gramatur || !n.sheetedSize) continue;
    const size = String(n.sheetedSize).trim();
    if (!size || size === '-') continue;
    if (/nebeng|satu\s*layout|tidak\s*dihitung/i.test(size)) continue;
    const gsm = Number(String(n.gramatur).replace(',', '.'));
    if (!gsm) continue;
    const dims = parseDims(size);
    if (dims.length === 0) continue;
    reqs.push({
      partNumber: n.partNumber,
      gsm,
      w: dims[0],
      l: dims[1] ?? null,
      sheetedSize: size,
    });
  }

  console.log(`NPOF dengan ukuran valid : ${reqs.length}`);
  console.log(`Item stok unik           : ${stockList.length}`);

  // ── Uji sensitivitas toleransi ───────────────────────────────────────────
  console.log('\n=== A. SENSITIVITAS TOLERANSI (gramatur sama + lebar stok >= kebutuhan) ===');
  const tolerances = [0, 1, 2, 3, 5, 10, 15, 30, 999];
  const sensitivity: { toleransi: string; partMatch: number; persen: string }[] = [];

  for (const tol of tolerances) {
    let hit = 0;
    for (const r of reqs) {
      const found = stockList.some((s) => {
        if (s.gsm !== r.gsm) return false;
        const w = s.dims[0];
        if (w === undefined) return false;
        const diff = w - r.w;
        return diff >= 0 && diff <= tol;
      });
      if (found) hit++;
    }
    sensitivity.push({
      toleransi: tol === 999 ? 'tanpa batas' : `+${tol} cm`,
      partMatch: hit,
      persen: `${((hit / reqs.length) * 100).toFixed(1)}%`,
    });
  }
  console.table(sensitivity);

  // ── Detail dengan toleransi 2 cm ─────────────────────────────────────────
  const TOL = 2;
  console.log(`\n=== B. HASIL DENGAN TOLERANSI ${TOL} CM ===`);

  const matched: { req: Req; stockKeys: string[] }[] = [];
  const unmatched: Req[] = [];

  for (const r of reqs) {
    const keys = stockList
      .filter((s) => {
        if (s.gsm !== r.gsm) return false;
        const w = s.dims[0];
        if (w === undefined) return false;
        const diff = w - r.w;
        return diff >= 0 && diff <= TOL;
      })
      .map((s) => s.key);
    if (keys.length > 0) matched.push({ req: r, stockKeys: keys });
    else unmatched.push(r);
  }

  console.log(`Match  : ${matched.length} dari ${reqs.length} (${((matched.length / reqs.length) * 100).toFixed(1)}%)`);
  console.log(`Tidak  : ${unmatched.length} (${((unmatched.length / reqs.length) * 100).toFixed(1)}%)`);

  console.log('\n-- contoh yang MATCH (tol 2cm) --');
  matched.slice(0, 10).forEach((m) => {
    console.log(`  ✅ ${m.req.partNumber}: butuh ${m.req.gsm}gsm ${m.req.w}cm → ${m.stockKeys.join(' | ')}`);
  });

  console.log('\n-- contoh yang TIDAK match (tol 2cm) — lebar stok terdekat di atas kebutuhan --');
  const nearMiss = unmatched.slice(0, 12).map((r) => {
    const cands = stockList
      .filter((s) => s.gsm === r.gsm && s.dims[0] !== undefined && s.dims[0] >= r.w)
      .sort((a, b) => a.dims[0] - b.dims[0]);
    const nearest = cands[0];
    return {
      partNumber: r.partNumber,
      butuhGsm: r.gsm,
      butuhLebar: r.w,
      lebarStokTerdekat: nearest ? nearest.dims[0] : '—',
      selisih: nearest ? `${(nearest.dims[0] - r.w).toFixed(1)} cm` : '—',
      stok: nearest ? nearest.desc.slice(0, 30) : '(tidak ada stok dgn gramatur sama)',
    };
  });
  console.table(nearMiss);

  // ── C. MASALAH BERBAGI STOK (sharing) ────────────────────────────────────
  console.log('\n=== C. STOK YANG DIPAKAI BERSAMA OLEH BEBERAPA PART ===');
  const stockUsage = new Map<string, Set<string>>();
  for (const m of matched) {
    for (const k of m.stockKeys) {
      const set = stockUsage.get(k) || new Set<string>();
      set.add(m.req.partNumber);
      stockUsage.set(k, set);
    }
  }
  const shared = [...stockUsage.entries()]
    .filter(([, parts]) => parts.size > 1)
    .sort((a, b) => b[1].size - a[1].size);

  console.log(`Item stok yang dipakai >1 part : ${shared.length} dari ${stockUsage.size}`);
  console.table(
    shared.slice(0, 12).map(([k, parts]) => {
      const st = stockAgg.get(k)!;
      return {
        itemDesc: st.desc.slice(0, 32),
        supplier: st.supplier,
        totalKg: Math.round(st.qty),
        dipakaiOlehNPart: parts.size,
        totalKgJikaDiberikanKeSemua: Math.round(st.qty * parts.size),
      };
    }),
  );

  const totalDoubleCount = shared.reduce((sum, [k, parts]) => sum + stockAgg.get(k)!.qty * (parts.size - 1), 0);
  console.log(`\n⚠️ Total kelebihan hitung (double-count) = ${Math.round(totalDoubleCount).toLocaleString('id-ID')} kg`);
  console.log('   (angka ini muncul karena stok yang sama dihitung penuh untuk SETIAP part yang cocok)');

  // ── D. Berapa part yang match paling banyak? ─────────────────────────────
  console.log('\n=== D. DISTRIBUSI: SATU PART COCOK KE BERAPA ITEM STOK ===');
  const dist = new Map<number, number>();
  for (const m of matched) {
    const n = m.stockKeys.length;
    dist.set(n, (dist.get(n) || 0) + 1);
  }
  console.table(
    [...dist.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([n, count]) => ({ jumlahItemStokCocok: n, jumlahPart: count })),
  );
}

main()
  .catch((e) => {
    console.error('ERROR:', e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
