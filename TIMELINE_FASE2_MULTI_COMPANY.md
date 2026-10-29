# Timeline Fase 2 — MRP Digital Multi-Company & Multi-Customer

> **Dokumen perencanaan.** Tidak ada perubahan code dalam dokumen ini.
>
> | Item | Nilai |
> |---|---|
> | Tanggal dibuat | 2 Oktober 2026 |
> | Basis | Timeline Fase 1 (versi extended, 1 customer utama) + hasil meeting improvement 2 Okt 2026 |
> | Status | Draft — menunggu keputusan arsitektur (baris 7) |
> | Cakupan | Local customer + Export customer dalam **satu project/system**, data dipisah per **Company** dan per **Customer** |

---

## 1. Asumsi & kerangka fase

| Item | Nilai |
|---|---|
| Fase 1 (1 customer utama) | selesai **16-Nov-2026** (versi extended) |
| Fase 2 (Local + Export, 1 system) | **23-Nov-2026 → awal April 2027** (± 19 minggu) |
| Kenapa durasinya mirip Fase 1 (± 19,5 minggu) | tetap dimulai dari memahami alurnya (discovery lokal & export), lalu development, test, deploy, handover |
| Model data | dipisah per **Company** (entitas/plant) dan per **Customer/Segment** (Lokal, Export, customer utama) |
| Buffer libur | Nataru (25-Des-2026 – 1-Jan-2027) dan Idul Fitri 1448 H (± 8–12 Maret 2027) |
| PIC yang dipakai | Castin, Clay, Natalia, Thalia (mengikuti Fase 1) — PIC planner lokal & export perlu ditunjuk |

---

## 2. Timeline Fase 2 (skeleton)

Siap ditempel ke Excel yang sama dengan Fase 1.

| No | Aktivitas | PIC | Due Date | Propose | Extended Due Date | Status |
|----|-----------|-----|----------|---------|-------------------|--------|
| 1 | Pelajari proses MRP & 4 Week Commitment (Data Source PPIC) — **customer lokal** | Castin | 23-Nov | | **23-Nov-2026** | Open |
| 2 | Pelajari alur **Export** (syarat dokumen, PPIC/Sales export) + bandingkan dengan customer utama | Castin | 25-Nov | | **25-Nov-2026** | Open |
| 3 | Cari tahu output Material Planning per segmen (Lokal vs Export) | Thalia | 27-Nov | | **27-Nov-2026** | Open |
| 4 | Identifikasi kesulitan (Pain Point) per company/customer | Castin | 30-Nov | | **30-Nov-2026** | Open |
| 5 | Isi Form Current Process (per company & tipe customer) | Castin | 3-Des | | **3-Des-2026** | Open |
| 6 | Brainstorming RCA & Isi Form Future (struktur Company/Customer) | Clay | 11-Des | | **11-Des-2026** | Open |
| **7** | **[BARU] Design & Keputusan Arsitektur Multi-Company / Multi-Customer** | Natalia + Clay | 31-Des | | **8-Jan-2027** | Open |
| **8** | **Development Multi-Company & Multi-Customer** | Natalia | 12-Feb | 26-Feb | **5-Maret-2027** | Open |
| 9 | User Testing (siklus Lokal + siklus Export) | Thalia | 12-Maret | 15-Maret | **16-Maret-2027** | Open |
| 10 | Deployment (company lokal & company export) | Natalia | 16-Maret | 22-Maret | **18-Maret-2027** | Open |
| 11 | Bug Fix & Improvement + **Monitoring 1 minggu** | Natalia | 26-Maret | 30-Maret | **26-Maret-2027** | Open |
| 12 | Final Review & Handover (per company) | Thalia | 30-Maret | 6-Apr | **1-Apr-2027** | Open |

> **Catatan:** baris **7** adalah baris tambahan yang tidak ada di Fase 1. Gunanya sebagai *decision gate* "gabung vs pisah" — keputusan harus diambil **sebelum** coding, bukan di tengah development.

### View per bulan

| Periode | Fokus |
|---|---|
| Nov–Des 2026 | Discovery alur lokal & export, Pain Point, Current/Future Process (baris 1–6) |
| Des 2026 – awal Jan 2027 | Desain & keputusan arsitektur, desain skema company/customer (baris 7) |
| Jan – awal Mar 2027 | Development multi-company & multi-customer (baris 8) |
| Pertengahan Mar 2027 | User testing 2 segmen, deployment (baris 9–10) |
| Akhir Mar – awal Apr 2027 | Bug fix + monitoring 1 minggu, final review & handover (baris 11–12) |

---

## 3. Detail baris 7 & 8 (Development)

| No | Aktivitas | PIC | Extended Due Date |
|----|-----------|-----|-------------------|
| 7.1 | Data inventory: mana yang bisa dipakai bersama (NPOF, item master, supplier, formula, engine) vs wajib terpisah (demand, stok, PO, hasil calc, user) | Natalia + Clay | 18-Des |
| 7.2 | Definisi entitas: **Company** vs **Customer/Segment** (Lokal, Export) + hirarki & relasinya | Natalia | 24-Des |
| 7.3 | Keputusan arsitektur + sign-off manajemen: 1 sistem multi-company (gabung) vs instance terpisah (pisah) | Natalia + Clay | 31-Des |
| 7.4 | Desain teknis: penempatan `companyId`/`customerId` mengikuti pola scope yang sudah ada (`periodId` + `moduleType`) + aturan unique/index | Natalia | 8-Jan |
| 8.1 | Migrasi data existing: customer utama → **Company #1** + backfill, tanpa kehilangan periode | Natalia | 15-Jan |
| 8.2 | Master data **bersama**: NPOF & Item master tetap global (+ opsi override per company bila perlu) | Natalia | 22-Jan |
| 8.3 | Master data **terpisah**: Weekly Demand, Hotlist, WIP, Stock RM, OS PO per company + periode | Natalia | 29-Jan |
| 8.4 | Import Excel per customer: profil kolom/parser berbeda — filter yang sekarang hardcode "MTL" (`refB`) dijadikan aturan per customer | Natalia | 5-Feb |
| 8.5 | Scoping & isolasi: semua query dan semua `@@unique` diawali `companyId` (perluas pola `periodScope.ts`) | Natalia | 10-Feb |
| 8.6 | Role & permission per company (planner company A tidak boleh lihat company B) di `permissions.ts` | Natalia | 15-Feb |
| 8.7 | UI: switcher Company + filter Customer di **semua** halaman (termasuk Item Tracking & Shortage Detail yang saat ini belum ikut ter-scope) | Natalia | 22-Feb |
| 8.8 | Material Calculation per company — engine tetap satu, parameter per company (tolerance, sheetsPerRim, aturan NPOF) | Natalia | 26-Feb |
| 8.9 | PDF & dokumen per company: header/logo + kolom ttd (Dibuat oleh, Diperiksa oleh, GM (acc), Plant Manager (acc)) | Natalia | 2-Maret |
| 8.10 | Report konsolidasi lintas company (opsional, boleh di-defer) | Natalia | 4-Maret |
| 8.11 | Dokumentasi & SOP per company + update timeline per menu/fitur secara detail | Natalia + Thalia | 5-Maret |
| 11.1 | Monitoring 1 minggu (hypercare) + history minggu sebelumnya yang sudah ter-update | Natalia | 22–26-Maret |

Durasi development ± 11 minggu (15-Des → 5-Maret). Lebih singkat dari Fase 1 (± 14 minggu termasuk improvement) karena engine kalkulasi **tidak dibangun ulang** — hanya ditambah satu dimensi scope.

---

## 4. Dampak ke jadwal Fase 1

| Dampak | Keterangan |
|---|---|
| Handover Fase 1 | tetap **16-Nov-2026**; Fase 2 mulai setelahnya |
| Kalau Fase 1 mundur | seluruh Fase 2 ikut mundur 1:1 (tanggal di dokumen ini berbasis asumsi 16-Nov) |
| Kalau Fase 1 di-deploy lebih dulu ke VPS | sesi deployment Docker/Dokploy sebaiknya diuji tuntas di Fase 1, supaya Fase 2 tinggal menambah company (bukan mengulang setup pipeline) |

---

## 5. Pro & Cons: digabung vs dipisah

### A. Digabung — 1 sistem multi-company (alasan utama dipilih)

**Pros**

| # | Keuntungan | Fakta di sistem sekarang |
|---|---|---|
| 1 | Data yang sama tidak diduplikasi | NPOF (402 baris) & item master (2.952 baris) **sudah** global/shared; supplier & formula material juga sama |
| 2 | Logika & angka konsisten | `materialCalcEngine.ts` = fungsi murni, satu mesin dipakai semua mode; tidak ada risiko perbedaan angka antar customer |
| 3 | Fitur & bug fix cukup sekali kerja | Perbaikan seperti bug `sht` vs `sheet`, alokasi stok sekuensial, aturan slitting 5 cm langsung berlaku semua company |
| 4 | Biaya operasional 1x | 1 API, 1 web, 1 DB, 1 pipeline Docker/Dokploy, 1 backup, 1 monitoring |
| 5 | Pola isolasi sudah ada & sudah teruji | `periodId` + `moduleType`, semua `@@unique` berawalan scope, + test `verify:cycle-isolation` (17 cek) & `verify:module-isolation` (34 cek) — menambah `companyId` = memperluas pola yang SAMA, bukan pola baru |
| 6 | Bisa konsolidasi | Total kebutuhan lintas company, negosiasi supplier/harga gabungan, perbandingan performa |
| 7 | User tidak pindah-pindah sistem | Menyelesaikan masalah inti: "terlalu banyak sistem berbeda padahal fungsi utamanya sama" |

**Cons**

| # | Risiko | Mitigasi |
|---|---|---|
| 1 | **Kebocoran data antar company/customer** (NDA/compliance) — satu query lupa filter = data customer lain terlihat | `companyId` wajib divalidasi di scope helper (server-side), bukan di UI; helper menolak query tanpa company, seperti `requireModuleType` sekarang |
| 2 | Single point of failure: 1 bug/1 deploy gagal = semua company berhenti | Staging + smoke test sebelum deploy; rilis di luar jam kerja |
| 3 | Skema & migrasi makin kompleks | Prosedur sudah terdokumentasi (regenerate init + apply delta + baseline ulang) |
| 4 | Prioritas bentrok antar customer | Roadmap per company + feature flag per company |
| 5 | Customisasi tanpa disiplin → `if (company === 'X')` bertebaran | Config-driven per company, bukan if-else |
| 6 | Testing berlipat (minimal 2 profil data: lokal & export) | UAT 2 siklus (baris 9) + test isolasi company |
| 7 | DB gabungan → query lebih berat | Index berawalan `companyId` (lanjut pola `[periodId, moduleType, …]`) |
| 8 | Kesalahan operasional berdampak lintas company | Ingat insiden nyata: `deleteMany` tanpa scope pernah menghapus 25 baris `outstanding_pos` → wajib guard scope sebelum delete |

### B. Dipisah — sistem/instance terpisah per company

**Pros**

| # | Keuntungan |
|---|---|
| 1 | Isolasi data by design — tidak ada jalan query lintas company, risiko kebocoran sangat kecil |
| 2 | Rilis & requirement independen, jadwal tiap customer tidak saling menahan |
| 3 | Performa/kapasitas terisolasi, spesifikasi server bisa berbeda per segmen |
| 4 | Blast radius insiden terkunci di 1 segmen |
| 5 | Customisasi ekstrem aman (mis. lokal yang praktis belum punya data NPOF vs export yang relatif lengkap) |
| 6 | Bisa dijual/diserahterimakan terpisah per PT |

**Cons**

| # | Kerugian |
|---|---|
| 1 | Duplikasi kode + duplikasi data master → cepat atau lambat angka beda antar sistem (drift) |
| 2 | Bug fix & improvement dikali N — padahal setiap perbaikan di repo ini selalu butuh verifikasi panjang (`verify:material-calc`, `verify:po-number`, `verify:ref-b`, dst.) |
| 3 | Biaya berlipat: N server, N DB, N pipeline deploy, N backup, N monitoring, N kali baseline migrasi |
| 4 | User harus pindah-pindah sistem; konsolidasi total kebutuhan harus export-import Excel manual (rawan salah) |
| 5 | Pelatihan, dokumentasi, dan onboarding developer berlipat; roadmap fitur baru jadi N kali lebih lambat |

### C. Rekomendasi

**Gabung — 1 sistem multi-company**, dengan 5 syarat berikut supaya cons utamanya hilang:

1. `companyId` **wajib** di semua tabel data & semua query, divalidasi di server (`periodScope.ts` atau helper baru), bukan di UI.
2. Semua `@@unique` diawali `companyId` (lanjut pola sekarang) + buat test isolasi company (tirukan pola `verify-module-isolation.ts`).
3. Perbedaan antar customer **config-driven** (tolerance cm, sheetsPerRim, profil import Excel, aturan NPOF, layout PDF) — bukan `if` di dalam kode.
4. Master data dibagi 2 kelas eksplisit: **shared** (NPOF, item master, formula) dan **per-company** (jenis material yang relevan, kode supplier — di data nyata nama NPOF "Hanchang Paper" berbeda dari kode stok "HANCHANG").
5. Halaman yang belum ter-scope (`tracking.ts`, `history.ts`) **wajib** ikut diberi scope — kalau tidak, justru di situ data lintas company bocor.

**Plan B (kalau ada kendala legal/NDA):** 1 codebase + **DB per company** (deploy dari image yang sama). Memberi isolasi seperti opsi "pisah" tanpa duplikasi logika dan tanpa bug fix berlipat.

---

## 6. Pertanyaan yang perlu dikonfirmasi sebelum baris 7 dimulai

1. "Company" = PT/entitas legal, atau plant/lokasi? Bisa ada 1 company dengan beberapa customer?
2. Customer lokal memakai NPOF juga, atau tanpa NPOF sama sekali (fallback jumbo roll 180 cm)?
3. Kode supplier lokal & export sama dengan supplier sekarang, atau berbeda (butuh tabel mapping supplier)?
4. Format Excel sumber untuk lokal & export — kolomnya sama, atau berbeda (butuh profil import terpisah)?
5. Siapa PIC planner untuk lokal & export (pemilik data & approver per company)?
6. Perlu report konsolidasi lintas company, atau cukup per company? (menentukan apakah 8.10 masuk scope atau di-defer)

---

## 7. Risiko jadwal

| Risiko | Dampak | Antisipasi |
|---|---|---|
| Keputusan gabung/pisah molor lewat 31-Des | Development mundur 1:1 | Batasi baris 7 maksimal 2 minggu; sediakan rekomendasi (bagian 5C) sebagai default |
| Format Excel lokal & export ternyata sangat berbeda | 8.4 bisa membengkak | Discovery baris 1–2 harus ambil **file contoh nyata** kedua segmen |
| Data lokal tanpa NPOF | Hasil calc berbasis estimasi, user bisa menganggap salah | Aturan fallback + badge "Belum ada data NPOF" dijadikan keputusan di baris 7.2 |
| Libur Nataru & Idul Fitri | Velocity turun | Sudah di-buffer di tanggal baris 7–9 |
| Migrasi data lama saat tambah `companyId` | Risiko kehilangan periode | Backfill diuji di DB salinan dulu (baris 8.1) |

---

# Lampiran A — Timeline Fase 1 terupdate (improvement hasil meeting 2 Okt 2026)

Baris 1–6 tidak berubah; baris 7 dipecah menjadi sub-item 7.1–7.15. Baris 8–11 digeser mengikuti.

| No | Aktivitas | PIC | Due Date | Propose | Extended Due Date | Status |
|----|-----------|-----|----------|---------|-------------------|--------|
| 1 | Pelajari proses MRP & 4 Week Commitment (Data Source PPIC) | Castin | 3-Jul | | | Closed |
| 2 | Cari tahu output Material Planning | Castin | 3-Jul | | | Closed |
| 3 | Identifikasi kesulitan (Pain Point) | Castin | 4-Jul | | | Closed |
| 4 | Brainstorming solusi (Pareto 20/80) | Clay | 4-Jul | | | Closed |
| 5 | Isi Form Current Process | Castin | 7-Jul | | | Closed |
| 6 | Brainstorming RCA & Isi Form Future | Clay | 17-Jul | | | Closed |
| **7** | **Development MRP Digital** (base + improvement) | Natalia | 5-Sep | 26-Sep | **24-Okt** | Delay |
| 7.1 | Filter/highlight + notifikasi NPOF belum ada (termasuk kasus MRP sudah ada tapi NPOF belum) | Natalia | | 2-Okt | 5-Okt | Open |
| 7.2 | Perbaiki ukuran kg di Calculation yang masih salah | Natalia | | 2-Okt | 7-Okt | Open |
| 7.3 | Tulisan kg dibuat jelas (tidak burem/tipis) | Natalia | | 2-Okt | 7-Okt | Open |
| 7.4 | Total + Allowance, Stock RM, OS PO diberi keterangan kg | Natalia | | 2-Okt | 8-Okt | Open |
| 7.5 | Kolom edit untuk kolom stok raw material | Natalia | | 2-Okt | 9-Okt | Open |
| 7.6 | Stack As Of diberi keterangan detail (memuat ukuran apa saja) dan bisa diedit | Natalia | | 2-Okt | 13-Okt | Open |
| 7.7 | Kolom TTD di PDF (Dibuat oleh, Diperiksa oleh, General Manager (acc), Plant Manager (acc)) | Natalia | | 2-Okt | 14-Okt | Open |
| 7.8 | Filter berdasarkan gramatur, supplier, dll | Natalia | | 2-Okt | 14-Okt | Open |
| 7.9 | Pengelompokan data: gramatur → supplier | Natalia | | 2-Okt | 17-Okt | Open |
| 7.10 | Beli item gabung — mekanisme input & perhitungan | Natalia + Clay | | 2-Okt | 21-Okt | Open |
| 7.11 | Outstanding PO untuk ukuran gabungan — cara input | Natalia | | 2-Okt | 24-Okt | Open |
| 7.12 | PET: pilihan Vacuum/Folding → muncul micron-nya | Natalia | | 2-Okt | 24-Okt | Open |
| 7.13 | Knowledge cara baca data yang benar + verifikasi berdasarkan planner | Thalia + Clay | | 2-Okt | 24-Okt | Open |
| 7.14 | Update timeline per menu/fitur secara detail | Natalia | | 2-Okt | 24-Okt | Open |
| 7.15 | Monitoring 1 minggu + history minggu sebelumnya sudah ter-update | Natalia | | 2-Okt | 24-Okt | Open |
| 8 | User Testing | Thalia | 26-Okt | 28-Okt | | Open |
| 9 | Deployment | Natalia | 28-Okt | 31-Okt | | Open |
| 10 | Bug Fix & Improvement | Natalia | 2-Nov | 9-Nov | | Open |
| 11 | Final Review & Handover | Thalia | 9-Nov | 16-Nov | | Open |

> **Dependency:** 7.3 & 7.4 efektif setelah 7.2 · 7.11 butuh 7.10 · 7.9 butuh 7.8 · 7.15 baru jalan setelah baris 9 (Deployment).
