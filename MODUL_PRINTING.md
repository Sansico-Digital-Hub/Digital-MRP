# Modul Printing (KBA)

Integrasi aplikasi **Printing Planning** (repo `Cathzer/Production-Planning-AI`) ke PlannerProject sebagai bagian dari modul **Production Planning**. Modul ini menyusun jadwal cetak untuk mesin KBA 1–4 dan GENIUS.

Integrasi dikerjakan bertahap. Setiap tahap bisa dipakai dan diuji sendiri.

| Tahap | Isi | Status |
|---|---|---|
| 1 | Engine planning di `@pdits/shared`, mesin cetak, kalender produksi (shift, hari libur, maintenance) | ✅ branch `feature/printing-planning` |
| 2 | Plan printing: kebutuhan dari 26-Week Demand (MRP) Production + WIP + FG, rekomendasi mesin, jadwal, approval | belum |
| 3 | Master layout (list2026) & impor data dari aplikasi lama (`gc_printing_planner`) | belum |
| 4 | Plan vs actual, export Action Plan, AI (opsional) | belum |

## Struktur

```
packages/shared/src/printing/
  machines.ts        spesifikasi mesin (warna, tinta spesial, ukuran min/max), kapasitas default
  planning.ts        engine murni: shortage, layout & UP, kelayakan mesin, rekomendasi, jadwal, kalender
  planning.test.ts   tes engine (diport 1:1 dari aplikasi asal; angka harus identik)
apps/api/
  prisma/migrations/20261024000000_printing_module/   tabel printing_* + data awal mesin & shift
  src/lib/printing.ts        jam dinding WIB, baca mesin & kalender, kalender plan
  src/routes/printing.ts     /api/v1/printing/*
  verify-printing.ts         tes API (hak akses, validasi, versi, audit, engine)
apps/web/src/
  routes/PrintingPresses.tsx   menu Production Planning → Mesin Cetak
  routes/PrintingCalendar.tsx  menu Production Planning → Kalender Printing
  hooks/usePrinting.ts, i18n/pages/printing.ts
```

## Aturan penting

- **Jam dinding WIB.** Semua waktu printing berformat `2026-10-05T07:00` dan disimpan apa adanya (07:00 WIB tersimpan 07:00:00, tanpa konversi zona). Engine mengolahnya sebagai UTC supaya jam pabrik tidak bergeser mengikuti zona server atau browser. Jangan mengubahnya ke `new Date()` lokal di API.
- **Hak akses.** Semua user yang login boleh melihat. Yang boleh mengubah adalah `EDIT_ROLES.production` (Super Admin, Admin, Production Planner). Kalau nanti dibutuhkan role khusus printing, tambahkan di `lib/permissions.ts`.
- **Optimistic locking.** Kapasitas mesin, daftar shift, dan maintenance memakai kolom `version`. Request dengan versi basi dijawab 409, sehingga dua planner tidak saling menimpa tanpa sadar.
- **Audit.** Setiap perubahan tercatat di `audit_logs` dengan `entityType` `PrintingMachine`, `PrintingShift`, `PrintingHoliday`, atau `PrintingMaintenance`.
- **Spesifikasi mesin ada di kode** (`machines.ts`), bukan di database. Database hanya menyimpan kapasitas yang boleh diubah planner.

## Endpoint

| Method | Path | Keterangan |
|---|---|---|
| GET | `/api/v1/printing/machines` | mesin + spesifikasi |
| PUT | `/api/v1/printing/machines/:id` | `{ speed, setupHours, effectiveHours, version }` |
| GET | `/api/v1/printing/calendar` | `{ shifts, shiftsVersion, holidays, maintenance }` |
| PUT | `/api/v1/printing/calendar/shifts` | `{ version, shifts: [{ name, start, end, breakStart, breakEnd }] }`, 1–6 shift |
| POST | `/api/v1/printing/calendar/holidays` | `{ date: "YYYY-MM-DD", name }` |
| DELETE | `/api/v1/printing/calendar/holidays/:id` | |
| POST | `/api/v1/printing/maintenance` | `{ machineId, start, end, reason }`, maksimal 31 hari |
| PUT | `/api/v1/printing/maintenance/:id` | sama + `version` |
| DELETE | `/api/v1/printing/maintenance/:id?version=N` | |

## Menjalankan & menguji

```bash
pnpm --filter @pdits/shared build        # API memakai dist @pdits/shared
pnpm --filter @pdits/api prisma:deploy   # menerapkan migrasi printing
cd packages/shared && npx vitest run     # tes engine

# Tes API mengubah kalender, jadi hanya mau jalan di database uji (nama mengandung "test"):
DATABASE_URL=mysql://root:@localhost:3306/pdits_test_printing DISABLE_REDIS=true \
  pnpm --filter @pdits/api verify:printing
```

Web mengimpor engine langsung dari source (`@pdits/shared/src/printing`), jadi tidak perlu build ulang shared saat mengembangkan halaman.
