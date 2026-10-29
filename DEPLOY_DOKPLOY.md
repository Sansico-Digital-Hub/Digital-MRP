# Deploy ke Dokploy — Panduan Langkah demi Langkah

Panduan ini menjelaskan cara men-deploy PDITS (web + API + MySQL + Redis) ke VPS
memakai **Dokploy** dengan mode **Docker Compose**.

> **Prinsip utama:** dokumen ini tidak pernah menghapus data. Semua perintah
> bersifat menambah atau mengganti container; volume database (`mysql_data`)
> dipertahankan oleh Docker dan tidak ikut terhapus saat redeploy.

---

## 0. Prasyarat

| Kebutuhan | Minimum | Catatan |
|---|---|---|
| VPS | 2 vCPU / 4 GB RAM / 40 GB SSD | Build monorepo pnpm berat. RAM 2 GB sering OOM saat build. |
| OS | Ubuntu 22.04 / 24.04 | |
| Docker | terpasang oleh installer Dokploy | |
| Domain | 2 subdomain | `app.domain.com` (web) dan `api.domain.com` (api) |

Kalau RAM hanya 2 GB, tambahkan swap:

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

### DNS

Buat 2 record A **sebelum** deploy. Let's Encrypt gagal kalau domain belum
mengarah ke server.

| Type | Name | Value |
|---|---|---|
| A | `app` | IP VPS |
| A | `api` | IP VPS |

Verifikasi: `nslookup app.domain.com`

---

## 1. Install Dokploy

```bash
curl -sSL https://dokploy.com/install.sh | sh
```

1. Buka `http://IP_VPS:3000`
2. Buat akun owner Dokploy (akun ini **bukan** akun aplikasi PDITS)
3. Pastikan jaringan bersama sudah ada:

```bash
docker network ls | grep dokploy-network
```

---

## 2. Siapkan nilai rahasia

Generate di VPS. **Pakai `-hex`** (bukan `-base64`) untuk password, karena
karakter `+ / =` dari base64 merusak URL koneksi database/Redis.

```bash
echo "JWT_SECRET=$(openssl rand -base64 48)"
echo "JWT_REFRESH_SECRET=$(openssl rand -base64 48)"
echo "MYSQL_PASSWORD=$(openssl rand -hex 24)"
echo "MYSQL_ROOT_PASSWORD=$(openssl rand -hex 24)"
echo "REDIS_PASSWORD=$(openssl rand -hex 24)"
```

Simpan semuanya di password manager **sebelum** menekan Deploy.

---

## 3. Buat service di Dokploy

1. **Create Project** → nama `pdits`
2. **Create Service** → **Compose**
3. Tab **General**:
   - **Name**: `pdits-prod`
   - **Provider**: GitHub → hubungkan repo → pilih `SansicoAI-dgt/PlannerProject`
   - **Branch**: `main`
   - **Compose Path**: `docker-compose.dokploy.yml`

> 🔴 **Jangan biarkan Compose Path di nilai default `docker-compose.yml`.**
> File itu adalah compose **development**: MySQL-nya mempublikasikan port 3306
> ke internet dengan password `devpassword` / `rootpassword`.

---

## 4. Isi tab Environment

Tempel persis seperti ini (tanpa spasi setelah `=`, tanpa tanda kutip):

```ini
MYSQL_DATABASE=planner_project
MYSQL_USER=pdits
MYSQL_PASSWORD=<openssl-rand-hex-24>
MYSQL_ROOT_PASSWORD=<openssl-rand-hex-24>
REDIS_PASSWORD=<openssl-rand-hex-24>

JWT_SECRET=<openssl-rand-base64-48>
JWT_REFRESH_SECRET=<openssl-rand-base64-48>

CORS_ORIGIN=https://app.domain.com
FRONTEND_URL=https://app.domain.com
VITE_API_URL=https://api.domain.com/api/v1
VITE_ENABLE_MATERIAL_CALC=false

ADMIN_EMAIL=admin@domain.com
ADMIN_PASSWORD=<password-kuat-minimal-16-karakter>

NPOF_API_URL=
NPOF_API_KEY=
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:admin@domain.com
```

### Kenapa nilai ini penting

| Variabel | Kalau salah / kosong |
|---|---|
| `JWT_SECRET`, `JWT_REFRESH_SECRET` | Container **menolak start** dengan pesan jelas (sejak perbaikan hardening). Dulu server tetap jalan memakai secret yang tertulis di repo sehingga token bisa dipalsukan. |
| `CORS_ORIGIN` | Harus persis domain web, pakai `https://`, **tanpa** garis miring di akhir. Kalau salah, login gagal dengan error CORS yang tidak informatif. |
| `VITE_API_URL` | Ditanam ke bundle **saat build**. Salah nilai → harus redeploy (rebuild), bukan restart. |
| `VITE_ENABLE_MATERIAL_CALC` | `false` menyembunyikan menu Material Calculation. Juga ditanam saat build. |
| `REDIS_PASSWORD` | Dipakai Redis **dan** `REDIS_URL` API. Ganti satu, ganti keduanya (keduanya membaca variabel yang sama). |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Hanya dipakai saat tabel `users` masih kosong. |

---

## 5. Tambahkan domain

Tab **Domains** → **Add Domain**, dua kali:

| Service | Host | Port | HTTPS | Certificate |
|---|---|---|---|---|
| `web` | `app.domain.com` | **80** | ON | Let's Encrypt |
| `api` | `api.domain.com` | **3001** | ON | Let's Encrypt |

Tidak perlu mempublikasikan port di compose — Dokploy menambahkan label Traefik
secara otomatis dan mengarahkan domain ke service yang dipilih.

---

## 6. Deploy

Klik **Deploy**. Build pertama **5–15 menit** (pull image, install ~170 paket,
build 3 workspace).

Saat container `api` start, ia menjalankan `prisma migrate deploy` lebih dulu,
sehingga database kosong otomatis dibuatkan tabel. Langkah ini **hanya
menambah** tabel; tidak pernah menghapus data yang sudah ada.

---

## 7. Verifikasi

```bash
curl https://api.domain.com/api/v1/health
```

Harapan:

```json
{"status":"ok","services":{"database":"connected","redis":"connected"}}
```

Lalu:

1. Buka `https://app.domain.com`
2. Login dengan `ADMIN_EMAIL` / `ADMIN_PASSWORD`
3. Dokploy → service `api` → **Logs**, harus muncul:
   `[bootstrap] Akun SUPER_ADMIN awal dibuat: ...`

Cek header keamanan web:

```bash
curl -sSI https://app.domain.com | grep -Ei 'strict-transport|x-frame|x-content-type|content-security'
```

---

## 8. Setelah deploy berhasil

1. **Ganti password admin** dari menu Users di aplikasi.
2. Tab **General** → aktifkan **Auto Deploy** (webhook GitHub).
3. Tab **Backups** → target volume `pdits-prod_mysql_data`, jadwal harian,
   retention 7 hari. **Ini wajib.**
4. Simpan `MYSQL_ROOT_PASSWORD` — dibutuhkan untuk restore backup.

---

## 9. Redeploy / update aplikasi

Push ke `main` (kalau auto-deploy aktif) atau klik **Redeploy** di Dokploy.

- Volume `mysql_data` **tidak tersentuh**. Data aman.
- Perubahan env yang berawalan `VITE_` butuh rebuild penuh
  (matikan cache build kalau perlu) karena nilainya menempel di bundle.

---

## 10. Mengganti password database (hati-hati)

`MYSQL_PASSWORD` hanya diterapkan MySQL **saat volume masih kosong**. Setelah
database berisi data, mengubah variabel itu **tidak** mengubah password user di
MySQL sehingga API kehilangan koneksi.

Untuk merotasi tanpa kehilangan data:

```bash
docker exec -it $(docker ps -qf name=mysql) mysql -u root -p
```

```sql
ALTER USER 'pdits'@'%' IDENTIFIED BY 'password-baru';
FLUSH PRIVILEGES;
```

Baru setelah itu ubah `MYSQL_PASSWORD` di tab Environment lalu redeploy.

`REDIS_PASSWORD` berbeda: Redis membaca password saat start, jadi cukup ubah
variabel lalu redeploy (isi Redis hanyalah cache, bukan data utama).

---

## 11. Troubleshooting

| Gejala | Penyebab umum | Solusi |
|---|---|---|
| Deploy gagal: `JWT_SECRET wajib diisi` | Env belum diisi | Isi tab Environment |
| `error while interpolating services.api.environment.JWT_SECRET` | Sama di atas | Sintaks `${VAR:?}` sengaja menggagalkan deploy lebih awal |
| Health check API `503`, `database: disconnected` | `MYSQL_PASSWORD` berisi `$`, `/`, `+`, `=` | Pakai `openssl rand -hex 24` |
| Login gagal, console browser: CORS | `CORS_ORIGIN` beda dengan domain web | Samakan, tanpa garis miring |
| Login sukses tapi langsung logout | Cookie ditolak | Pastikan web & API memakai domain induk yang sama dan HTTPS aktif |
| Upload Excel gagal `413` | File > 20 MB | Naikkan `MAX_UPLOAD_MB` (maks 50) |
| `429 Too Many Requests` saat login | Limit 10 percobaan/menit per IP | Tunggu satu menit |
| Halaman putih setelah update | CSP memblokir sesuatu | Cek console browser; lihat `Content-Security-Policy` di `nginx.conf` |

---

## 12. Checklist keamanan sebelum go-live

- [ ] `JWT_SECRET` dan `JWT_REFRESH_SECRET` diisi, panjang ≥ 32, **berbeda**
- [ ] `MYSQL_ROOT_PASSWORD` dan `MYSQL_PASSWORD` bukan nilai contoh
- [ ] `REDIS_PASSWORD` diisi
- [ ] `CORS_ORIGIN` tepat sama dengan domain web
- [ ] HTTPS aktif untuk kedua domain
- [ ] Password admin sudah diganti lewat menu Users
- [ ] Backup harian aktif dan **sudah diuji restore** sekali
- [ ] `docker-compose.yml` (dev) tidak pernah dipakai sebagai Compose Path
