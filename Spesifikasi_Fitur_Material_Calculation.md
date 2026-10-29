# Spesifikasi Fitur: Material Calculation (Menu Material Planning)

## 1. Tujuan
Menghitung kebutuhan bersih raw material (saat ini: **kertas**; ke depan: PET, E-Flute, Tinta, Lem, dll.) berdasarkan data demand produksi, dikurangi stok yang tersedia (Hotlist, WIP, Stock Raw Material, Outstanding PO), sehingga menghasilkan **jumlah material yang benar-benar perlu dibeli**, dikelompokkan per ukuran/gramatur/supplier.

Perhitungan dijalankan **1x per bulan, di akhir bulan**.

---

## 2. Sumber Data & Kolom yang Digunakan

| No | Sumber Data | Kolom yang Diambil | Foreign Key |
|----|---|---|---|
| 1 | MRP (26 Week Demand) | Part Number, Qty per minggu | Part Number |
| 2 | NPOF | Part Number, Sheeted Size, Formula Material (kg/sheet), Gramatur, Supplier, Material (jenis), UPS | Part Number |
| 3 | Hotlist | Part Number, BI Total | Part Number |
| 4 | WIP (Work in Progress) | Part Number, Lokasi, Qty WIP | Part Number |
| 5 | Stock Raw Material | Item Desc, Supplier, Qty, Unit | Item Desc + Supplier |
| 6 | Outstanding PO | Item Desc, Supplier, Qty Order, Unit, Qty Delivered, Unit | Item Desc + Supplier |

**Catatan foreign key:** MRP, NPOF, WIP, dan Hotlist dihubungkan lewat **Part Number**. NPOF dihubungkan ke Stock Raw Material dan Outstanding PO lewat **Item Desc + Supplier** (karena satu ukuran/gramatur material bisa dipakai banyak part number berbeda).

---

## 3. Istilah & Definisi

| Istilah | Arti |
|---|---|
| **UPS** | Jumlah pcs (item jadi) yang bisa dicetak dalam 1 sheet material |
| **Formula Material** | Berat material dalam kg per 1 sheet (dipakai untuk konversi sheet ↔ kg) |
| **Sheeted Size** | Ukuran lembar material yang dipotong (panjang × lebar, cm) |
| **BI Total (Hotlist)** | Sisa alokasi/stok material per part number yang belum terpakai. *(Istilah "BI" perlu dikonfirmasi ke tim bisnis — diasumsikan "Balance Inventory" atau semacamnya)* |
| **WIP** | Qty barang setengah jadi yang sedang berjalan di lini produksi, per lokasi kerja |
| **Allowance Reject** | Tambahan 5% dari kebutuhan bersih untuk mengantisipasi reject produksi |
| **Lead Time** | Waktu tunggu pemesanan material, **tetap 2 bulan** untuk supplier lokal (Mega) atau **tetap 3 bulan** untuk supplier import (Hanchang, Hansol, XSD/Hongkong Paper) — tidak berubah-ubah dari faktor lain. Dihitung dari **akhir bulan pembelian** (karena pemesanan dilakukan di akhir bulan): misalnya pembelian dilakukan di akhir bulan 1 dengan lead time 3 bulan (import), maka material baru tersedia untuk memenuhi kebutuhan mulai **bulan 5** (bulan 2–4 adalah masa tunggu). |

---

## 4. Aturan Bisnis Umum

1. Jika ukuran material belum tersedia di NPOF → default ke **jumbo roll (180 cm)**.
   - Jika part number tersebut **belum punya data sama sekali di NPOF** (bukan cuma ukurannya yang kosong, tapi datanya belum diinput), sistem **tetap menghitung** item tersebut menggunakan asumsi:
     - Ukuran: **jumbo roll (180 cm)**
     - Gramatur: **gramatur yang paling sering muncul/umum dipakai** (general default, misalnya gramatur mayoritas dari part number lain yang materialnya sejenis)
     - Item ini diberi **tanda/flag "Belum ada informasi dari NPOF"** di hasil perhitungan, supaya user tahu angkanya masih berupa estimasi dan bisa dikoreksi setelah data NPOF-nya dilengkapi.
2. Jika pembelian berbentuk **roll (kg)**, ukuran acuan adalah **panjang/lebar potong (bukan luas)**, misalnya ukuran 61.5 × 43 cm → yang dibeli adalah roll lebar 61.5 cm.
3. Semua konversi pcs ⇄ sheet menggunakan UPS; semua konversi sheet ⇄ kg menggunakan Formula Material.
4. **Pembulatan qty pembelian akhir (hasil di Poin 6.5) harus dibulatkan ke ATAS (ceiling)**, bukan dibulatkan ke terdekat — karena tidak bisa membeli pecahan sheet/kg, dan pembulatan ke bawah berisiko kekurangan stok. *(Ini adalah koreksi dari draf awal, yang tidak menyebutkan arah pembulatan.)*
5. Untuk perhitungan **kebutuhan dikurangi stok/hotlist/PO** (bukan perhitungan surplus/sisa stok itu sendiri), hasil **boleh negatif** — tidak perlu dibatasi ke 0. Jika hasilnya negatif, artinya **kebutuhan sudah tercukupi**: tampilkan angka aslinya (misalnya -3 kg), dan beri keterangan **"Kebutuhan tercukupi, sisa 3 kg"** (nilai absolut dari angka minus tersebut) — jangan cuma ditampilkan sebagai 0. *(Koreksi: draf sebelumnya membatasi hasil ke minimum 0 sehingga informasi sisa/surplus hilang.)*

---

## 5. Alur Perhitungan

> Notasi: `D` = demand qty (pcs) hasil pilihan user di Langkah 2; `UPS`, `FM` (formula material, kg/sheet) dari NPOF.

### Langkah 1 — Ambil kebutuhan produksi
Hitung total qty per part number dari data MRP (26 week demand), untuk **rentang waktu yang dipilih user**.

### Langkah 2 — Hitung ukuran & kebutuhan kotor material
```
Sheets_kotor = D / UPS
Kg_kotor     = Sheets_kotor × FM
```
*Contoh: item A, D = 32.000 pcs, UPS = 2, FM = 0,119002 kg/sheet →*
`Sheets_kotor = 32.000 / 2 = 16.000 sheet`
`Kg_kotor = 16.000 × 0,119002 = 1.904,032 kg`

### Langkah 3 — Netkan dengan Hotlist
Hotlist yang dipakai adalah **sisa Hotlist setelah dikurangi kebutuhan selama lead time** (tetap 2 atau 3 bulan, tergantung supplier):
```
Hotlist_net = MAX(0, BI_Total − Kebutuhan_selama_leadtime)
Pcs_net1    = D − Hotlist_net
Sheets_net1 = Pcs_net1 / UPS
```
*Catatan: `Hotlist_net` tetap dibatasi minimum 0 karena ini adalah sisa stok fisik (tidak mungkin sisa stok minus). Tapi `Pcs_net1` (kebutuhan − hotlist) boleh negatif — jika negatif, artinya kebutuhan sudah tercukupi seluruhnya oleh Hotlist, dan nilai absolutnya adalah sisa Hotlist yang masih ada setelah menutupi kebutuhan. Tampilkan sebagai "Kebutuhan tercukupi, sisa X pcs", bukan dipaksa jadi 0.*

*Contoh: BI Total = 5.000 pcs, kebutuhan lead time = 3.000 pcs → Hotlist_net = 2.000 pcs*
`Pcs_net1 = 32.000 − 2.000 = 30.000 pcs → Sheets_net1 = 15.000 sheet`

### Langkah 4 — Tambahkan Allowance Reject 5%
```
Sheets_net1_allow = Sheets_net1 × 105%
Pcs_net1_allow    = Pcs_net1 × 105%
Kg_net1_allow     = Sheets_net1_allow × FM
```
*Contoh:* `15.000 × 105% = 15.750 sheet`, `30.000 × 105% = 31.500 pcs`, `15.750 × 0,119002 = 1.874,2815 kg`

### Langkah 5 — Netkan dengan WIP
Lokasi WIP dibagi 2 kelompok satuan:
- **Satuan sheet**: Blister, UV, Varnish OPP, Die Cut
- **Satuan pcs**: PH, Laminating, HS, Strip1, Sort, PP1, Join M, Sablon, Hasil PP1, FG, Sort2, Out Going

| Kondisi WIP | Formula |
|---|---|
| Hanya WIP sheet | `Sheets_net2 = Sheets_net1_allow − WIP_sheet` |
| Hanya WIP pcs | `Pcs_net2 = Pcs_net1_allow − WIP_pcs` (lalu `/UPS` untuk dapat sheet) |
| WIP sheet **dan** pcs | `Sheets_net2 = ((Sheets_net1_allow − WIP_sheet) × UPS − WIP_pcs) / UPS` |

*(Ketiga formula ini secara matematis konsisten — kasus "hanya sheet" atau "hanya pcs" adalah bentuk sederhana dari formula gabungan saat salah satu WIP = 0.)*

*Contoh: WIP_sheet = 1.000, WIP_pcs = 4.000 →*
`Sheets_net2 = ((15.750 − 1.000) × 2 − 4.000) / 2 = (29.500 − 4.000)/2 = 12.750 sheet`

### Langkah 6 — Konversi ke berat (Kebutuhan Produksi Bersih)
```
Kg_net2 = Sheets_net2 × FM
```
*Contoh:* `12.750 × 0,119002 = 1.517,2755 kg` → ini disebut **Kebutuhan Produksi Bersih**.

---

## 6. Pengecekan terhadap Stok Gudang & Outstanding PO

Ini **perhitungan terpisah**, memakai **periode lead time (tetap 2 atau 3 bulan sesuai jenis supplier)**, BUKAN periode yang dipilih user di Langkah 1. Jangan tertukar dua periode ini.

### 6.1 Hitung kebutuhan selama lead time
Jalankan ulang Langkah 1–6 di atas, tapi dengan rentang waktu = lead time supplier terkait (2 bulan lokal / 3 bulan import), dihitung dari akhir bulan pembelian → hasil: `LT_need_sheet` dan/atau `LT_need_kg`.

### 6.2 Hitung surplus stok
```
Surplus_sheet = MAX(0, (Stock_sheet + PO_sheet) − LT_need_sheet)
Surplus_kg    = MAX(0, (Stock_kg + PO_kg) − LT_need_kg)
```
*(PO dihitung sebagai Qty Order − Qty Delivered, yaitu sisa yang belum diterima.)*

- Contoh sheet: Stock 50.000 + PO 1.000 = 51.000; kebutuhan lead time 49.000 → **Surplus = 2.000 sheet**
- Contoh kg: Stock 5.000 + PO 1.000 = 6.000; kebutuhan lead time 5.000 → **Surplus = 1.000 kg**

### 6.3 Kurangkan surplus dari Kebutuhan Produksi Bersih (Langkah 6)
Jika surplus tersedia dalam sheet **dan** kg sekaligus, gabungkan dengan mengonversi semuanya ke kg:
```
Shortage_kg = ((Sheets_net2 − Surplus_sheet) × FM) − Surplus_kg
```
*Catatan: `Surplus_sheet`/`Surplus_kg` (di 6.2) tetap dibatasi minimum 0 karena itu sisa stok fisik. Tapi `Shortage_kg` di sini boleh negatif — jika negatif, artinya stok gudang + Outstanding PO sudah cukup menutupi seluruh Kebutuhan Produksi Bersih. Tampilkan sebagai "Kebutuhan tercukupi, sisa X kg" (nilai absolut dari hasil minus tersebut), bukan ditampilkan 0.*
*Contoh (melanjutkan item A: Sheets_net2 = 12.750, Surplus_sheet = 2.000, Surplus_kg = 1.000):*
`((12.750 − 2.000) × 0,119002) − 1.000 = 1.279,2715 − 1.000 = 279,2715 kg`

### 6.4 Konversi kekurangan ke sheet & pcs
```
Shortage_sheet = CEIL(Shortage_kg / FM)     -- jika Shortage_kg > 0
Shortage_pcs   = Shortage_sheet × UPS
```
*Contoh:* `279,2715 / 0,119002 ≈ 2.346,77 → dibulatkan ke atas = 2.347 sheet`
`Pcs = 2.347 × 2 = 4.694 pcs`

Jika `Shortage_kg` **negatif**, tidak perlu dikonversi ke sheet/pcs sebagai kekurangan — cukup tampilkan status "Kebutuhan tercukupi" beserta sisa dalam kg (nilai absolut). Konversi ke sheet boleh ditambahkan sebagai info tambahan (`ROUND(ABS(Shortage_kg) / FM)`, dibulatkan biasa karena ini bukan angka pembelian) jika user ingin tahu setara sheet-nya.

### 6.5 Hasil akhir per part number

Kolom Sheet/Pcs/Kg diisi angka **kekurangan** jika `Shortage_kg > 0`. Jika `Shortage_kg ≤ 0` (kebutuhan tercukupi), kolom-kolom ini diisi keterangan status, bukan angka kekurangan:

| Part Number | Sheet | Pcs | Kg (Roll) | Ukuran | Gramatur | Supplier |
|---|---|---|---|---|---|---|
| Item A | 2.347 | 4.694 | 279,2715 kg | 61,5 × 43 cm | 450 gsm | Hongkong Paper |
| Item B | — | — | Kebutuhan tercukupi, sisa 3 kg | 61,5 × 43 cm | 450 gsm | Hongkong Paper |

Nilai di tabel ini adalah **kekurangan yang perlu dibeli (shortage to purchase)** — bukan kebutuhan produksi total. Penting untuk dilabeli berbeda di UI agar tidak tertukar dengan angka di Langkah 6.

---

## 7. Format Output (Tampilan ke User)

Struktur output di draf awal (Poin 13) sebelumnya masih menampilkan Part Number sebagai baris utama, padahal tujuannya adalah **mengelompokkan per ukuran material**. Disarankan strukturnya:

**Level 1 (baris utama, dikelompokkan per Ukuran + Gramatur + Supplier)** — total gabungan semua part number dengan ukuran sama:

| Ukuran | Gramatur | Supplier | Total Sheet | Total Pcs | Total Kg | ▼ |
|---|---|---|---|---|---|---|
| 61,5 × 43 cm | 450 gsm | Hongkong Paper | 100.000 | 200.000 | 11.900,2 kg | (expand) |

**Level 2 (dropdown, saat baris di atas diklik)** — rincian per part number dalam ukuran tersebut, memakai format tabel di Poin 6.5.

---

## 8. Ringkasan Perbaikan/Koreksi dari Draf Awal

1. **Penamaan variabel diperjelas** per tahap (Kebutuhan Kotor → Net Hotlist+Allowance → Net WIP → Kebutuhan Produksi Bersih → Shortage to Purchase), karena draf awal memakai kata "kebutuhan" berulang untuk angka yang berbeda-beda di tiap langkah — berisiko salah implementasi.
2. **Ditambahkan aturan pembulatan qty beli ke atas (ceiling)**, karena tidak bisa membeli pecahan sheet, dan draf awal tidak menyebutkan arah pembulatan.
3. **Ditambahkan aturan penanganan nilai negatif pada perhitungan kebutuhan vs stok/hotlist**: hasilnya tidak dipaksa jadi 0, melainkan ditampilkan apa adanya dan diberi label "Kebutuhan tercukupi, sisa X" — supaya informasi surplus tidak hilang. (Pembatas minimum 0 tetap dipakai khusus untuk angka sisa stok fisik itu sendiri seperti `Hotlist_net` dan `Surplus_sheet/kg`, karena stok fisik tidak mungkin minus.)
4. **Dipisahkan dengan tegas** antara "periode yang dipilih user" (dipakai di Langkah 1–6) vs "periode lead time" (tetap 2 atau 3 bulan sesuai jenis supplier, dipakai khusus untuk menghitung buffer di Bagian 6) — di draf awal keduanya bercampur dalam satu narasi sehingga mudah disalahpahami sebagai periode yang sama. Ditambahkan juga penjelasan bahwa lead time dihitung dari **akhir bulan pembelian** (karena pemesanan dilakukan di akhir bulan).
5. **Struktur output akhir diperbaiki**: dikelompokkan per Ukuran/Gramatur/Supplier di level atas (sesuai tujuan agregasi yang disebutkan), dengan Part Number sebagai detail dropdown — bukan sebaliknya seperti contoh tabel di draf awal.
6. **Istilah "BI Total" ditandai perlu konfirmasi** ke tim bisnis karena singkatannya tidak dijelaskan di dokumen asli.
7. Formula WIP gabungan (sheet + pcs) dicek ulang secara matematis — hasilnya konsisten dengan dua kasus sederhana (hanya sheet / hanya pcs), sehingga bisa diimplementasikan sebagai satu formula umum saja.
8. Semua angka contoh di draf asli **sudah diverifikasi secara matematis dan benar** (16.000 sheet, 1.904,032 kg, 15.750 sheet, 1.874,2815 kg, 12.750 sheet, 1.517,2755 kg, 279,2715 kg, dll.) — tidak ada kesalahan hitung, hanya perlu kerapian struktur dan penamaan.

---

## 9. Rekomendasi Ukuran Material & Informasi Waste

### 9.1 Tujuan & sifat fitur

Menampilkan **ukuran material yang lebih besar/kelipatan** dari ukuran kebutuhan beserta **estimasi waste** (buangan) dari pemakaian ukuran tersebut.

**Fitur ini INFORMASI murni** (keputusan user 2026-10-28):

- Tidak mengubah alokasi stok/PO, `Hotlist`, `Allowance 5%`, `WIP`, `Shortage`, `Stock As Of`, maupun `End Ind`.
- **Trim belum diperhitungkan** ke alokasi. Karena itu setiap panel wajib menampilkan catatan tersebut, dan angka waste tidak boleh disamakan dengan angka kekurangan.
- Tidak ada endpoint baru dan tidak ada migrasi database: hasil disimpan di dalam `CycleResult.resultSnapshot` (JSON).

### 9.2 Definisi waste

> **Waste ukuran (trim)** = bagian material yang dipakai tetapi tidak menjadi ukuran kebutuhan, karena ukuran material lebih besar/kelipatan.

Contoh: kebutuhan **59 × 60 cm**, material **roll 60 cm** → kelebihan **1 cm** per lembar, `multiplier = 1` (60 ÷ 2 = 30 cm tidak cukup untuk 2 potong).

```
m         = jumlah potong ukuran kebutuhan per satuan material (1..6)
ratio     = luas material ÷ luas kebutuhan  (gulungan: lebar ÷ lebar)
waste/lbr = fm × (ratio/m − 1)              (kg per lembar kebutuhan)
waste %   = 1 − m / ratio                   (murni geometri)
```

Material **118 cm** untuk kebutuhan **59 cm** menghasilkan `m = 2`, `ratio = 2` → waste **0%**, walaupun ukurannya jauh lebih besar. Inilah bedanya "kelebihan yang berguna" dan "kelebihan yang terbuang".

### 9.3 Dua basis waste

Keduanya memakai rumus yang sama; hanya **Q** (jumlah lembar) yang berbeda:

| Basis | Q | Arti |
|---|---|---|
| **Waste pembelian** | `Σ shortageSheet` per part | Waste dari material yang benar-benar perlu dibeli pada periode ini |
| **Waste produksi** | `Σ sheetsNet2` per part | Waste bila ukuran tersebut dipakai untuk SELURUH kebutuhan produksi bersih (termasuk yang sudah ditutup stok/hotlist/WIP) |

```
stockUnits(Q)    = CEIL(Q / m)              (gulungan: Q / m, tanpa pembulatan)
kgMaterial(Q)    = stockUnits × fm × ratio
kgUsed(Q)        = Q × fm
trimWaste(Q)     = Q × fm × (ratio/m − 1)
roundingWaste(Q) = kgMaterial − kgUsed − trimWaste   (sisa pembulatan lembar)
totalWaste(Q)    = trimWaste + roundingWaste
```

Contoh (kebutuhan 59 × 60 cm, `fm = 0,15 kg/lbr`, roll 60 cm, kebutuhan 10.000 lbr, tanpa pembelian):

- Waste pembelian = **0 kg** (tidak ada yang dibeli)
- Waste produksi = 10.000 × 0,15 × (60/59 − 1) = **25,42 kg** (1,67%)
- Roll terpakai = **1.525,42 kg**; sisa sistem masih 1.000 kg karena trim belum diterapkan

### 9.4 Kandidat ukuran

| Sumber | Keterangan |
|---|---|
| Stok & Outstanding PO | Mengikuti aturan `matchSize()` yang sama dengan alokasi (gramatur sama, supplier sama bila `MATERIAL_REQUIRE_SUPPLIER=true`, lebar ≥ kebutuhan, selisih ≤ toleransi, atau kelipatan 2–6 dengan panjang sama) |
| NPOF | Ukuran yang pernah dipakai part lain dengan gramatur & supplier sama (belum tentu ada stok) |
| Ukuran standar | Daftar `MATERIAL_REC_STANDARD_SIZES` (default `180` cm, jumbo roll) |
| Ukuran pas | Selalu disertakan sebagai pembanding (waste 0%), tidak dianggap tersedia |

Kandidat yang **dikeluarkan user** untuk grup tersebut (`material_calc_exclusions`) tidak dihitung ketersediaannya. Ketersediaan dihitung dari sisa nyata setelah alokasi (`pool.kgRemaining/sheetRemaining` − pemakaian − bagian yang dikeluarkan).

### 9.5 Urutan rekomendasi

1. Bisa dipenuhi sebelum kebutuhan (stok sekarang, atau PO tiba ≤ minggu kebutuhan pertama)
2. Waste per lembar terkecil
3. Kg material terkecil (pembelian; bila tidak ada pembelian dipakai kg produksi)
4. Ukuran fisik terkecil
5. Potongan per lembar terbanyak

### 9.6 Tampilan

Tab ketiga **"Rekomendasi & Waste"** pada tiap baris ukuran: konteks kebutuhan, disclaimer, tabel semua opsi (ukuran, sumber, potong/lbr, kelebihan cm, waste per lembar, waste pembelian, waste produksi, ketersediaan, catatan), dan baris pembanding ukuran pas. Baris grup juga menampilkan badge kecil `Waste ±X%` bila rekomendasi menghasilkan trim.

Belum ada ekspor PDF/Excel untuk bagian ini (sesuai permintaan).

### 9.7 Konfigurasi

| Env | Default | Fungsi |
|---|---|---|
| `MATERIAL_REC_MAX_OPTIONS` | `8` | Jumlah alternatif per grup |
| `MATERIAL_REC_MAX_MULTIPLIER` | `6` | Kelipatan maksimum yang diuji |
| `MATERIAL_REC_INCLUDE_NPOF` | `true` | Sertakan ukuran dari NPOF |
| `MATERIAL_REC_STANDARD_SIZES` | `180` | Ukuran standar (cm), dipisah koma |

### 9.8 Waste dari pemakaian nyata (stok & PO)

Selain dua basis skenario di §9.3, ada **waste pemakaian nyata**: waste dari lot stok dan baris Outstanding PO yang **benar-benar terpakai** grup ukuran tersebut.

```
wasteKg  = usedKg × (ratio/m − 1)
wastePct = 1 − m/ratio            (porsi terbuang dari material yang dipakai)
```

`usedKg` = kg yang menjadi produk (bagian teralokasi). Contoh: produk 1.575 kg dari roll 60 cm untuk kebutuhan 59 cm → material terpakai 1.601,69 kg, waste **26,69 kg (1,67%)**.

Ditampilkan di:

| Lokasi | Isi |
|---|---|
| Baris `Stock As Of` (Material Calculation) | Badge `Waste X kg (Y%)` + kolom **Waste** per lot + baris total di dropdown rincian stok |
| Baris `Outstanding PO` | Badge `Waste PO X kg (Y%)` + kolom **Waste** per nomor PO |
| Snapshot hasil | `weeklyMatrix.summary.stockWasteKg/stockWastePct/poWasteKg/poWastePct`, per lot `wasteKg/wastePct/trimWidthCm` |

**Penting:** angka ini juga informasi saja — tidak mengurangi `stockAsOf`, `outstandingPo`, `shortage`, maupun `endInd`.

Catatan teknis: `sizeRatio()` mengabaikan "panjang" yang bukan dimensi sungguhan (mis. `DUPLEX 450GSM/ 69CM (27")` — 27 adalah inci) dan tidak pernah menghasilkan rasio < 1, sehingga waste tidak bisa negatif.

### 9.9 Rekomendasi alokasi di menu Raw Material Stock

Halaman **Raw Material Stock** (Material Planning) menampilkan panel **"Rekomendasi alokasi material"** saat sebuah item di-expand. Panel itu menjawab: *lot ini bisa dipakai untuk part number / ukuran mana saja, dan berapa waste-nya.*

- Sumber daftar part = snapshot hasil perhitungan periode terpilih (`CycleResult.resultSnapshot`), sehingga konsisten dengan halaman Material Calculation.
- Aturan cocok sama dengan alokasi: gramatur sama, supplier sama (bila `MATERIAL_REQUIRE_SUPPLIER=true`), lebar ≥ kebutuhan, selisih ≤ toleransi, atau kelipatan 2–6.
- Kolom: Part Number, Ukuran & Gramatur, Kebutuhan (lbr/kg), Potong/lbr, Waste per lembar, Bisa dialokasikan (kg), Estimasi waste (kg), Terpakai di ukuran ini (kg).
- Endpoint: `GET /api/v1/stock-raw-material/allocation-recommendation?periodId=&itemDesc=&supplier=`. Read-only; periode yang belum dihitung menampilkan ajakan menjalankan Hitung.

### 9.10 Lokasi kode

| Bagian | File |
|---|---|
| Pencocokan ukuran/gramatur (dipindah agar tidak ada impor melingkar) | `apps/api/src/lib/materialSizeMatch.ts` |
| Perhitungan rekomendasi & waste | `apps/api/src/lib/materialSizeRecommendation.ts` |
| Integrasi ke hasil perhitungan | `apps/api/src/lib/materialCalcEngine.ts` (`MaterialGroupResult.sizeRecommendation`) |
| Panel UI (Material Calculation) | `apps/web/src/components/SizeRecommendationPanel.tsx` |
| Panel UI (Raw Material Stock) | `apps/web/src/components/StockAllocationPanel.tsx` |
| Endpoint rekomendasi alokasi | `apps/api/src/routes/stockRawMaterial.ts` |
| Verifikasi | `apps/api/verify-size-recommendation.ts` (`pnpm --filter @pdits/api verify:size-recommendation`) |
