import { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import { authenticate, requireRole } from '../middleware/auth';
import { EDIT_ROLES } from '../lib/permissions';
import { config } from '../config';
import { attachNpofTitles, hasRealPartNumber, sumUpsForScenario } from '../lib/npofNormalize';
import {
  describeSnfError,
  getPlantVerificationState,
  runExclusiveSync,
  type SyncDeps,
} from '../lib/npofSync';

const PLANT_LABEL = 'PT. Printec Perkasa II';

const LIST_SELECT = {
  id: true,
  plantId: true,
  partNumber: true,
  partNumberNorm: true,
  partName: true,
  productName: true,
  npofId: true,
  scenario: true,
  selectedRev: true,
  statusLabel: true,
  isApproved: true,
  upsCounted: true,
  specSource: true,
  material: true,
  gramatur: true,
  supplier: true,
  sheetedSize: true,
  sheetedSizeRaw: true,
  sheetedSizeNote: true,
  formulaMaterial: true,
  ups: true,
  upsOriginal: true,
  upsCombined: true,
  removedInLatestRev: true,
  isGangPrint: true,
  isGangPrintParent: true,
  gangPrintParent: true,
  gangPrintGroupId: true,
  groupStatus: true,
  hasAlt: true,
  altPossiblyStale: true,
  newerRevPendingApproval: true,
  hasConflict: true,
  specAvailable: true,
  isActive: true,
  lastSyncedAt: true,
} satisfies Prisma.NpofMaterialSelect;

interface ListQuery {
  page?: string;
  pageSize?: string;
  search?: string;
  scenario?: string;
  gangPrint?: string;
  conflict?: string;
  calculation?: string;
  statusLabel?: string;
}

/** Status approval yang dikirim SNF (status_label). */
const STATUS_LABELS = ['Draft', 'Waiting for Approval', 'Completed'] as const;

function parsePagination(query: ListQuery) {
  const page = Math.max(1, Number.parseInt(query.page || '1', 10) || 1);
  const pageSizeRaw = Number.parseInt(query.pageSize || '50', 10) || 50;
  const pageSize = Math.min(200, Math.max(1, pageSizeRaw));
  return { page, pageSize };
}

function buildWhere(query: ListQuery): Prisma.NpofMaterialWhereInput {
  const where: Prisma.NpofMaterialWhereInput = {
    plantId: { in: [...config.snf.allowedPlantIds] },
    isActive: true,
  };

  const scenario = (query.scenario || '').trim().toLowerCase();
  if (scenario === 'main' || scenario === 'alt') where.scenario = scenario;

  if (query.gangPrint === 'true') where.isGangPrint = true;
  if (query.conflict === 'true') where.hasConflict = true;

  // "Dipakai kalkulasi" = predicate yang sama dengan ACTIVE_NPOF_WHERE di
  // materialPlanning.ts (approved + scenario main). Baris lain tidak pernah
  // masuk perhitungan Material Planning.
  const calculation = (query.calculation || '').trim().toLowerCase();
  if (calculation === 'active') {
    where.AND = [{ isApproved: true, scenario: 'main' }];
  } else if (calculation === 'inactive') {
    where.AND = [{ NOT: { isApproved: true, scenario: 'main' } }];
  }

  // Filter Status = status_label dari SNF (Draft / Waiting for Approval /
  // Completed). Nilai di luar daftar diabaikan (jangan menebak).
  const statusLabel = (query.statusLabel || '').trim().toLowerCase();
  const matchedStatus = STATUS_LABELS.find((label) => label.toLowerCase() === statusLabel);
  if (matchedStatus) where.statusLabel = matchedStatus;

  const search = (query.search || '').trim();
  if (search) {
    where.OR = [
      { partNumberNorm: { contains: search.toUpperCase() } },
      { partName: { contains: search } },
      { productName: { contains: search } },
      { supplier: { contains: search } },
    ];
  }

  return where;
}

export default async function npofMaterialsRoutes(server: FastifyInstance) {
  // Daftar NPOF Materials (server-side search, filter, dan pagination).
  server.get('/api/v1/npof-materials', { preValidation: [authenticate] }, async (request, reply) => {
    const query = (request.query || {}) as ListQuery;
    const { page, pageSize } = parsePagination(query);
    const where = buildWhere(query);

    const [total, rows, allFiltered, lastSync] = await Promise.all([
      prisma.npofMaterial.count({ where }),
      prisma.npofMaterial.findMany({
        where,
        select: LIST_SELECT,
        orderBy: [{ partNumberNorm: 'asc' }, { scenario: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      // Baris lengkap (hanya kolom ringan) untuk total UPS & jumlah yang
      // dikecualikan. Dataset NPOF satu plant masih kecil (ratusan baris).
      prisma.npofMaterial.findMany({
        where,
        select: {
          scenario: true,
          partNumber: true,
          removedInLatestRev: true,
          upsCounted: true,
          upsCombined: true,
          upsOriginal: true,
          ups: true,
        },
      }),
      prisma.npofMaterial.aggregate({
        where: { plantId: { in: [...config.snf.allowedPlantIds] } },
        _max: { lastSyncedAt: true },
      }),
    ]);

    const selectedScenario =
      query.scenario === 'alt' ? 'alt' : query.scenario === 'main' ? 'main' : 'main';
    // Baris yang tidak ikut total/ekspor: belum approved (upsCounted=false),
    // dihapus di revisi terbaru, atau tanpa part number.
    const excluded = allFiltered.filter(
      (row) =>
        !row.upsCounted || row.removedInLatestRev || !hasRealPartNumber(row.partNumber)
    ).length;

    return reply.send({
      data: rows,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
      totals: {
        // UPS hanya untuk satu scenario agar main dan alt tidak pernah dijumlah.
        ups: sumUpsForScenario(allFiltered, selectedScenario),
        byScenario: {
          main: sumUpsForScenario(allFiltered, 'main'),
          alt: sumUpsForScenario(allFiltered, 'alt'),
        },
        rows: allFiltered.length,
        excluded,
      },
      meta: {
        plantId: config.snf.defaultPlantId,
        plantLabel: PLANT_LABEL,
        allowedPlantIds: [...config.snf.allowedPlantIds],
        lastSyncedAt: lastSync._max.lastSyncedAt,
        plantVerification: getPlantVerificationState(),
      },
    });
  });

  // Detail satu baris untuk drawer.
  server.get(
    '/api/v1/npof-materials/:id',
    { preValidation: [authenticate] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const data = await prisma.npofMaterial.findFirst({
        where: { id, plantId: { in: [...config.snf.allowedPlantIds] } },
      });
      if (!data) {
        return reply.code(404).send({ error: 'Not Found', message: 'Record not found' });
      }
      return reply.send({
        data: {
          ...data,
          sourceNpofs: attachNpofTitles(data.sourceNpofs, data.npofTitle, data.selectedRev),
          pendingNpofs: attachNpofTitles(data.pendingNpofs, data.npofTitle, data.selectedRev),
        },
      });
    }
  );

  // Sync dari SNF: satu job per plant yang diizinkan (saat ini PP2/2).
  server.post(
    '/api/v1/npof-materials/sync',
    { preValidation: [authenticate, requireRole(EDIT_ROLES.material)] },
    async (request, reply) => {
      const deps: SyncDeps = {
        prisma,
        logger: {
          info: (message) => server.log.info(message),
          warn: (message) => server.log.warn(message),
          error: (message) => server.log.error(message),
        },
      };

      try {
        const summary = await runExclusiveSync(deps);

        if (summary.status === 'failed') {
          const firstError = summary.plants.find((plant) => plant.error)?.error;
          return reply.code(502).send({
            error: 'Sync Failed',
            message: firstError || 'Sinkronisasi gagal. Data lama tidak diubah.',
            ...summary,
          });
        }

        return reply.send({
          message:
            summary.status === 'partial'
              ? 'Sinkronisasi selesai sebagian. Periksa detail per plant.'
              : 'Sinkronisasi selesai.',
          ...summary,
        });
      } catch (error) {
        server.log.error(
          `NPOF sync gagal: ${error instanceof Error ? error.message : String(error)}`
        );
        const described = describeSnfError(error);
        return reply
          .code(described.status)
          .send({ error: 'Sync Failed', message: described.message });
      }
    }
  );
}
