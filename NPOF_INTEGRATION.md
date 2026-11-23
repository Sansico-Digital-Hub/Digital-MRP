# Integrasi NPOF Materials ↔ SNF

Halaman **Master Data → NPOF Materials** adalah cermin _read-only_ data NPOF dari
sistem SNF. Digital MRP **tidak pernah menulis** ke SNF.

- Kontrak endpoint: **SNF Integration API v3 — `/npof/integration/materials`**
  (berlaku sejak November 2026; endpoint mengirim SEMUA status NPOF).
- Plant fase ini: **PT. Printec Perkasa II (`PP2`, `plant_id = 2`)**.
- Semua request **wajib** membawa `plant_id` eksplisit. Tidak ada request tanpa
  `plant_id` (plant_id null = semua plant).

---

## 1. Konfigurasi environment

| Variabel | Wajib | Default | Keterangan |
|---|---|---|---|
| `SNF_BASE_URL` | ya | `http://127.0.0.1:8008` | Base URL SNF tanpa garis miring di akhir. Fallback lama: `NPOF_API_URL`. |
| `SNF_INTEGRATION_API_KEY` | ya | – | Hanya di env server-side. **Jangan** pernah masuk repo/frontend. Fallback lama: `NPOF_API_KEY`. |
| `SNF_ALLOWED_PLANT_IDS` | tidak | `2` | Daftar plant yang boleh dibaca, dipisah koma (`2` atau `2,1,3`). |
| `SNF_DEFAULT_PLANT_ID` | tidak | plant pertama | Harus termasuk `SNF_ALLOWED_PLANT_IDS`; API menolak start bila tidak. |
| `SNF_REQUEST_TIMEOUT_MS` | tidak | `60000` | Timeout satu request SNF. |
| `SNF_SYNC_RETRY_ATTEMPTS` | tidak | `3` | Jumlah percobaan total (termasuk percobaan pertama). |
| `SNF_SYNC_RETRY_BACKOFF_MS` | tidak | `500` | Backoff awal; percobaan berikutnya 2× lebih lama. |

Contoh:

```env
SNF_BASE_URL=https://snf.internal.example
SNF_INTEGRATION_API_KEY=********
SNF_ALLOWED_PLANT_IDS=2
SNF_DEFAULT_PLANT_ID=2
```

API key di atas sengaja di-redact. Nilai asli hanya ada di environment server.

---

## 2. Endpoint yang dipakai

```http
GET {SNF_BASE_URL}/npof/integration/materials?plant_id=2
X-API-Key: ********
```

Satu baris per `(part_number, scenario)`. Endpoint mengirim **semua status**
(Draft / Waiting for Approval / Completed), sehingga:

- Baris belum approved (`is_approved = false`) tetap tampil (muted) untuk
  memberi visibilitas progres approval.
- UPS baris tersebut **tidak dihitung** (`ups_counted = false`,
  `ups_combined = null`).

Endpoint legacy `/npof/process-a/materials` **tidak lagi dipanggil**. Kolom
spesifikasi memakai `effective_spec` yang sudah diresolusi SNF.

Contoh payload (dipotong, API key di-redact):

```json
{
  "status": "success",
  "total": 1,
  "data": [
    {
      "part_number": "JKG66-0910",
      "part_name": "RTN LID FRONT 21A",
      "npof_title": "NPOF - BRB MUSIC SERIES PROJECT HEARTH - JKG66-9993",
      "product_name": "BRB MUSIC SERIES PROJECT HEARTH",
      "scenario": "MAIN",
      "status": "completed",
      "status_label": "Completed",
      "approval_status": "approved",
      "approval_status_label": "Approved",
      "is_approved": true,
      "ups_counted": true,
      "removed_in_latest_rev": false,
      "selected_npof_id": 130,
      "selected_rev": "Rev B",
      "source_npofs": [
        {
          "npof_id": 130,
          "rev": "Rev B",
          "status_label": "Completed",
          "approval_status": "approved",
          "approved_by_name": "Budi",
          "approved_at": "2026-11-05T13:53:00"
        }
      ],
      "has_alt": false,
      "alt_possibly_stale": false,
      "newer_rev_pending_approval": false,
      "is_gang_print": true,
      "is_gang_print_parent": true,
      "gang_print_parent": null,
      "gang_print_group_id": 12,
      "group_status": "complete",
      "pending_npofs": [],
      "ups_original": 3,
      "ups_combined": 5,
      "group_members": [
        { "part_number": "JKG66-0910", "ups_used": 3, "is_parent": true }
      ],
      "spec": {
        "material": "Paper",
        "gramatur": "450",
        "supplier": "Hongkong Paper",
        "sheeted_size": "48 x 60 CM",
        "formula_material": "0.25 kg/sheet"
      },
      "effective_spec": {
        "material": "Paper",
        "gramatur": "450",
        "supplier": "Hongkong Paper",
        "sheeted_size": "48 x 60 CM",
        "formula_material": "0.25 kg/sheet"
      },
      "spec_source": "own",
      "has_conflict": false,
      "conflicts": []
    }
  ]
}
```

### 2.2 Verifikasi plant (tanpa auth)

```http
GET {SNF_BASE_URL}/plants/public
```

Saat startup API mencari plant dengan `code = "PP2"` dan memastikan `id`-nya
termasuk `SNF_ALLOWED_PLANT_IDS`. Bila tidak cocok, sync diblokir (tidak menebak
plant id). Bila SNF sedang down saat startup, sync mencoba verifikasi sekali lagi
saat dipanggil.

---

## 3. Aturan data

1. **Satu baris per `(plant_id, part_number_norm, scenario)`** — upsert, bukan insert.
2. `part_number_norm` = trim + collapse spasi/tab/newline + UPPERCASE.
   `part_number` asli tetap disimpan untuk display.
3. Baris tanpa part number tetap disimpan dengan kunci sentinel
   `__NO_PART__#<npof_id>` agar tidak saling menimpa; UI menampilkan badge
   **Part number kosong** dan baris tersebut dikecualikan dari total/ekspor.
4. **Part number tidak pernah diisi dari `part_name`.** `product_name` diambil
   dari `product_name`; `npof_title` hanya untuk tooltip/detail.
5. `scenario = "main"` dan `"alt"` adalah baris terpisah. UPS keduanya **tidak**
   dijumlahkan (filter/tab masing-masing).
6. UPS = `ups_combined`, fallback `ups_original`, **hanya bila
   `ups_counted = true` dan `is_approved = true`**. Untuk baris lain,
   `ups_combined` disimpan `null` dan `upsCounted = false`.
7. Status kolom/badge memakai `status_label`:
   **Draft** (abu-abu), **Waiting for Approval** (kuning), **Completed** (hijau).
8. Baris `is_approved = false` tampil **muted** dan tidak dihitung ke total
   UPS/ekspor.
9. Spesifikasi diambil dari `effective_spec.*` (material, gramatur, supplier,
   sheeted size, formula material). `effective_spec = null` → kolom `—`.
10. `spec_source = "parent"` → badge **“Mengikuti induk <gang_print_parent>”**
    (tooltip menjelaskan nilai `spec.*` asli kosong/placeholder). Nilai `spec.*`
    mentah disimpan di `rawSpec` untuk detail.
11. `newer_rev_pending_approval = true` → badge
    **“Ada revisi baru belum approved”**.
12. `removed_in_latest_rev = true` tetap tampil, tetapi dikecualikan dari total
    UPS dan ekspor.
13. `approved_by_name` / `approved_at` hanya informasi, bukan otorisasi.
14. `source_npofs` / `pending_npofs` dari SNF hanya membawa `npof_id`, sehingga
    detail (`GET /api/v1/npof-materials/:id`) menambahkan `npof_title` per item:
    judul baris dipakai bila revisinya sama, sedangkan revisi lain memakai judul
    baris dengan label revisi di depan diganti (`IR - …` → `Rev A - …`). Bila
    format judul tidak dikenal, judul baris dipakai apa adanya. UI menampilkan
    judul tersebut dan hanya memakai id sebagai tooltip.
15. Filter **Perhitungan** (`calculation=active|inactive`) memakai predicate yang
    sama dengan `ACTIVE_NPOF_WHERE` di kalkulasi Material Planning:
    `isActive && isApproved && scenario = "main"` (+ plant yang diizinkan).
    Hanya baris itu yang dipakai kalkulasi (praktisnya = status **Completed**);
    Draft, Waiting for Approval, dan baris Alt selalu **tidak aktif**. Filter
    ini digabung dengan filter lain memakai `AND`, jadi mis.
    `scenario=alt&calculation=active` menghasilkan 0 baris.

### Normalisasi sheeted size

- `"48 x 60 cm"` → `48 × 60 CM` (length 48, width 60).
- Koma desimal didukung: `"73,5 × 57,5 CM"` → `73.5 × 57.5 CM`.
- Suffix `(LG)` dan teks `NEBENG DI <part>` dipisah ke catatan.
- Superscript footnote (`73.5ˣ 57.5ˣ`) dibersihkan; teks asli disimpan di
  `sheetedSizeRaw` untuk tooltip.

---

## 4. Sync

- Satu job per plant di `SNF_ALLOWED_PLANT_IDS`, berjalan berurutan.
- Hanya memanggil `/npof/integration/materials?plant_id=...`.
- Timeout 60 detik per request, retry maksimum 3× dengan exponential backoff.
- Upsert semua baris respons (semua status) → set `lastSyncedAt`.
- Baris **plant tersebut** yang tidak ada lagi di respons di-`isActive = false`
  (soft delete). Baris plant lain tidak pernah disentuh.
- Deactivate hanya terjadi setelah respons **200 + `status: "success"`**.
- Idempotent: sync berulang tidak menambah baris/duplikat.
- Ringkasan respons: `created`, `updated`, `deactivated`, `skipped`, `durationMs`
  per plant dan total.
- Bila fetch/parse gagal, transaksi di-rollback dan data lama tetap utuh.

### Error handling

| Kondisi SNF | Pesan ke user |
|---|---|
| 503 `Integration API key is not configured` | API key belum dikonfigurasi; hubungi admin. |
| 403 `Invalid API Key` | Kredensial integration salah; periksa `SNF_INTEGRATION_API_KEY`. |
| 500 / gangguan jaringan | SNF bermasalah; coba lagi (retry otomatis). |
| Timeout | SNF tidak merespons; coba lagi. |
| JSON invalid / bukan `success` | Respons tidak sesuai kontrak; data lama tidak diubah. |
| Plant PP2 tidak cocok | Sync dihentikan; perbaiki `SNF_ALLOWED_PLANT_IDS`. |

API key tidak pernah dikirim ke frontend dan tidak pernah ditulis ke log.

---

## 5. Menambah plant baru

Tidak perlu migrasi skema/UI:

1. Ubah env `SNF_ALLOWED_PLANT_IDS=2,1` (atau `2,1,3`).
2. Pastikan `SNF_DEFAULT_PLANT_ID` masih termasuk daftar.
3. Restart API lalu jalankan sync. Data PP2 tetap utuh.
4. UI fase ini tetap menampilkan PP2; plant lain hanya ikut tersinkron dan
   tersimpan dengan `plantId` masing-masing.

---

## 6. Referensi kode

- Normalisasi & effective spec: [`apps/api/src/lib/npofNormalize.ts`](apps/api/src/lib/npofNormalize.ts)
- Fetch, verifikasi plant, sync: [`apps/api/src/lib/npofSync.ts`](apps/api/src/lib/npofSync.ts)
- Route: [`apps/api/src/routes/npofMaterials.ts`](apps/api/src/routes/npofMaterials.ts)
- Skema: [`apps/api/prisma/schema.prisma`](apps/api/prisma/schema.prisma) (`model NpofMaterial`)
- Migrasi:
  - [`20261110000000_npof_materials_snf_contract`](apps/api/prisma/migrations/20261110000000_npof_materials_snf_contract)
  - [`20261110120000_npof_status_effective_spec`](apps/api/prisma/migrations/20261110120000_npof_status_effective_spec)
- Halaman UI: [`apps/web/src/routes/NpofMaterials.tsx`](apps/web/src/routes/NpofMaterials.tsx)

Pengujian:

```bash
pnpm --filter @pdits/api exec vitest run src/lib
pnpm --filter @pdits/api typecheck
pnpm --filter @pdits/web exec tsc -b
```
