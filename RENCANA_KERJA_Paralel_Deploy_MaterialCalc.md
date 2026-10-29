# Rencana Kerja: Deployment Prep + Material Calculation (Paralel)

> Dokumen pendamping `RANCANGAN_MATERIAL_CALC_26W.md`
> Status: **DISETUJUI UNTUK DIKERJAKAN**
> Tanggal: 24 Sep 2026

---

## 1. Kenapa Bisa Paralel

Dua pekerjaan ini menyentuh **file yang hampir tidak bertabrakan**:

| File | Deployment prep | Material Calculation |
|---|---|---|
| `apps/api/src/config/index.ts` | ⚠️ dotenv guard | ⚠️ `materialCalc{}` config |
| `Dockerfile.api`, `Dockerfile.web` | ✅ | — |
| `nginx.conf`, `.dockerignore` | ✅ | — |
| `package.json` (root), `apps/api/package.json` | ✅ | — |
| `apps/web/src/routes/Login.tsx`, `lib/api.ts` | ✅ | — |
| `apps/api/src/routes/materialCalc.ts` | — | ✅ |
| `apps/web/src/routes/MaterialCalc.tsx` | — | ✅ |

**Hanya 1 file yang bentrok** — `apps/api/src/config/index.ts`. Solusinya: kerjakan **sekali** dengan kedua perubahan sekaligus.

---

## 2. Kondisi Alat di Mesin Ini

| Alat | Status | Dampak |
|---|---|---|
| **Docker** | ❌ **Tidak terpasang** | Build image tidak bisa diverifikasi lokal — hanya di VPS |
| pnpm / Node | ✅ Tersedia | Bisa verifikasi `pnpm build` + `pnpm deploy` |
| MySQL lokal | ✅ Jalan | Bisa test material calc dengan data nyata |

### ✅ Verifikasi Tetap Bisa Dilakukan Lokal — Tanpa Docker

Bagian **paling berisiko** dari deployment justru bisa diuji tanpa Docker, karena semuanya perintah pnpm:

```bash
# 1. Build semua paket (sama seperti di Dockerfile)
pnpm --filter @pdits/shared build
pnpm --filter @pdits/api build
pnpm --filter @pdits/web build

# 2. Simulasi pnpm deploy (BAGIAN PALING BERISIKO)
pnpm deploy --filter=@pdits/api ./_prod_check

# 3. Cek hasilnya — inilah yang harus ada:
ls _prod_check/node_modules/.prisma/client     # generated client
ls _prod_check/node_modules/.bin/prisma        # prisma CLI (butuh migrasi!)
ls _prod_check/dist/server.js                  # hasil build API
ls _prod_check/prisma/schema.prisma            # schema untuk migrate deploy
```

Kalau keempat hal itu ada, **70% risiko deployment sudah terbukti hilang** sebelum menyentuh VPS.

Yang tetap harus diuji di VPS: Docker layer, nginx, Traefik, TLS, dan network antar-service.

---

## 3. Milestone

### Milestone 1 — Dasar (target: **± 1 hari**) → langsung bisa ditest

**Stream A (deployment prep):**

| # | File | Perubahan |
|---|---|---|
| A1 | `.dockerignore` *(baru)* | Kecualikan `node_modules`, `dist`, `.env`, `*.xlsm`, `.git` |
| A2 | `Dockerfile.api` | + `openssl`, prisma di prod deps, regenerate client, entrypoint `migrate deploy` |
| A3 | `Dockerfile.web` | + `ARG VITE_API_URL` / `ENV VITE_API_URL` |
| A4 | `nginx.conf` | + `client_max_body_size 60m` |
| A5 | `package.json` (root) | + `"packageManager": "pnpm@9.x"` |
| A6 | `apps/api/package.json` | Pindah `prisma` dari devDeps → deps |
| A7 | `apps/web/src/lib/api.ts` | Export `API_URL` |
| A8 | `apps/web/src/routes/Login.tsx` | Hapus hardcode `localhost:3001` |

**Stream B (material calc, Fase 0):**

| # | File | Perubahan |
|---|---|---|
| B1 | `apps/api/src/config/index.ts` | **Sekaligus:** dotenv guard + `materialCalc: { sizeToleranceCm: 2, sheetsPerRim: 500 }` |
| B2 | `apps/api/src/routes/materialCalc.ts` | Jumlahkan **semua lot** stok; `rim` × 500 |

**Verifikasi Milestone 1:**
1. ✅ Build 3 paket (`shared`, `api`, `web`) tanpa error
2. ✅ `pnpm deploy` ke folder cek → periksa 4 hal di §2
3. ✅ Buka Material Calculation di lokal → bandingkan angka sebelum vs sesudah
4. ✅ Login masih jalan setelah hapus hardcode

---

### Milestone 2 — Pencocokan Ukuran (target: **± 1 hari**)

| # | Perubahan |
|---|---|
| B3 | `materialCalc.ts` — ganti `fuzzyMatch` dengan pencocokan berbasis gramatur + ukuran |
| | • Gramatur harus sama persis |
| | • Ukuran sama persis → selalu menang |
| | • Kalau tidak ada → ukuran ≥ kebutuhan, selisih maksimal 2 cm (`config`) |
| | • Semua kandidat yang lolos **dijumlahkan** |
| | • Hasil tetap menampilkan ukuran kebutuhan sebenarnya |

**Verifikasi:** jalankan `npx tsx inspect-data3.ts` versi baru → cek berapa part yang dapat stok (target: **29 dari 98**, sesuai hasil analisis).

---

### Milestone 3 — Alokasi Berurutan (target: **± 2 hari**)

| # | Perubahan |
|---|---|
| B4 | `materialCalc.ts` — ganti rumus `Surplus` per part dengan **alokasi berurutan per minggu** |
| | • Stok dikonsumsi **sekali**, urut **minggu kebutuhan** |
| | • Urutan dalam 1 minggu: kecocokan ukuran terbaik → bisa ditutup penuh → part number A→Z |
| | • **Tidak boleh** dibagi rata |
| | • PO masuk kolam **mulai minggu kedatangannya** |

**Verifikasi:**
1. Total stok teralokasi **tidak boleh melebihi** stok fisik tiap item
2. Bandingkan dengan hasil `inspect-data4.ts` → double-count 278.850 kg harus **hilang**
3. Uji contoh dari user: Part A (500 kg, 20 Okt) & Part B (750 kg, 01 Okt) dari stok 1.000 kg → B penuh, A dapat 250

---

### Milestone 4 — Kelengkapan Deployment (target: **± 0,5 hari**)

| # | File | Perubahan |
|---|---|---|
| A9 | `docker-compose.dokploy.yml` *(baru)* | mysql + redis + api + web, `dokploy-network`, tanpa `container_name` |
| A10 | `.env.production.example` *(baru)* | Daftar env untuk Dokploy UI |
| A11 | `apps/web/src/lib/features.ts` *(baru)* | Feature flag `materialCalculation` |
| A12 | Menu + route Material Calculation | Disembunyikan saat flag OFF |

**Verifikasi:** `VITE_ENABLE_MATERIAL_CALC=false` → menu hilang; `true` → menu muncul.

---

## 4. Total

| Milestone | Isi | Estimasi |
|---|---|---|
| 1 | Deployment dasar + Fase 0 | 1 hari |
| 2 | Pencocokan ukuran | 1 hari |
| 3 | Alokasi berurutan | 2 hari |
| 4 | Compose Dokploy + feature flag | 0,5 hari |
| | **Total** | **± 4,5 hari** |

Setelah Milestone 4, statusnya:
- ✅ Aplikasi **siap deploy** (belum di-deploy)
- ✅ Material Calculation **angka sudah benar**
- ✅ Fitur bisa dinyalakan/dimatikan lewat env var

---

## 5. Risiko & Mitigasi

| Risiko | Tingkat | Mitigasi |
|---|---|---|
| Dua perubahan sekaligus → sulit melacak penyebab bug | 🟠 Sedang | Verifikasi **per milestone**, jangan gabung. Stream B (material calc) diuji dengan angka, Stream A dengan build |
| Docker tidak bisa diuji lokal | 🟠 Sedang | Verifikasi bagian berisiko lewat `pnpm deploy` (§2). Sisanya diuji saat deploy |
| Milestone 3 mengubah struktur hasil → angka `Shortage` naik | 🔴 Tinggi | Bandingkan sebelum-sesudah bersama tim bisnis sebelum dipakai keputusan pembelian |
| Feature flag lupa dimatikan saat deploy | 🟡 Rendah | Default `false`; dinyalakan hanya setelah Milestone 3 diverifikasi |

---

## 6. Yang TIDAK Dikerjakan Sekarang

Menunggu keputusan / milestone berikutnya:

- Fase 1–10 material calc (schema periode, 26 minggu, UI) — **± 11,5 hari**
- Deploy sesungguhnya ke VPS
- 5 pertanyaan tentang Gambar 3 (baris angka bawah, "Outstanding PO" berulang, kolom Duty/DISCOUNT, "PO IMPOR", CUT OFF/DONE)
- Pemilihan database VPS (MySQL Dokploy baru / restore dari lokal / eksternal)
