-- ============================================================================
-- ROLE PLANNER: tambah PRODUCTION_PLANNER & MATERIAL_PLANNER ke enum UserRole
-- ============================================================================
-- MASALAH: dropdown "System Role" di halaman User Management sudah menawarkan
--   "Production Planner" dan "Material Planner", tetapi enum `UserRole` di
--   database hanya punya SUPER_ADMIN, ADMIN, USER. Akibatnya `prisma.user.create`
--   gagal: "Invalid value for argument `role`. Expected UserRole."
--
-- SOLUSI: perluas enum MySQL `users.role` agar sama persis dengan enum Prisma
--   (urutan mengikuti schema.prisma, karena urutan enum memengaruhi sorting).
--
-- TIDAK ADA perubahan/pergeseran data: nilai lama tetap valid.
-- ============================================================================

ALTER TABLE `users`
    MODIFY COLUMN `role`
        ENUM('SUPER_ADMIN', 'ADMIN', 'PRODUCTION_PLANNER', 'MATERIAL_PLANNER', 'USER')
        NOT NULL DEFAULT 'USER';
