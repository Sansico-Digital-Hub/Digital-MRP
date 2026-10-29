# PDITS - Production Demand & Inventory Tracking System

Progressive Web Application (PWA) untuk tracking permintaan produksi dan inventory dengan visualisasi real-time.

## 🏗️ Tech Stack

### Frontend
- **React 18** + **TypeScript** + **Vite**
- **TanStack Router** (Type-safe routing)
- **TanStack Query** (Data fetching & caching)
- **Zustand** (State management)
- **shadcn/ui** + **Tailwind CSS** (UI Components)
- **Recharts** (Data visualization)
- **PWA** (vite-plugin-pwa + Workbox)

### Backend
- **Node.js 20** + **TypeScript**
- **Fastify** (Web framework)
- **Prisma** (ORM)
- **MySQL 8.0** (Database)
- **Redis 7** (Caching & job queue)
- **BullMQ** (Background jobs)
- **JWT** (Authentication)

## 📋 Prerequisites

- **Node.js** >= 20.0.0
- **pnpm** >= 8.0.0
- **Docker** & **Docker Compose** (untuk development)

## 🚀 Quick Start

### 1. Clone & Install Dependencies

```bash
cd pdits
pnpm install
```

### 2. Setup Environment Variables

```bash
cp .env.example .env
```

Edit `.env` dan sesuaikan dengan konfigurasi lokal Anda:

```env
DATABASE_URL=mysql://pdits:devpassword@localhost:3306/pdits_dev
REDIS_URL=redis://localhost:6379
JWT_SECRET=your-secret-key-min-64-characters
JWT_REFRESH_SECRET=your-refresh-secret-key-min-64-characters
```

### 3. Start Database (MySQL & Redis)

```bash
docker-compose up -d
```

Tunggu hingga MySQL dan Redis siap (cek dengan `docker-compose ps`).

### 4. Run Database Migration

```bash
pnpm db:migrate
```

Ini akan:
- Generate Prisma Client
- Membuat tabel-tabel di database
- Menjalankan seed data (jika ada)

### 5. Start Development Servers

**Terminal 1 - Backend API:**
```bash
pnpm dev:api
```

API akan berjalan di `http://localhost:3001`

**Terminal 2 - Frontend:**
```bash
pnpm dev:web
```

Frontend akan berjalan di `http://localhost:5173`

### 6. Akses Aplikasi

- **Frontend:** http://localhost:5173
- **API:** http://localhost:3001
- **API Health Check:** http://localhost:3001/api/v1/health
- **Prisma Studio:** `pnpm db:studio` (http://localhost:5555)

## 📁 Project Structure

```
pdits/
├── apps/
│   ├── web/                    # Frontend React PWA
│   │   ├── src/
│   │   │   ├── components/     # Reusable UI components
│   │   │   ├── routes/         # TanStack Router routes
│   │   │   ├── hooks/          # Custom React hooks
│   │   │   ├── stores/         # Zustand stores
│   │   │   ├── lib/            # Utilities & API client
│   │   │   └── types/          # TypeScript types
│   │   ├── public/
│   │   │   └── manifest.json   # PWA manifest
│   │   └── vite.config.ts
│   │
│   └── api/                    # Backend Fastify
│       ├── src/
│       │   ├── routes/         # Route handlers
│       │   ├── services/       # Business logic
│       │   ├── middleware/     # Auth, rate-limit, dll.
│       │   ├── lib/            # DB client, Redis, dll.
│       │   └── config/         # Configuration
│       └── prisma/
│           ├── schema.prisma   # Database schema
│           └── migrations/     # Migration files
│
├── packages/
│   └── shared/                 # Shared types & schemas
│       └── src/
│           ├── types/          # TypeScript interfaces
│           ├── schemas/        # Zod validation schemas
│           └── utils/          # Shared utilities
│
├── docker-compose.yml          # MySQL & Redis untuk dev
├── pnpm-workspace.yaml         # Monorepo config
└── package.json                # Root scripts
```

## 🗄️ Database Schema

### Tabel Utama:

1. **users** - Data pengguna & role (SUPER_ADMIN, ADMIN, USER)
2. **items** - Master data item/produk
3. **daily_schedules** - Permintaan harian per tanggal & shift
4. **weekly_schedules** - Permintaan mingguan (26 weeks)
5. **fg_stocks** - Stok Finish Good (snapshot terkini, overwrite)
6. **wips** - Work in Progress per lokasi (snapshot terkini, overwrite)
7. **audit_logs** - Log setiap perubahan data
8. **notifications** - Notifikasi shortage & alert

### Karakteristik Data:

- **Daily & Weekly Schedule:** Data historis, setiap input tersimpan
- **FG Stock & WIP:** Data terkini, input baru **menggantikan** data lama (overwrite)

## 🔧 Available Scripts

### Root Level

```bash
pnpm dev              # Start semua services (frontend + backend)
pnpm dev:web          # Start frontend saja
pnpm dev:api          # Start backend saja
pnpm build            # Build semua packages
pnpm test             # Run semua tests
pnpm lint             # Lint semua packages
```

### Database

```bash
pnpm db:migrate       # Run migration (development)
pnpm db:deploy        # Deploy migration (production)
pnpm db:studio        # Open Prisma Studio
pnpm db:generate      # Generate Prisma Client
```

## 🧪 Testing

```bash
# Run all tests
pnpm test

# Run tests for specific package
pnpm --filter @pdits/api test
pnpm --filter @pdits/web test
pnpm --filter @pdits/shared test
```

## 📦 Build for Production

```bash
# Build all packages
pnpm build

# Build specific package
pnpm build:web
pnpm build:api
```

## 🐳 Docker Deployment

Panduan lengkap deploy ke VPS dengan Dokploy: **[DEPLOY_DOKPLOY.md](./DEPLOY_DOKPLOY.md)**

File yang dipakai saat deploy (semua di root repo):

| File | Keterangan |
|---|---|
| `docker-compose.dokploy.yml` | Compose untuk Dokploy (isi ini di field **Compose Path**) |
| `Dockerfile.api` | Image API (Node 22 + Prisma, non-root) |
| `Dockerfile.web` | Image web (Vite build → nginx) |
| `nginx.conf` | Konfigurasi nginx + header keamanan |
| `.env.production.example` | Daftar variabel environment untuk tab Environment Dokploy |

> `docker-compose.yml` hanya untuk **development** (MySQL mempublikasikan port
> 3306 dengan password contoh). Jangan dipakai di server.

### Build Docker Images (lokal)

```bash
docker build -f Dockerfile.web -t pdits-web .
docker build -f Dockerfile.api -t pdits-api .
```

## 🔐 Default Users (Hanya untuk Development)

Akun contoh di bawah dibuat oleh `prisma/seed.ts`, **khusus database lokal**:

- **Super Admin:** admin@pdits.com / password123
- **Admin:** dataentry@pdits.com / password123
- **User:** user@pdits.com / password123

> ⚠️ **Jangan pernah menjalankan `prisma:seed` di server produksi.**
> Di produksi, akun pertama dibuat otomatis dari `ADMIN_EMAIL` / `ADMIN_PASSWORD`
> (lihat `apps/api/src/lib/bootstrapAdmin.ts`) hanya ketika tabel `users` masih
> kosong. Setelah login pertama, segera ganti password lewat menu Users.

## 📊 Features

### ✅ Implemented (Database & Backend Structure)

- [x] Database schema dengan Prisma
- [x] User authentication & authorization
- [x] Master data items
- [x] Daily & Weekly schedule management
- [x] FG Stock tracking (overwrite behavior)
- [x] WIP tracking per location (overwrite behavior)
- [x] Audit logging
- [x] Notification system

### 🚧 Next Steps

- [ ] Auth routes & JWT middleware
- [ ] CRUD routes untuk semua entities
- [ ] Tracking & dashboard API
- [ ] Import/Export Excel functionality
- [ ] Frontend UI components
- [ ] PWA configuration
- [ ] Web Push notifications
- [ ] Background jobs (BullMQ)
- [ ] E2E tests

## 🤝 Contributing

1. Create feature branch: `git checkout -b feature/nama-fitur`
2. Commit changes: `git commit -m 'Add: deskripsi fitur'`
3. Push to branch: `git push origin feature/nama-fitur`
4. Create Pull Request

## 📝 License

MIT License - see LICENSE file for details

## 📞 Support

Untuk pertanyaan atau issue, silakan buat issue di repository ini.

---

**Version:** 1.0.0  
**Last Updated:** Mei 2026
