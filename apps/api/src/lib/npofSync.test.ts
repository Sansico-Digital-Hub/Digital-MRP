import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildPlantRows,
  resetSyncStateForTests,
  SnfIntegrationError,
  syncAllPlants,
  syncPlant,
  verifySnfPlants,
  type FetchLike,
  type NpofPrisma,
  type NpofPrismaTx,
  type SyncDeps,
} from './npofSync';
import type { SnfMainRow } from './npofNormalize';

interface FakeRow {
  id: string;
  plantId: number;
  partNumber: string;
  partNumberNorm: string;
  scenario: string;
  isActive: boolean;
  upsCombined: number | null;
  upsCounted: boolean;
  statusLabel: string | null;
}

function createFakePrisma(initial: FakeRow[] = []) {
  const rows: FakeRow[] = [...initial];
  let sequence = 0;

  const npofMaterial = {
    findMany: async (args?: any) => {
      const plantId = args?.where?.plantId;
      return rows
        .filter((row) => plantId === undefined || row.plantId === plantId)
        .map((row) => ({ ...row }));
    },
    create: async (args: any) => {
      const row: FakeRow = {
        id: `created-${++sequence}`,
        plantId: args.data.plantId,
        partNumber: args.data.partNumber,
        partNumberNorm: args.data.partNumberNorm,
        scenario: args.data.scenario,
        isActive: true,
        upsCombined: args.data.upsCombined ?? null,
        upsCounted: Boolean(args.data.upsCounted),
        statusLabel: args.data.statusLabel ?? null,
      };
      rows.push(row);
      return row;
    },
    update: async (args: any) => {
      const row = rows.find((candidate) => candidate.id === args.where.id);
      if (row) Object.assign(row, args.data);
      return row;
    },
    updateMany: async (args: any) => {
      const notIn: string[] = args?.where?.id?.notIn ?? [];
      let count = 0;
      for (const row of rows) {
        if (row.plantId !== args.where.plantId) continue;
        if (!row.isActive) continue;
        if (notIn.length > 0 && notIn.includes(row.id)) continue;
        row.isActive = false;
        count++;
      }
      return { count };
    },
  };

  const prisma: NpofPrisma = {
    npofMaterial,
    $transaction: async (work: (tx: NpofPrismaTx) => Promise<unknown>) => work({ npofMaterial }),
  };

  return { prisma, rows };
}

const testConfig = {
  baseUrl: 'http://snf.test',
  apiKey: 'test-key',
  allowedPlantIds: [2],
  requestTimeoutMs: 1000,
  syncRetryAttempts: 1,
  syncRetryBackoffMs: 0,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function depsWithFetch(
  prisma: NpofPrisma,
  fetchImpl: FetchLike,
  config = testConfig
): SyncDeps {
  return {
    prisma,
    fetchImpl,
    config,
    runTransaction: (work) => work(prisma),
    logger: { warn: () => {}, error: () => {}, info: () => {} },
  };
}

function materialsFetch(main: SnfMainRow[]) {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const impl: FetchLike = async (url, init) => {
    calls.push({ url, headers: (init.headers ?? {}) as Record<string, string> });
    if (url.includes('/npof/integration/materials')) {
      return jsonResponse({ status: 'success', total: main.length, data: main });
    }
    if (url.includes('/plants/public')) {
      return jsonResponse({ status: 'success', data: [{ id: 2, code: 'PP2' }] });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
  return { impl, calls };
}

const mainRows: SnfMainRow[] = [
  {
    part_number: 'JKG66-0910',
    part_name: 'RTN LID FRONT 21A',
    npof_title: 'NPOF - BRB MUSIC SERIES PROJECT HEARTH - JKG66-9993',
    product_name: 'BRB MUSIC SERIES PROJECT HEARTH',
    scenario: 'MAIN',
    status_label: 'Completed',
    is_approved: true,
    ups_counted: true,
    selected_npof_id: 130,
    selected_rev: 'Rev B',
    ups_original: 3,
    ups_combined: 5,
    spec_source: 'own',
    effective_spec: {
      material: 'Paper',
      gramatur: '450 g/m²',
      supplier: 'Hongkong Paper',
      sheeted_size: '48 x 60 CM',
      formula_material: '0.25 kg/sheet',
    },
    spec: {
      material: 'Paper',
      gramatur: '450 g/m²',
      supplier: 'Hongkong Paper',
      sheeted_size: '48 x 60 CM',
      formula_material: '0.25 kg/sheet',
    },
    group_members: [{ part_number: 'JKG66-0910', ups_used: 3, is_parent: true }],
  },
  {
    part_number: 'JKG66-0930',
    part_name: 'RTN LID BACK 21A',
    product_name: 'BRB MUSIC SERIES PROJECT HEARTH',
    scenario: 'MAIN',
    status_label: 'Draft',
    is_approved: false,
    ups_counted: false,
    selected_npof_id: 131,
    selected_rev: 'Rev A',
    ups_original: 2,
    ups_combined: null,
    spec_source: 'none',
    effective_spec: null,
  },
];

beforeEach(() => {
  resetSyncStateForTests();
});

describe('buildPlantRows', () => {
  it('mendukung scenario main dan alt sebagai baris terpisah', () => {
    const { rows } = buildPlantRows(
      [...mainRows, { ...mainRows[0], scenario: 'alt', ups_original: 1, ups_combined: 1 }],
      2,
      [2]
    );

    expect(rows.filter((row) => row.partNumberNorm === 'JKG66-0910')).toHaveLength(2);
    expect(rows.map((row) => row.scenario).sort()).toEqual(['alt', 'main', 'main']);
  });

  it('mendedup baris dengan kunci sama dan memilih revisi terbaru', () => {
    const { rows, skipped } = buildPlantRows(
      [
        { ...mainRows[0], selected_rev: 'Rev A', ups_combined: 1 },
        { ...mainRows[0], selected_rev: 'Rev C', ups_combined: 5 },
      ],
      2,
      [2]
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].selectedRev).toBe('Rev C');
    expect(rows[0].upsCombined).toBe(5);
    expect(skipped).toBe(1);
  });

  it('baris approved menang atas revisi draft yang lebih baru', () => {
    const { rows } = buildPlantRows(
      [
        { ...mainRows[0], selected_npof_id: 78, selected_rev: '', is_approved: true, ups_counted: true, ups_combined: 5 },
        {
          ...mainRows[0],
          selected_npof_id: 128,
          selected_rev: 'IR',
          status_label: 'Waiting for Approval',
          is_approved: false,
          ups_counted: false,
          ups_combined: null,
        },
      ],
      2,
      [2]
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].isApproved).toBe(true);
    expect(rows[0].upsCombined).toBe(5);
    // Baris draft yang kalah tetap terlihat sebagai badge revisi pending.
    expect(rows[0].newerRevPendingApproval).toBe(true);
  });

  it('menolak baris milik plant lain sebelum upsert', () => {
    const { rows, skipped } = buildPlantRows(
      [{ ...mainRows[0], plant_id: 1 }],
      2,
      [2]
    );

    expect(rows).toHaveLength(0);
    expect(skipped).toBe(1);
  });
});

describe('syncPlant', () => {
  it('idempotent: sync kedua tidak menambah baris/duplikat', async () => {
    const { prisma, rows } = createFakePrisma();
    const fetch = materialsFetch(mainRows);

    const firstResult = await syncPlant(2, depsWithFetch(prisma, fetch.impl));
    expect(firstResult).toMatchObject({ created: 2, updated: 0, deactivated: 0 });
    expect(rows).toHaveLength(2);

    const secondResult = await syncPlant(2, depsWithFetch(prisma, fetch.impl));
    expect(secondResult).toMatchObject({ created: 0, updated: 2, deactivated: 0 });
    expect(rows).toHaveLength(2);

    // Hanya endpoint utama yang dipanggil; semua request membawa plant_id.
    expect(fetch.calls).toHaveLength(2);
    for (const call of fetch.calls) {
      expect(call.url).toContain('/npof/integration/materials?plant_id=2');
      expect(call.headers['X-API-Key']).toBe('test-key');
    }
  });

  it('menyimpan status dan ups_counted; baris draft tidak punya UPS', async () => {
    const { prisma, rows } = createFakePrisma();
    const fetch = materialsFetch(mainRows);
    await syncPlant(2, depsWithFetch(prisma, fetch.impl));

    const approved = rows.find((row) => row.partNumberNorm === 'JKG66-0910');
    expect(approved).toMatchObject({ upsCounted: true, upsCombined: 5, statusLabel: 'Completed' });

    const draft = rows.find((row) => row.partNumberNorm === 'JKG66-0930');
    expect(draft).toMatchObject({ upsCounted: false, upsCombined: null, statusLabel: 'Draft' });
  });

  it('men-deactivate baris plant itu yang hilang dari respons (soft delete)', async () => {
    const { prisma, rows } = createFakePrisma([
      {
        id: 'old-1',
        plantId: 2,
        partNumber: 'OLD-PART',
        partNumberNorm: 'OLD-PART',
        scenario: 'main',
        isActive: true,
        upsCombined: 1,
        upsCounted: true,
        statusLabel: 'Completed',
      },
      {
        id: 'other-plant',
        plantId: 1,
        partNumber: 'OTHER',
        partNumberNorm: 'OTHER',
        scenario: 'main',
        isActive: true,
        upsCombined: 1,
        upsCounted: true,
        statusLabel: 'Completed',
      },
    ]);

    const fetch = materialsFetch([mainRows[0]]);
    const result = await syncPlant(2, depsWithFetch(prisma, fetch.impl));

    expect(result.deactivated).toBe(1);
    expect(rows.find((row) => row.id === 'old-1')?.isActive).toBe(false);
    // Plant lain tidak boleh ikut ter-deactivate.
    expect(rows.find((row) => row.id === 'other-plant')?.isActive).toBe(true);
  });

  it('403 Invalid API Key tidak menulis apa pun', async () => {
    const { prisma, rows } = createFakePrisma([
      {
        id: 'keep',
        plantId: 2,
        partNumber: 'KEEP',
        partNumberNorm: 'KEEP',
        scenario: 'main',
        isActive: true,
        upsCombined: 1,
        upsCounted: true,
        statusLabel: 'Completed',
      },
    ]);

    const fetchImpl: FetchLike = async () => jsonResponse({ detail: 'Invalid API Key' }, 403);

    await expect(syncPlant(2, depsWithFetch(prisma, fetchImpl))).rejects.toMatchObject({
      code: 'INVALID_API_KEY',
    });
    expect(rows[0].isActive).toBe(true);
  });

  it('503 "Integration API key is not configured" dipetakan ke API_KEY_MISSING', async () => {
    const { prisma } = createFakePrisma();
    const fetchImpl: FetchLike = async () =>
      jsonResponse({ detail: 'Integration API key is not configured' }, 503);

    await expect(syncPlant(2, depsWithFetch(prisma, fetchImpl))).rejects.toMatchObject({
      code: 'API_KEY_MISSING',
    });
  });

  it('timeout dipetakan ke TIMEOUT', async () => {
    const { prisma } = createFakePrisma();
    const fetchImpl: FetchLike = async () => {
      throw Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
    };

    await expect(syncPlant(2, depsWithFetch(prisma, fetchImpl))).rejects.toMatchObject({
      code: 'TIMEOUT',
    });
  });

  it('respons yang seluruhnya milik plant lain tidak men-deactivate data lama', async () => {
    const { prisma, rows } = createFakePrisma([
      {
        id: 'keep',
        plantId: 2,
        partNumber: 'KEEP',
        partNumberNorm: 'KEEP',
        scenario: 'main',
        isActive: true,
        upsCombined: 1,
        upsCounted: true,
        statusLabel: 'Completed',
      },
    ]);

    const fetch = materialsFetch([{ ...mainRows[0], plant_id: 1 }]);

    await expect(syncPlant(2, depsWithFetch(prisma, fetch.impl))).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
    expect(rows[0].isActive).toBe(true);
  });

  it('JSON invalid tidak mengubah data lama', async () => {
    const { prisma, rows } = createFakePrisma([
      {
        id: 'keep',
        plantId: 2,
        partNumber: 'KEEP',
        partNumberNorm: 'KEEP',
        scenario: 'main',
        isActive: true,
        upsCombined: 1,
        upsCounted: true,
        statusLabel: 'Completed',
      },
    ]);

    const fetchImpl: FetchLike = async () =>
      new Response('bukan json', { status: 200, headers: { 'content-type': 'text/plain' } });

    await expect(syncPlant(2, depsWithFetch(prisma, fetchImpl))).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
    expect(rows[0].isActive).toBe(true);
  });
});

describe('verifySnfPlants', () => {
  it('lolos bila PP2 cocok dengan daftar plant yang diizinkan', async () => {
    const { prisma } = createFakePrisma();
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    const fetchImpl: FetchLike = async (url, init) => {
      calls.push({ url, headers: (init.headers ?? {}) as Record<string, string> });
      return jsonResponse({ status: 'success', data: [{ id: 2, code: 'PP2' }] });
    };

    const state = await verifySnfPlants(depsWithFetch(prisma, fetchImpl));

    expect(state.verified).toBe(true);
    expect(calls[0].url).toContain('/plants/public');
    expect(calls[0].headers['X-API-Key']).toBeUndefined();
  });

  it('menghentikan sync bila id PP2 tidak ada di daftar izin', async () => {
    const { prisma } = createFakePrisma();
    const fetchImpl: FetchLike = async () =>
      jsonResponse({ status: 'success', data: [{ id: 9, code: 'PP2' }] });

    const state = await verifySnfPlants(depsWithFetch(prisma, fetchImpl));
    expect(state.verified).toBe(false);
    expect(state.reason).toContain('SNF_ALLOWED_PLANT_IDS');

    await expect(syncAllPlants(depsWithFetch(prisma, fetchImpl))).rejects.toBeInstanceOf(
      SnfIntegrationError
    );
  });
});
