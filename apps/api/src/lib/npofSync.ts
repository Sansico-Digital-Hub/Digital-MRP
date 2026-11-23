/**
 * Sinkronisasi NPOF Materials dari Integration API SNF (read-only).
 *
 * Kontrak:
 *   GET {SNF_BASE_URL}/npof/integration/materials?plant_id=<id>
 *   GET {SNF_BASE_URL}/plants/public                            (verifikasi plant)
 *
 * Aturan keras:
 *   - plant_id SELALU eksplisit; tidak ada request tanpa plant_id.
 *   - Hanya plant di `SNF_ALLOWED_PLANT_IDS` yang diproses.
 *   - Deactivate hanya terjadi setelah respons 200 + status "success".
 *   - Baris plant lain tidak pernah disentuh.
 */

import { config } from '../config';
import {
  normalizeMainRow,
  resolveRowPlantId,
  type NormalizedMainRow,
  type SnfMainRow,
} from './npofNormalize';

export type SnfErrorCode =
  | 'API_KEY_MISSING'
  | 'INVALID_API_KEY'
  | 'UPSTREAM_ERROR'
  | 'TIMEOUT'
  | 'INVALID_RESPONSE'
  | 'PLANT_MISMATCH'
  | 'PLANT_NOT_VERIFIED'
  | 'SYNC_IN_PROGRESS';

export class SnfIntegrationError extends Error {
  constructor(
    public readonly code: SnfErrorCode,
    message: string,
    public readonly httpStatus = 502
  ) {
    super(message);
    this.name = 'SnfIntegrationError';
  }
}

/** Pesan aman untuk ditampilkan ke user (tanpa API key / detail internal). */
export function describeSnfError(error: unknown): { status: number; message: string } {
  if (error instanceof SnfIntegrationError) {
    switch (error.code) {
      case 'API_KEY_MISSING':
        return {
          status: 503,
          message:
            'Integration API key belum dikonfigurasi di server. Hubungi admin untuk mengisi SNF_INTEGRATION_API_KEY.',
        };
      case 'INVALID_API_KEY':
        return {
          status: 502,
          message:
            'Kredensial Integration API SNF ditolak (403 Invalid API Key). Periksa kembali SNF_INTEGRATION_API_KEY di server.',
        };
      case 'TIMEOUT':
        return { status: 504, message: 'SNF tidak merespons dalam batas waktu. Coba lagi.' };
      case 'UPSTREAM_ERROR':
        return { status: 502, message: 'SNF sedang bermasalah (500). Silakan coba lagi.' };
      case 'INVALID_RESPONSE':
        return { status: 502, message: 'Respons SNF tidak sesuai kontrak. Data lama tidak diubah.' };
      case 'PLANT_MISMATCH':
      case 'PLANT_NOT_VERIFIED':
        return { status: 409, message: error.message };
      case 'SYNC_IN_PROGRESS':
        return { status: 409, message: 'Sinkronisasi NPOF sedang berjalan. Tunggu sampai selesai.' };
      default:
        return { status: error.httpStatus, message: error.message };
    }
  }
  return { status: 500, message: 'Sinkronisasi gagal. Data lama tidak diubah.' };
}

export interface SnfLogger {
  info?: (message: string) => void;
  warn: (message: string) => void;
  error?: (message: string) => void;
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/**
 * Irisan Prisma Client yang dipakai sync. Argumen sengaja `any` agar
 * PrismaClient (tipe generik) maupun tiruan pengujian bisa dipakai tanpa cast.
 */
export interface NpofPrismaTx {
  npofMaterial: {
    findMany: (args?: any) => Promise<NpofExistingRow[]>;
    create: (args: any) => Promise<any>;
    update: (args: any) => Promise<any>;
    updateMany: (args: any) => Promise<{ count: number }>;
  };
}

export interface NpofPrisma extends NpofPrismaTx {
  $transaction?: (work: (tx: NpofPrismaTx) => Promise<any>, options?: any) => Promise<any>;
}

export interface NpofExistingRow {
  id: string;
  partNumberNorm: string;
  scenario: string;
  isActive?: boolean;
}

export interface SyncDeps {
  prisma: NpofPrisma;
  fetchImpl?: FetchLike;
  logger?: SnfLogger;
  now?: () => Date;
  config?: {
    baseUrl: string;
    apiKey: string;
    allowedPlantIds: readonly number[];
    requestTimeoutMs: number;
    syncRetryAttempts: number;
    syncRetryBackoffMs: number;
  };
  /** Pengganti transaksi untuk pengujian. Default: prisma.$transaction. */
  runTransaction?: <T>(work: (tx: NpofPrismaTx) => Promise<T>) => Promise<T>;
}

export interface PlantSyncResult {
  plantId: number;
  created: number;
  updated: number;
  deactivated: number;
  skipped: number;
  durationMs: number;
  error?: string;
}

export interface SyncSummary {
  status: 'success' | 'partial' | 'failed';
  plants: PlantSyncResult[];
  totals: {
    created: number;
    updated: number;
    deactivated: number;
    skipped: number;
    durationMs: number;
  };
}

interface PlantVerificationState {
  verified: boolean;
  pp2Id: number | null;
  checkedAt: Date | null;
  reason: string | null;
}

let verificationState: PlantVerificationState = {
  verified: false,
  pp2Id: null,
  checkedAt: null,
  reason: 'belum diverifikasi',
};

let verificationInFlight: Promise<PlantVerificationState> | null = null;
let activeSync: Promise<SyncSummary> | null = null;

export function getPlantVerificationState(): PlantVerificationState {
  return verificationState;
}

function runtimeConfig(deps: SyncDeps) {
  return deps.config ?? config.snf;
}

function requireApiKey(deps: SyncDeps): string {
  const apiKey = runtimeConfig(deps).apiKey?.trim();
  if (!apiKey) {
    throw new SnfIntegrationError(
      'API_KEY_MISSING',
      'SNF_INTEGRATION_API_KEY belum dikonfigurasi'
    );
  }
  return apiKey;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'AbortError' || /aborted|ABORT_ERR/i.test(error.message))
  );
}

/** Satu percobaan request dengan timeout eksplisit. */
async function fetchOnce(
  deps: SyncDeps,
  url: string,
  headers: Record<string, string>,
  timeoutMs: number
): Promise<Response> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { method: 'GET', headers, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted || isAbortError(error)) {
      throw new SnfIntegrationError('TIMEOUT', `Timeout setelah ${timeoutMs} ms: ${url}`);
    }
    throw new SnfIntegrationError(
      'UPSTREAM_ERROR',
      `Gagal menghubungi SNF: ${error instanceof Error ? error.message : String(error)}`
    );
  } finally {
    clearTimeout(timer);
  }
}

async function readErrorDetail(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as Record<string, unknown>;
    const detail = body?.detail ?? body?.message ?? body?.error;
    return typeof detail === 'string' ? detail : '';
  } catch {
    return '';
  }
}

/**
 * Request JSON dengan retry + backoff. Retry dilakukan untuk timeout, gangguan
 * jaringan, dan 5xx. 403/503 dikembalikan sebagai error kredensial (tidak
 * diulang karena hasilnya akan sama).
 */
async function requestJson<T>(
  deps: SyncDeps,
  path: string,
  options: { withApiKey: boolean; expectArray?: boolean }
): Promise<T> {
  const runtime = runtimeConfig(deps);
  const baseUrl = runtime.baseUrl.replace(/\/+$/, '');
  const url = `${baseUrl}${path}`;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.withApiKey) headers['X-API-Key'] = requireApiKey(deps);

  const attempts = Math.max(1, runtime.syncRetryAttempts);
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetchOnce(deps, url, headers, runtime.requestTimeoutMs);

      if (response.status === 403) {
        throw new SnfIntegrationError('INVALID_API_KEY', 'SNF menolak API key (403)');
      }
      if (response.status === 503) {
        const detail = await readErrorDetail(response);
        if (/api key/i.test(detail)) {
          throw new SnfIntegrationError(
            'API_KEY_MISSING',
            'SNF: Integration API key is not configured'
          );
        }
        throw new SnfIntegrationError('UPSTREAM_ERROR', 'SNF sedang tidak tersedia (503)');
      }
      if (!response.ok) {
        throw new SnfIntegrationError(
          'UPSTREAM_ERROR',
          `SNF mengembalikan status ${response.status}`
        );
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new SnfIntegrationError('INVALID_RESPONSE', 'Respons SNF bukan JSON yang valid');
      }

      if (
        options.expectArray &&
        (payload === null ||
          typeof payload !== 'object' ||
          !Array.isArray((payload as { data?: unknown }).data))
      ) {
        throw new SnfIntegrationError(
          'INVALID_RESPONSE',
          'Respons SNF tidak memiliki array data'
        );
      }
      return payload as T;
    } catch (error) {
      if (
        error instanceof SnfIntegrationError &&
        (error.code === 'INVALID_API_KEY' ||
          error.code === 'API_KEY_MISSING' ||
          error.code === 'INVALID_RESPONSE')
      ) {
        throw error;
      }
      lastError = error;
      if (attempt < attempts) {
        const backoff = runtime.syncRetryBackoffMs * 2 ** (attempt - 1);
        deps.logger?.warn(
          `SNF request gagal (percobaan ${attempt}/${attempts}): ${
            error instanceof Error ? error.message : String(error)
          }. Coba lagi dalam ${backoff} ms.`
        );
        await sleep(backoff);
      }
    }
  }

  throw lastError instanceof SnfIntegrationError
    ? lastError
    : new SnfIntegrationError(
        'UPSTREAM_ERROR',
        `SNF gagal setelah ${attempts} percobaan: ${
          lastError instanceof Error ? lastError.message : String(lastError)
        }`
      );
}

interface SnfListResponse<T> {
  status?: string;
  data?: T[];
}

async function fetchMaterials<T>(deps: SyncDeps, path: string, plantId: number): Promise<T[]> {
  const payload = await requestJson<SnfListResponse<T>>(deps, `${path}?plant_id=${plantId}`, {
    withApiKey: true,
    expectArray: true,
  });
  if (payload.status !== 'success') {
    throw new SnfIntegrationError(
      'INVALID_RESPONSE',
      `Respons SNF untuk plant ${plantId} tidak berstatus success`
    );
  }
  return payload.data ?? [];
}

/** Ambil daftar plant publik (tanpa auth) dan pastikan PP2 = plant yang diizinkan. */
export async function verifySnfPlants(deps: SyncDeps): Promise<PlantVerificationState> {
  const runtime = runtimeConfig(deps);
  const allowed = [...runtime.allowedPlantIds];

  try {
    const payload = await requestJson<unknown>(deps, '/plants/public', { withApiKey: false });
    const list = extractPlantList(payload);
    const pp2 = list.find((plant) => String(plant?.code ?? '').trim().toUpperCase() === 'PP2');

    if (!pp2) {
      verificationState = {
        verified: false,
        pp2Id: null,
        checkedAt: new Date(),
        reason: 'Plant berkode PP2 tidak ditemukan di /plants/public.',
      };
    } else {
      const pp2Id = Number.parseInt(String(pp2.id ?? ''), 10);
      if (!Number.isInteger(pp2Id) || !allowed.includes(pp2Id)) {
        verificationState = {
          verified: false,
          pp2Id: Number.isInteger(pp2Id) ? pp2Id : null,
          checkedAt: new Date(),
          reason:
            `id PP2 dari SNF (${pp2.id ?? 'null'}) tidak termasuk SNF_ALLOWED_PLANT_IDS ` +
            `(${allowed.join(',')}). Sync dihentikan agar tidak menebak plant id.`,
        };
      } else {
        verificationState = {
          verified: true,
          pp2Id,
          checkedAt: new Date(),
          reason: null,
        };
      }
    }
  } catch (error) {
    verificationState = {
      verified: false,
      pp2Id: null,
      checkedAt: new Date(),
      reason: `Verifikasi plant gagal: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (verificationState.verified) {
    deps.logger?.info?.(
      `Verifikasi plant SNF OK: PP2 = ${verificationState.pp2Id} ` +
        `(allowed: ${allowed.join(',')}).`
    );
  } else {
    deps.logger?.error?.(`Verifikasi plant SNF GAGAL: ${verificationState.reason}`);
  }

  return verificationState;
}

function extractPlantList(payload: unknown): Array<{ id?: unknown; code?: unknown }> {
  if (Array.isArray(payload)) return payload as Array<{ id?: unknown; code?: unknown }>;
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    for (const key of ['data', 'plants', 'items']) {
      if (Array.isArray(record[key])) {
        return record[key] as Array<{ id?: unknown; code?: unknown }>;
      }
    }
  }
  return [];
}

/**
 * Verifikasi plant sekali saat startup; bila gagal, sync berikutnya mencoba
 * sekali lagi (idempotent, hasil sukses di-cache).
 */
export async function ensurePlantVerification(deps: SyncDeps): Promise<PlantVerificationState> {
  if (verificationState.verified) return verificationState;
  if (!verificationInFlight) {
    verificationInFlight = verifySnfPlants(deps).finally(() => {
      verificationInFlight = null;
    });
  }
  return verificationInFlight;
}

function revisionRank(rev: string | null): number {
  const match = String(rev ?? '').match(/(\d+)/);
  return match ? Number.parseInt(match[1], 10) : -1;
}

function preferNewer(candidate: NormalizedMainRow, current: NormalizedMainRow): boolean {
  // SNF bisa mengirim beberapa baris untuk part+scenario yang sama (mis. satu
  // NPOF approved + beberapa revisi draft/waiting). Baris approved HARUS
  // menang supaya UPS-nya tidak hilang karena tertimpa draft.
  if (candidate.isApproved !== current.isApproved) return candidate.isApproved;
  if (candidate.upsCounted !== current.upsCounted) return candidate.upsCounted;
  const revDiff = revisionRank(candidate.selectedRev) - revisionRank(current.selectedRev);
  if (revDiff !== 0) return revDiff > 0;
  const npofDiff = (candidate.npofId ?? -1) - (current.npofId ?? -1);
  if (npofDiff !== 0) return npofDiff > 0;
  return true;
}

function rowKey(row: NormalizedMainRow): string {
  return `${row.partNumberNorm}\u0000${row.scenario}`;
}

function toDbData(row: NormalizedMainRow, plantId: number, syncedAt: Date) {
  return {
    plantId,
    partNumber: row.partNumber,
    partNumberNorm: row.partNumberNorm,
    partName: row.partName,
    productName: row.productName,
    npofTitle: row.npofTitle,
    npofId: row.npofId,
    scenario: row.scenario,
    selectedRev: row.selectedRev,
    statusLabel: row.statusLabel,
    isApproved: row.isApproved,
    upsCounted: row.upsCounted,
    removedInLatestRev: row.removedInLatestRev,
    isGangPrint: row.isGangPrint,
    isGangPrintParent: row.isGangPrintParent,
    gangPrintParent: row.gangPrintParent,
    gangPrintGroupId: row.gangPrintGroupId,
    groupStatus: row.groupStatus,
    hasAlt: row.hasAlt,
    altPossiblyStale: row.altPossiblyStale,
    newerRevPendingApproval: row.newerRevPendingApproval,
    hasConflict: row.hasConflict,
    conflicts: row.conflicts as never,
    groupMembers: row.groupMembers as never,
    pendingNpofs: row.pendingNpofs as never,
    sourceNpofs: row.sourceNpofs as never,
    material: row.spec.material,
    gramatur: row.spec.gramatur,
    supplier: row.spec.supplier,
    sheetedSize: row.spec.sheetedSize,
    sheetedSizeRaw: row.spec.sheetedSizeRaw,
    lengthCm: row.spec.lengthCm,
    widthCm: row.spec.widthCm,
    sheetedSizeNote: row.spec.sheetedSizeNote,
    formulaMaterial: row.spec.formulaMaterial,
    specAvailable: row.spec.specAvailable,
    specSource: row.specSource,
    rawSpec: row.rawSpec as never,
    ups: row.ups,
    upsOriginal: row.upsOriginal,
    upsCombined: row.upsCombined,
    isActive: true,
    lastSyncedAt: syncedAt,
  };
}

/** Bangun baris siap simpan dari payload SNF (murni, tanpa DB). */
export function buildPlantRows(
  mainRows: SnfMainRow[],
  plantId: number,
  allowedPlantIds: readonly number[],
  logger?: SnfLogger
): { rows: NormalizedMainRow[]; skipped: number } {
  const unique = new Map<string, NormalizedMainRow>();
  let skipped = 0;

  for (const raw of mainRows) {
    const plant = resolveRowPlantId(raw.plant_id, plantId, allowedPlantIds);
    if (plant.plantId === null) {
      skipped++;
      logger?.warn(`NPOF sync plant ${plantId}: baris dilewati — ${plant.reason}.`);
      continue;
    }

    const row = normalizeMainRow(raw);
    const key = rowKey(row);
    const existing = unique.get(key);
    if (existing) {
      skipped++;
      const winner = preferNewer(row, existing) ? row : existing;
      const loser = winner === row ? existing : row;
      // SNF kadang mengirim baris approved + baris draft/waiting untuk part
      // yang sama. Baris approved dipertahankan, dan fakta adanya revisi
      // pending ditampilkan lewat badge.
      if (winner.isApproved && !loser.isApproved) winner.newerRevPendingApproval = true;
      unique.set(key, winner);
    } else {
      unique.set(key, row);
    }
  }

  return { rows: [...unique.values()], skipped };
}

async function runInTransaction<T>(
  deps: SyncDeps,
  work: (tx: NpofPrismaTx) => Promise<T>
): Promise<T> {
  if (deps.runTransaction) return deps.runTransaction(work);
  if (!deps.prisma.$transaction) return work(deps.prisma);
  return deps.prisma.$transaction(work, { timeout: 60_000, maxWait: 10_000 });
}

/** Sync satu plant. Gagal = rollback penuh (tidak ada deactivate). */
export async function syncPlant(plantId: number, deps: SyncDeps): Promise<PlantSyncResult> {
  const startedAt = Date.now();
  const runtime = runtimeConfig(deps);

  if (!runtime.allowedPlantIds.includes(plantId)) {
    throw new SnfIntegrationError(
      'PLANT_MISMATCH',
      `Plant ${plantId} tidak ada di SNF_ALLOWED_PLANT_IDS.`
    );
  }

  // Satu-satunya sumber data: /npof/integration/materials. Endpoint legacy
  // /npof/process-a/materials tidak lagi dipanggil (effective_spec sudah final).
  const mainRows = await fetchMaterials<SnfMainRow>(
    deps,
    '/npof/integration/materials',
    plantId
  );

  const { rows, skipped } = buildPlantRows(
    mainRows,
    plantId,
    runtime.allowedPlantIds,
    deps.logger
  );

  // Respons yang isinya HANYA baris plant lain dianggap tidak sah: jangan
  // sampai seluruh data plant ini di-deactivate karena respons salah alamat.
  if (mainRows.length > 0 && rows.length === 0) {
    throw new SnfIntegrationError(
      'INVALID_RESPONSE',
      `Semua baris respons SNF bukan milik plant ${plantId}. Sync dibatalkan.`
    );
  }

  const syncedAt = deps.now?.() ?? new Date();

  let created = 0;
  let updated = 0;
  let deactivated = 0;

  await runInTransaction(deps, async (tx) => {
    const existing = await tx.npofMaterial.findMany({
      where: { plantId },
      select: { id: true, partNumberNorm: true, scenario: true, isActive: true },
    });
    const byKey = new Map(existing.map((row) => [`${row.partNumberNorm}\u0000${row.scenario}`, row]));
    const keptIds: string[] = [];

    for (const row of rows) {
      const data = toDbData(row, plantId, syncedAt);
      const current = byKey.get(rowKey(row));
      if (current) {
        await tx.npofMaterial.update({ where: { id: current.id }, data });
        keptIds.push(current.id);
        updated++;
      } else {
        const inserted = (await tx.npofMaterial.create({ data })) as { id?: string };
        if (inserted?.id) keptIds.push(inserted.id);
        created++;
      }
    }

    // Soft delete HANYA baris milik plant ini yang tidak ada lagi di respons.
    const result = await tx.npofMaterial.updateMany({
      where: {
        plantId,
        isActive: true,
        ...(keptIds.length > 0 ? { id: { notIn: keptIds } } : {}),
      },
      data: { isActive: false },
    });
    deactivated = result.count;
  });

  return {
    plantId,
    created,
    updated,
    deactivated,
    skipped,
    durationMs: Date.now() - startedAt,
  };
}

/**
 * Sync semua plant yang diizinkan (saat ini hanya PP2/2). Satu plant gagal
 * tidak mengubah data plant tersebut, dan tidak menghentikan plant lain.
 */
export async function syncAllPlants(deps: SyncDeps): Promise<SyncSummary> {
  const startedAt = Date.now();
  const verification = await ensurePlantVerification(deps);
  if (!verification.verified) {
    throw new SnfIntegrationError(
      'PLANT_NOT_VERIFIED',
      `Sync dihentikan: verifikasi plant SNF gagal. ${verification.reason ?? ''}`.trim()
    );
  }

  const runtime = runtimeConfig(deps);
  const plants: PlantSyncResult[] = [];

  for (const plantId of runtime.allowedPlantIds) {
    try {
      plants.push(await syncPlant(plantId, deps));
    } catch (error) {
      const described = describeSnfError(error);
      deps.logger?.error?.(`NPOF sync plant ${plantId} gagal: ${described.message}`);
      plants.push({
        plantId,
        created: 0,
        updated: 0,
        deactivated: 0,
        skipped: 0,
        durationMs: 0,
        error: described.message,
      });
    }
  }

  const totals = plants.reduce(
    (acc, plant) => ({
      created: acc.created + plant.created,
      updated: acc.updated + plant.updated,
      deactivated: acc.deactivated + plant.deactivated,
      skipped: acc.skipped + plant.skipped,
      durationMs: acc.durationMs + plant.durationMs,
    }),
    { created: 0, updated: 0, deactivated: 0, skipped: 0, durationMs: 0 }
  );
  totals.durationMs = Date.now() - startedAt;

  const failed = plants.filter((plant) => plant.error).length;
  const status: SyncSummary['status'] =
    failed === 0 ? 'success' : failed === plants.length ? 'failed' : 'partial';

  return { status, plants, totals };
}

/** Cegah dua sync berjalan bersamaan (bisa saling men-deactivate). */
export async function runExclusiveSync(deps: SyncDeps): Promise<SyncSummary> {
  if (activeSync) {
    throw new SnfIntegrationError('SYNC_IN_PROGRESS', 'Sync NPOF sedang berjalan');
  }
  activeSync = syncAllPlants(deps).finally(() => {
    activeSync = null;
  });
  return activeSync;
}

export function isSyncRunning(): boolean {
  return activeSync !== null;
}

/** Untuk pengujian: reset state modul. */
export function resetSyncStateForTests(): void {
  verificationState = {
    verified: false,
    pp2Id: null,
    checkedAt: null,
    reason: 'belum diverifikasi',
  };
  verificationInFlight = null;
  activeSync = null;
}
