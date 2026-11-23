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

### Kode harus sudah ada di GitHub

Dokploy men-clone repo dari GitHub, **bukan** membaca folder di laptop Anda.
Sebelum mulai, pastikan branch yang akan dipilih di Dokploy sudah berisi semua
perubahan, termasuk folder migrasi Prisma:

```bash
git status
git add -A
git commit -m "chore: siap deploy"
git push origin dev
```

Lalu pilih salah satu:

- **Paling sederhana:** di Dokploy isi **Branch** = `dev` (deploy langsung dari
  branch kerja), atau
- Buat Pull Request `dev` → `main`, merge, lalu deploy **Branch** = `main`.

> 🔴 Yang wajib ikut ter-commit: `docker-compose.dokploy.yml`,
> `Dockerfile.api`, `Dockerfile.web`, `nginx.conf`, dan **seluruh isi
> `apps/api/prisma/migrations/`**. Tanpa folder migrasi, container API tetap
> start tapi tabel database tidak akan dibuat.

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

Pastikan port yang dibutuhkan terbuka di firewall VPS:

```bash
sudo ufw allow 80,443,3000/tcp
```

Port 80/443 wajib untuk Traefik + Let's Encrypt. Setelah selesai, sebaiknya
port 3000 (panel Dokploy) dibatasi ke IP kantor/VPN, bukan terbuka ke internet.

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
echo "ADMIN_PASSWORD=$(openssl rand -base64 18)"
```

Simpan semuanya di password manager **sebelum** menekan Deploy.

---

## 3. Buat service di Dokploy

1. **Create Project** → nama `pdits`
2. **Create Service** → **Compose**
3. Tab **General**:
   - **Name**: `pdits-prod`
   - **Provider**: GitHub → hubungkan repo → pilih `SansicoAI-dgt/PlannerProject`
   - **Branch**: `main` (atau `dev`, asalkan sama dengan branch yang Anda
     push pada langkah 0 di atas)
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

MAX_UPLOAD_MB=20

SNF_BASE_URL=
SNF_INTEGRATION_API_KEY=
SNF_ALLOWED_PLANT_IDS=2
SNF_DEFAULT_PLANT_ID=2
SNF_REQUEST_TIMEOUT_MS=60000
SNF_SYNC_RETRY_ATTEMPTS=3
SNF_SYNC_RETRY_BACKOFF_MS=500

VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:admin@domain.com
```

Semua variabel di atas sudah diteruskan ke container oleh
`docker-compose.dokploy.yml`. Kalau Anda menambah variabel baru di tab
Environment tapi **tidak** menambahkannya ke blok `environment:` service `api`
di compose, nilainya tidak akan sampai ke aplikasi.

### Kenapa nilai ini penting

| Variabel | Kalau salah / kosong |
|---|---|
| `JWT_SECRET`, `JWT_REFRESH_SECRET` | Container **menolak start** dengan pesan jelas (sejak perbaikan hardening). Dulu server tetap jalan memakai secret yang tertulis di repo sehingga token bisa dipalsukan. |
| `CORS_ORIGIN` | Harus persis domain web, pakai `https://`, **tanpa** garis miring di akhir. Kalau salah, login gagal dengan error CORS yang tidak informatif. |
| `VITE_API_URL` | Ditanam ke bundle **saat build**. Salah nilai → harus redeploy (rebuild), bukan restart. |
| `VITE_ENABLE_MATERIAL_CALC` | `false` menyembunyikan menu Material Calculation. Juga ditanam saat build. |
| `REDIS_PASSWORD` | Dipakai Redis **dan** `REDIS_URL` API. Ganti satu, ganti keduanya (keduanya membaca variabel yang sama). |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Hanya dipakai saat tabel `users` masih kosong. Kode menolak password < 8 karakter; pakai ≥ 16. |
| `MAX_UPLOAD_MB` | Batas upload Excel per file. Default 20; batas luar nginx 60 MB dan API 50 MB. |
| `SNF_BASE_URL`, `SNF_INTEGRATION_API_KEY` | Kosongkan kalau integrasi SNF belum dipakai. Jangan biarkan `http://127.0.0.1:8008` di server — di dalam container alamat itu menunjuk container API sendiri. |

---

## 5. Tambahkan domain

Tab **Domains** → **Add Domain**, dua kali:

| Service | Host | Port | HTTPS | Certificate |
|---|---|---|---|---|
| `web` | `app.domain.com` | **80** | ON | Let's Encrypt |
| `api` | `api.domain.com` | **3001** | ON | Let's Encrypt |

Tidak perlu mempublikasikan port di compose — Dokploy menambahkan label Traefik
secara otomatis dan mengarahkan domain ke service yang dipilih. Nama service
harus persis `web` dan `api` (sesuai kunci di `docker-compose.dokploy.yml`).

Gunakan **satu domain induk** untuk keduanya (`app.domain.com` dan
`api.domain.com`), jangan dua domain yang berbeda. Cookie refresh memakai
`SameSite=Lax`, jadi login hanya andal kalau kedua host masih satu situs
(registrable domain yang sama).

---

## 6. Deploy

Klik **Deploy**. Build pertama **5–15 menit** (pull image, install ~170 paket,
build 3 workspace).

Saat container `api` start, ia menjalankan `prisma migrate deploy` lebih dulu,
sehingga database kosong otomatis dibuatkan tabel. Langkah ini **hanya
menambah** tabel; tidak pernah menghapus data yang sudah ada.

Pantau **Deploy Logs** di Dokploy. Kalau build berhenti tanpa pesan jelas,
periksa RAM/disk di VPS (`free -h`, `df -h`) — build monorepo pnpm butuh ruang
dan RAM lebih dari container biasa.

---

## 7. Verifikasi

```bash
curl https://api.domain.com/api/v1/health
```

Harapan:

```json
{"status":"ok","services":{"database":"connected","redis":"connected"}}
```

Pastikan keempat container hidup dan API sudah menerapkan migrasi:

```bash
docker ps --format 'table {{.Names}}\t{{.Status}}'
docker exec $(docker ps -qf name=api) \
  ./node_modules/.bin/prisma migrate status --schema=./prisma/schema.prisma
```

`prisma migrate status` harus berakhir dengan
`Database schema is up to date!`. Kalau ada migrasi `not yet applied`, berarti
folder `apps/api/prisma/migrations/` tidak ikut ter-commit/ter-push.

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
3. Tab **Backups** → **Volume Backup** untuk volume data MySQL, jadwal harian,
   retention 7 hari. **Ini wajib.** Nama volume diberi prefix oleh Compose,
   jadi cari nama persisnya dulu:

   ```bash
   docker volume ls | grep mysql_data
   ```

4. Simpan `MYSQL_ROOT_PASSWORD` — dibutuhkan untuk restore backup.

Kalau menu Volume Backup tidak tersedia di versi Dokploy Anda, pakai cron
harian di VPS (jalankan `crontab -e` sebagai root):

```bash
0 2 * * * docker exec $(docker ps -qf name=mysql) sh -c 'exec mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction --routines --triggers "$MYSQL_DATABASE"' | gzip > /root/db-backup-$(date +\%F).sql.gz
30 2 * * * find /root -name 'db-backup-*.sql.gz' -mtime +7 -delete
```

Uji restore sekali ke database sementara — backup yang belum pernah diuji
restore belum bisa disebut backup.

---

## 9. Redeploy / update aplikasi

Push ke branch yang dipilih di Dokploy (kalau auto-deploy aktif) atau klik
**Redeploy** di Dokploy.

- Volume `mysql_data` **tidak tersentuh**. Data aman.
- Perubahan env yang berawalan `VITE_` butuh rebuild penuh
  (matikan cache build kalau perlu) karena nilainya menempel di bundle.
- **Jangan mengganti nama service/project Compose setelah go-live.** Nama
  volume mengikuti nama project, jadi mengganti nama akan membuat Docker
  membuat volume baru yang kosong (database lama tidak hilang, tetapi tidak
  terpakai lagi).

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
| Health `redis: disconnected`, padahal Redis hidup | `REDIS_PASSWORD` di tab Environment beda dengan yang dipakai saat Redis start | Samakan, lalu redeploy (Redis membaca password saat start) |
| Login/API error `P2021: Table ... does not exist` | Folder `apps/api/prisma/migrations/` tidak ikut ter-push | Commit & push migrasi, lalu redeploy |
| Login gagal, console browser: CORS | `CORS_ORIGIN` beda dengan domain web | Samakan, tanpa garis miring |
| Login sukses tapi langsung logout | Cookie ditolak | Pastikan web & API memakai domain induk yang sama dan HTTPS aktif |
| Upload Excel gagal `413` | File > 20 MB | Naikkan `MAX_UPLOAD_MB` (maks 50) |
| `429 Too Many Requests` saat login | Limit 10 percobaan/menit per IP | Tunggu satu menit |
| Halaman putih setelah update | CSP memblokir sesuatu | Cek console browser; lihat `Content-Security-Policy` di `nginx.conf` |
| Build gagal / container dibunuh | RAM atau disk VPS habis | Tambah swap, bersihkan image lama (`docker system prune -af`), atau naikkan spesifikasi VPS |
| `the --mount option requires BuildKit` | Docker daemon memakai builder lama | Set `DOCKER_BUILDKIT=1` di environment daemon, lalu restart Docker |
| Setelah redeploy masih tampil versi lama | Service worker PWA menyajikan cache | Tutup semua tab aplikasi, hard reload (Ctrl+Shift+R), atau unregister service worker sekali |

---

## 12. Checklist keamanan sebelum go-live

- [ ] Branch yang di-deploy memang berisi kode terbaru + folder migrasi
- [ ] `JWT_SECRET` dan `JWT_REFRESH_SECRET` diisi, panjang ≥ 32, **berbeda**
- [ ] `MYSQL_ROOT_PASSWORD` dan `MYSQL_PASSWORD` bukan nilai contoh
- [ ] `REDIS_PASSWORD` diisi
- [ ] `CORS_ORIGIN` tepat sama dengan domain web
- [ ] `VITE_API_URL` memakai domain API + `/api/v1`
- [ ] HTTPS aktif untuk kedua domain
- [ ] `prisma migrate status` = up to date
- [ ] Password admin sudah diganti lewat menu Users
- [ ] Backup harian aktif dan **sudah diuji restore** sekali
- [ ] `docker-compose.yml` (dev) tidak pernah dipakai sebagai Compose Path
