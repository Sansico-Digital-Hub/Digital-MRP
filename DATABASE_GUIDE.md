# 🗄️ PDITS Database Guide

Panduan lengkap untuk database schema PDITS.

---

## 📊 Database Overview

**Database:** MySQL 8.0  
**ORM:** Prisma  
**Total Tables:** 8  
**Total Relationships:** 12+

---

## 🗂️ Tables Summary

| Table | Purpose | Records Type | Key Behavior |
|-------|---------|--------------|--------------|
| **users** | Authentication & roles | Permanent | Standard CRUD |
| **items** | Master data produk | Permanent | Standard CRUD |
| **daily_schedules** | Permintaan harian | Historical | Unique: date+shift+item |
| **weekly_schedules** | Permintaan mingguan (data AKTIF per periode + modul) | Historical | Unique: period+module+year+week+item |
| **mrp_versions** | Snapshot setiap upload MRP (versi per periode + modul) | Append-only | Unique: period+module+versionNumber; satu `isCurrent` |
| **mrp_version_rows** | Detail part x minggu milik satu snapshot | Append-only | FK ke mrp_versions (cascade) |
| **fg_stocks** | Stok Finish Good | **Snapshot (Overwrite)** | Unique: itemId |
| **wips** | Work in Progress | **Snapshot (Overwrite)** | Unique: itemId+location |
| **audit_logs** | Audit trail | Append-only | Never updated |
| **notifications** | User notifications | Append-only | Soft delete |

---

## 🔗 Entity Relationship Diagram

```
┌─────────────────────┐
│       users         │
│ ─────────────────── │
│ id (PK)             │◄──────────┐
│ email (UNIQUE)      │           │
│ password            │           │ updatedBy
│ name                │           │
│ role (ENUM)         │           │
│ isActive            │           │
│ createdAt           │           │
│ updatedAt           │           │
└─────────────────────┘           │
         │                        │
         │ userId                 │
         │                        │
         ▼                        │
┌─────────────────────┐           │
│   notifications     │           │
│ ─────────────────── │           │
│ id (PK)             │           │
│ userId (FK) ────────┘           │
│ type (ENUM)         │           │
│ title               │           │
│ message             │           │
│ itemCode            │           │
│ isRead              │           │
│ createdAt           │           │
└─────────────────────┘           │
                                  │
┌─────────────────────┐           │
│       items         │           │
│ ─────────────────── │           │
│ id (PK)             │           │
│ itemCode (UNIQUE)   │           │
│ itemName            │           │
│ unit                │           │
│ createdAt           │           │
│ updatedAt           │           │
└─────────────────────┘           │
         │                        │
         │ itemId                 │
         │                        │
    ┌────┴────┬────────┬──────────┼──────────┐
    │         │        │          │          │
    ▼         ▼        ▼          ▼          ▼
┌─────────┐ ┌──────┐ ┌────────┐ ┌────────┐ ┌──────────┐
│ daily_  │ │weekly│ │fg_     │ │  wips  │ │audit_    │
│schedules│ │_sched│ │stocks  │ │        │ │logs      │
│─────────│ │──────│ │────────│ │────────│ │──────────│
│id (PK)  │ │id(PK)│ │id (PK) │ │id (PK) │ │id (PK)   │
│date     │ │year  │ │itemId  │ │itemId  │ │userId ───┘
│shift    │ │week# │ │(UNIQUE)│ │location│ │action    │
│itemId   │ │itemId│ │quantity│ │quantity│ │entityType│
│(FK)     │ │(FK)  │ │(FK)    │ │(FK)    │ │entityId  │
│quantity │ │qty   │ │date    │ │progress│ │dataBefore│
│         │ │      │ │shift   │ │date    │ │dataAfter │
│UNIQUE:  │ │UNIQUE│ │notes   │ │shift   │ │createdAt │
│date+    │ │year+ │ │updated │ │estFin  │ │          │
│shift+   │ │week+│ │By (FK) │ │status  │ │          │
│itemId   │ │itemId│ │        │ │notes   │ │          │
│         │ │      │ │        │ │updated │ │          │
│         │ │      │ │        │ │By (FK) │ │          │
│         │ │      │ │        │ │        │ │          │
│         │ │      │ │        │ │UNIQUE: │ │          │
│         │ │      │ │        │ │itemId+ │ │          │
│         │ │      │ │        │ │location│ │          │
└─────────┘ └──────┘ └────────┘ └────────┘ └──────────┘
```

---

## 📋 Table Details

### 1. users

**Purpose:** Authentication & authorization

```sql
CREATE TABLE users (
  id VARCHAR(191) PRIMARY KEY,
  email VARCHAR(191) UNIQUE NOT NULL,
  password VARCHAR(191) NOT NULL,
  name VARCHAR(191) NOT NULL,
  role ENUM('SUPER_ADMIN', 'ADMIN', 'USER') DEFAULT 'USER',
  isActive BOOLEAN DEFAULT TRUE,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME ON UPDATE CURRENT_TIMESTAMP
);

INDEX idx_users_email (email);
INDEX idx_users_role (role);
```

**Sample Data:**
```
id: cuid_abc123
email: admin@pdits.com
password: $2b$12$hashed...
name: Super Admin
role: SUPER_ADMIN
isActive: true
```

**Relationships:**
- Has many: audit_logs, notifications, fg_stocks, wips

---

### 2. items

**Purpose:** Master data produk

```sql
CREATE TABLE items (
  id VARCHAR(191) PRIMARY KEY,
  itemCode VARCHAR(191) UNIQUE NOT NULL,
  itemName VARCHAR(191) NOT NULL,
  unit VARCHAR(191) NOT NULL,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME ON UPDATE CURRENT_TIMESTAMP
);

INDEX idx_items_itemCode (itemCode);
INDEX idx_items_itemName (itemName);
```

**Sample Data:**
```
id: cuid_item001
itemCode: PROD-A001
itemName: Produk A
unit: pcs
```

**Relationships:**
- Has many: daily_schedules, weekly_schedules, fg_stocks, wips

---

### 3. daily_schedules

**Purpose:** Permintaan harian per tanggal & shift

```sql
CREATE TABLE daily_schedules (
  id VARCHAR(191) PRIMARY KEY,
  date DATE NOT NULL,
  shift INT NOT NULL,
  itemId VARCHAR(191) NOT NULL,
  quantity DOUBLE NOT NULL,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME ON UPDATE CURRENT_TIMESTAMP,
  
  FOREIGN KEY (itemId) REFERENCES items(id) ON DELETE CASCADE,
  UNIQUE KEY unique_daily (date, shift, itemId)
);

INDEX idx_daily_date_shift (date, shift);
INDEX idx_daily_itemId (itemId);
```

**Sample Data:**
```
id: cuid_daily001
date: 2026-05-12
shift: 1
itemId: cuid_item001
quantity: 150
```

**Key Behavior:**
- ✅ Historical data (tidak overwrite)
- ✅ Unique per date + shift + item
- ✅ Jika input duplicate → error atau upsert

---

### 4. weekly_schedules

**Purpose:** Permintaan mingguan (26 weeks)

```sql
CREATE TABLE weekly_schedules (
  id VARCHAR(191) PRIMARY KEY,
  year INT NOT NULL,
  weekNumber INT NOT NULL,
  weekStartDate DATE NOT NULL,
  weekEndDate DATE NOT NULL,
  itemId VARCHAR(191) NOT NULL,
  quantity DOUBLE NOT NULL,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME ON UPDATE CURRENT_TIMESTAMP,
  
  FOREIGN KEY (itemId) REFERENCES items(id) ON DELETE CASCADE,
  UNIQUE KEY unique_weekly (year, weekNumber, itemId)
);

INDEX idx_weekly_year_week (year, weekNumber);
INDEX idx_weekly_itemId (itemId);
```

**Sample Data:**
```
id: cuid_weekly001
year: 2026
weekNumber: 20
weekStartDate: 2026-05-11
weekEndDate: 2026-05-17
itemId: cuid_item001
quantity: 1000
```

**Key Behavior:**
- ✅ Historical data (tidak overwrite)
- ✅ Unique per year + week + item
- ✅ Week 1-26 only
- ⚠️ Sejak fitur riwayat MRP (2026-10-26) baris di tabel ini = **data AKTIF** untuk satu `periodId` + `moduleType`. Setiap upload Excel menulis ulang baris periode+modul ini **dan** menyimpan snapshot ke `mrp_versions` / `mrp_version_rows`. Edit manual di tabel ini tidak mengubah snapshot.

---

### 5. fg_stocks (⚠️ OVERWRITE BEHAVIOR)

**Purpose:** Stok Finish Good (snapshot terkini)

```sql
CREATE TABLE fg_stocks (
  id VARCHAR(191) PRIMARY KEY,
  itemId VARCHAR(191) UNIQUE NOT NULL,  -- UNIQUE!
  quantity DOUBLE NOT NULL,
  date DATE NOT NULL,
  shift INT,
  notes TEXT,
  updatedBy VARCHAR(191) NOT NULL,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME ON UPDATE CURRENT_TIMESTAMP,
  
  FOREIGN KEY (itemId) REFERENCES items(id) ON DELETE CASCADE,
  FOREIGN KEY (updatedBy) REFERENCES users(id)
);

INDEX idx_fg_itemId (itemId);
INDEX idx_fg_date (date);
```

**Sample Data:**
```
id: cuid_fg001
itemId: cuid_item001  -- UNIQUE per item
quantity: 100
date: 2026-05-12
shift: 1
updatedBy: cuid_admin
```

**Key Behavior:**
- ⚠️ **OVERWRITE:** Hanya 1 record per item
- ⚠️ Input baru → replace data lama
- ✅ Audit log mencatat before/after
- ✅ Cache diinvalidate saat update

**Upsert Logic:**
```typescript
await prisma.fGStock.upsert({
  where: { itemId: item.id },
  update: { quantity, date, shift, updatedBy },
  create: { itemId, quantity, date, shift, updatedBy }
})
```

---

### 6. wips (⚠️ OVERWRITE BEHAVIOR)

**Purpose:** Work in Progress per lokasi (snapshot terkini)

```sql
CREATE TABLE wips (
  id VARCHAR(191) PRIMARY KEY,
  itemId VARCHAR(191) NOT NULL,
  location VARCHAR(191) NOT NULL,
  quantity DOUBLE NOT NULL,
  progressPercent INT DEFAULT 0,
  date DATE NOT NULL,
  shift INT NOT NULL,
  estimatedFinish DATE NOT NULL,
  status ENUM('IN_PROGRESS', 'ON_HOLD', 'DELAYED', 'COMPLETED') DEFAULT 'IN_PROGRESS',
  notes TEXT,
  updatedBy VARCHAR(191) NOT NULL,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME ON UPDATE CURRENT_TIMESTAMP,
  
  FOREIGN KEY (itemId) REFERENCES items(id) ON DELETE CASCADE,
  FOREIGN KEY (updatedBy) REFERENCES users(id),
  UNIQUE KEY unique_wip (itemId, location)  -- UNIQUE!
);

INDEX idx_wip_itemId (itemId);
INDEX idx_wip_location (location);
INDEX idx_wip_status (status);
INDEX idx_wip_date_shift (date, shift);
```

**Sample Data:**
```
id: cuid_wip001
itemId: cuid_item001
location: Mesin-01  -- UNIQUE per item + location
quantity: 25
progressPercent: 60
date: 2026-05-12
shift: 1
estimatedFinish: 2026-05-14
status: IN_PROGRESS
updatedBy: cuid_admin
```

**Key Behavior:**
- ⚠️ **OVERWRITE:** Hanya 1 record per item + location
- ⚠️ Input baru untuk item + location yang sama → replace
- ✅ Bisa ada multiple WIP untuk 1 item (beda lokasi)
- ✅ Audit log mencatat before/after
- ✅ Cache diinvalidate saat update

**Upsert Logic:**
```typescript
await prisma.wIP.upsert({
  where: { 
    itemId_location: { 
      itemId: item.id, 
      location: 'Mesin-01' 
    } 
  },
  update: { quantity, progressPercent, date, shift, updatedBy },
  create: { itemId, location, quantity, progressPercent, date, shift, updatedBy }
})
```

---

### 7. audit_logs

**Purpose:** Audit trail semua perubahan

```sql
CREATE TABLE audit_logs (
  id VARCHAR(191) PRIMARY KEY,
  userId VARCHAR(191) NOT NULL,
  action ENUM('CREATE', 'UPDATE', 'DELETE') NOT NULL,
  entityType VARCHAR(191) NOT NULL,
  entityId VARCHAR(191) NOT NULL,
  dataBefore JSON,
  dataAfter JSON,
  notes TEXT,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (userId) REFERENCES users(id)
);

INDEX idx_audit_userId (userId);
INDEX idx_audit_entity (entityType, entityId);
INDEX idx_audit_createdAt (createdAt);
```

**Sample Data:**
```
id: cuid_audit001
userId: cuid_admin
action: UPDATE
entityType: FGStock
entityId: cuid_fg001
dataBefore: {"quantity": 80}
dataAfter: {"quantity": 100}
notes: "Restock dari produksi"
createdAt: 2026-05-12 10:30:00
```

**Key Behavior:**
- ✅ Append-only (never updated/deleted)
- ✅ Captures before/after data (JSON)
- ✅ Used for history tracking
- ✅ Used for compliance

---

### 8. notifications

**Purpose:** User notifications

```sql
CREATE TABLE notifications (
  id VARCHAR(191) PRIMARY KEY,
  userId VARCHAR(191) NOT NULL,
  type ENUM('SHORTAGE', 'DELAY', 'STALE_DATA', 'INFO') NOT NULL,
  title VARCHAR(191) NOT NULL,
  message TEXT NOT NULL,
  itemCode VARCHAR(191),
  isRead BOOLEAN DEFAULT FALSE,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
);

INDEX idx_notif_userId_isRead (userId, isRead);
INDEX idx_notif_createdAt (createdAt);
```

**Sample Data:**
```
id: cuid_notif001
userId: cuid_user
type: SHORTAGE
title: Shortage Alert
message: PROD-A001 kekurangan 10 pcs
itemCode: PROD-A001
isRead: false
createdAt: 2026-05-12 11:00:00
```

---

## 🔄 Data Flow Examples

### Example 1: Update FG Stock (Overwrite)

```
1. Admin input stok baru:
   itemCode: PROD-A001
   quantity: 150
   date: 2026-05-12
   shift: 1

2. Backend query existing:
   SELECT * FROM fg_stocks WHERE itemId = 'cuid_item001'
   
   Result: { id: 'cuid_fg001', quantity: 100, ... }

3. Create audit log (BEFORE):
   INSERT INTO audit_logs (
     userId, action, entityType, entityId,
     dataBefore, dataAfter
   ) VALUES (
     'cuid_admin', 'UPDATE', 'FGStock', 'cuid_fg001',
     '{"quantity": 100}', '{"quantity": 150}'
   )

4. Upsert FG stock:
   UPDATE fg_stocks 
   SET quantity = 150, date = '2026-05-12', shift = 1, updatedBy = 'cuid_admin'
   WHERE itemId = 'cuid_item001'

5. Invalidate cache:
   DEL cache:fg-stock:PROD-A001
   DEL cache:tracking:*:PROD-A001:*

6. Return success
```

### Example 2: Calculate Item Status

```
1. User request tracking:
   GET /api/v1/tracking/daily?item_code=PROD-A001&date=2026-05-12&shift=1

2. Query demand:
   SELECT quantity FROM daily_schedules
   WHERE itemId = 'cuid_item001' AND date = '2026-05-12' AND shift = 1
   
   Result: demand = 150

3. Query FG stock:
   SELECT quantity FROM fg_stocks WHERE itemId = 'cuid_item001'
   
   Result: fgStock = 100

4. Query WIP (all locations):
   SELECT SUM(quantity) FROM wips 
   WHERE itemId = 'cuid_item001' AND status = 'IN_PROGRESS'
   
   Result: wipTotal = 40

5. Calculate status:
   totalSupply = fgStock + wipTotal = 100 + 40 = 140
   gap = totalSupply - demand = 140 - 150 = -10
   
   if (fgStock >= demand) → FULFILLED
   else if (totalSupply >= demand) → IN_PRODUCTION
   else → SHORTAGE
   
   Result: status = SHORTAGE, gap = -10

6. Return JSON:
   {
     itemCode: "PROD-A001",
     demand: 150,
     fgStock: 100,
     inProduction: 40,
     totalSupply: 140,
     gap: -10,
     status: "SHORTAGE",
     wipDetails: [...]
   }
```

---

## 🔍 Common Queries

### Get Item with All Related Data

```sql
SELECT 
  i.*,
  fg.quantity as fg_quantity,
  (SELECT SUM(quantity) FROM wips WHERE itemId = i.id) as wip_total,
  (SELECT quantity FROM daily_schedules 
   WHERE itemId = i.id AND date = CURDATE() LIMIT 1) as today_demand
FROM items i
LEFT JOIN fg_stocks fg ON fg.itemId = i.id
WHERE i.itemCode = 'PROD-A001';
```

### Get Shortage Items

```sql
SELECT 
  i.itemCode,
  i.itemName,
  ds.quantity as demand,
  COALESCE(fg.quantity, 0) as fg_stock,
  COALESCE((SELECT SUM(quantity) FROM wips WHERE itemId = i.id), 0) as wip_total,
  (COALESCE(fg.quantity, 0) + COALESCE((SELECT SUM(quantity) FROM wips WHERE itemId = i.id), 0)) - ds.quantity as gap
FROM items i
JOIN daily_schedules ds ON ds.itemId = i.id AND ds.date = CURDATE()
LEFT JOIN fg_stocks fg ON fg.itemId = i.id
HAVING gap < 0
ORDER BY gap ASC;
```

### Get Audit History for Item

```sql
SELECT 
  al.*,
  u.name as user_name
FROM audit_logs al
JOIN users u ON u.id = al.userId
WHERE al.entityType = 'FGStock' 
  AND al.entityId IN (
    SELECT id FROM fg_stocks WHERE itemId = 'cuid_item001'
  )
ORDER BY al.createdAt DESC;
```

---

## 🛠️ Database Operations

### Backup

```bash
# Backup database
docker exec pdits-mysql-dev mysqldump -u pdits -pdevpassword pdits_dev > backup.sql

# Backup with timestamp
docker exec pdits-mysql-dev mysqldump -u pdits -pdevpassword pdits_dev > backup_$(date +%Y%m%d_%H%M%S).sql
```

### Restore

```bash
# Restore database
docker exec -i pdits-mysql-dev mysql -u pdits -pdevpassword pdits_dev < backup.sql
```

### Reset

```bash
# Reset database (⚠️ DELETES ALL DATA!)
pnpm --filter @pdits/api prisma migrate reset
```

---

## 🧾 Riwayat Upload MRP (Versioning Mingguan)

MRP diupload berkala (biasanya sekali seminggu). Tombol **Save Overwrite** tidak
lagi menghapus riwayat: setiap upload disimpan sebagai snapshot versi baru, dan
hanya versi terbaru yang menjadi data aktif.

| Table | Isi |
|-------|-----|
| `mrp_versions` | Satu baris per upload: `periodId`, `moduleType`, `versionNumber`, `isCurrent`, `source` (`UPLOAD`/`BACKFILL`), `fileName`, `uploadedAt`, `uploadedBy`, `uploadedByName`, `itemCount`, `rowCount`, `totalQty`, `weekStartDate`, `weekCount`, `clientRequestId` |
| `mrp_version_rows` | Detail `partNumber`, `description`, `weekNumber`, `weekStartDate`, `weekEndDate`, `quantity` per snapshot |

**Aturan penting:**

- Nomor versi berurutan per (`periodId`, `moduleType`) mulai dari 1.
- Tepat satu versi `isCurrent` per periode+modul. MySQL tidak punya partial unique
  index, jadi dijaga kolom `currentKey` = `"<periodId>:<moduleType>"` (unique,
  NULL untuk versi non-aktif).
- `clientRequestId` (unique) membuat penyimpanan idempoten: double-click / retry
  tidak membuat versi ganda.
- Perbandingan antar versi mencocokkan minggu berdasarkan **tanggal awal minggu**,
  bukan nomor W1–W26, karena rentang tanggal bergeser antar upload.
- Menghapus versi aktif (**khusus Super Admin**) = **rollback**: data aktif
  (`weekly_schedules`) dihapus lalu diisi ulang dari versi sebelumnya; bila tidak
  ada versi tersisa, data aktif periode itu dikosongkan. Jejak pelaku disimpan di
  `planning_cycles.lastDataChangeBy/lastDataChangeKind` (`UPLOAD`/`EDIT`/`ROLLBACK`).
- Data lama di-backfill migrasi `20261026000000_mrp_versions` sebagai versi ke-1
  dengan `source = BACKFILL`.

**Endpoint:** `GET/POST /api/v1/mrp-versions`, `POST /api/v1/mrp-versions/preview`,
`GET /api/v1/mrp-versions/:id`, `GET /api/v1/mrp-versions/:id/compare`,
`GET /api/v1/mrp-versions/trend`.

---

## 📊 Performance Tips

### Indexes

All important indexes are already defined in Prisma schema:
- ✅ Primary keys (id)
- ✅ Unique constraints (email, itemCode, etc.)
- ✅ Foreign keys
- ✅ Composite indexes (date+shift, itemId+location)
- ✅ Search indexes (itemName, location)

### Query Optimization

1. **Use indexes:**
   ```sql
   -- Good (uses index)
   WHERE itemCode = 'PROD-A001'
   
   -- Bad (no index)
   WHERE LOWER(itemName) LIKE '%produk%'
   ```

2. **Limit results:**
   ```sql
   SELECT * FROM items LIMIT 100
   ```

3. **Use cache:**
   - FG stocks: 2 min TTL
   - WIP data: 2 min TTL
   - Tracking: 2 min TTL
   - Items list: 30 min TTL

---

## 🔐 Security

### Password Hashing

```typescript
import bcrypt from 'bcrypt';

// Hash password
const hashedPassword = await bcrypt.hash(password, 12);

// Verify password
const isValid = await bcrypt.compare(password, hashedPassword);
```

### SQL Injection Prevention

Prisma automatically prevents SQL injection:

```typescript
// Safe (parameterized)
await prisma.item.findUnique({
  where: { itemCode: userInput }
})

// Never use raw SQL with user input!
// await prisma.$queryRaw`SELECT * FROM items WHERE itemCode = ${userInput}` // ❌
```

---

## 📚 Resources

- **Prisma Docs:** https://www.prisma.io/docs
- **MySQL Docs:** https://dev.mysql.com/doc/
- **Prisma Studio:** `pnpm db:studio`

---

**Last Updated:** Mei 2026  
**Database Version:** 1.0.0
