import { describe, expect, it } from 'vitest';
import {
  attachNpofTitles,
  billableUps,
  buildNpofTitleForRev,
  buildPartNumberKey,
  cleanNpofText,
  EMPTY_PART_NUMBER_KEY_PREFIX,
  normalizeEffectiveSpec,
  normalizeMainRow,
  normalizePartNumber,
  normalizeScenario,
  parseSheetedSize,
  resolveRowPlantId,
  resolveUps,
  sumUpsForScenario,
} from './npofNormalize';

describe('normalizePartNumber', () => {
  it('merapikan spasi, tab, newline, dan huruf besar', () => {
    expect(normalizePartNumber('  jkg66-0910 ')).toBe('JKG66-0910');
    expect(normalizePartNumber('JKG66\t-0910')).toBe('JKG66 -0910');
    expect(normalizePartNumber('JKG66\n-0910')).toBe('JKG66 -0910');
    expect(normalizePartNumber('  jkg66   0910 ')).toBe('JKG66 0910');
  });

  it('memberi kunci sentinel untuk part number kosong', () => {
    expect(buildPartNumberKey('', 130)).toBe(`${EMPTY_PART_NUMBER_KEY_PREFIX}#130`);
    expect(buildPartNumberKey('-', 130)).toBe(`${EMPTY_PART_NUMBER_KEY_PREFIX}#130`);
    expect(buildPartNumberKey('jkg66-0910', 130)).toBe('JKG66-0910');
  });
});

describe('cleanNpofText', () => {
  it('menganggap "", "-", "N/A" sebagai null', () => {
    expect(cleanNpofText('')).toBeNull();
    expect(cleanNpofText('  - ')).toBeNull();
    expect(cleanNpofText('N/A')).toBeNull();
    expect(cleanNpofText(null)).toBeNull();
  });

  it('membersihkan NBSP, tab, dan newline ganda', () => {
    expect(cleanNpofText('Hongkong\u00A0Paper\tInternational\n\nCo')).toBe(
      'Hongkong Paper International Co'
    );
  });
});

describe('parseSheetedSize', () => {
  it('mem-parse ukuran standar', () => {
    const result = parseSheetedSize('48 x 60 cm');
    expect(result.lengthCm).toBe(48);
    expect(result.widthCm).toBe(60);
    expect(result.display).toBe('48 × 60 CM');
    expect(result.note).toBeNull();
  });

  it('mendukung koma desimal', () => {
    const result = parseSheetedSize('73,5 × 57,5 CM');
    expect(result.lengthCm).toBe(73.5);
    expect(result.widthCm).toBe(57.5);
    expect(result.display).toBe('73.5 × 57.5 CM');
  });

  it('memisahkan suffix (LG) dan NEBENG DI dari ukuran', () => {
    const lg = parseSheetedSize('48 x 60 (LG)');
    expect(lg.display).toBe('48 × 60 CM');
    expect(lg.note).toBe('LG');

    const nebeng = parseSheetedSize('48 x 60 NEBENG DI jkg66-0930');
    expect(nebeng.display).toBe('48 × 60 CM');
    expect(nebeng.note).toBe('NEBENG DI JKG66-0930');
  });

  it('membersihkan superscript footnote', () => {
    const result = parseSheetedSize('73.5ˣ 57.5ˣ');
    expect(result.lengthCm).toBe(73.5);
    expect(result.widthCm).toBe(57.5);
  });

  it('mempertahankan teks yang tidak bisa diparse sebagai display', () => {
    const result = parseSheetedSize('180cm (jumbo roll)');
    expect(result.lengthCm).toBeNull();
    expect(result.display).toBe('180cm (jumbo roll)');
  });
});

describe('UPS dan ups_counted', () => {
  it('memakai ups_combined dan fallback ke ups_original hanya saat dihitung', () => {
    expect(
      resolveUps({ is_approved: true, ups_counted: true, ups_original: 3, ups_combined: 5 })
    ).toMatchObject({ display: '5', upsCombined: 5, upsCounted: true });

    expect(
      resolveUps({ is_approved: true, ups_counted: true, ups_original: 3, ups_combined: null })
    ).toMatchObject({ display: '3', upsCombined: null, upsCounted: true });
  });

  it('baris belum approved / ups_counted=false tidak punya UPS terhitung', () => {
    expect(
      resolveUps({ is_approved: false, ups_counted: false, ups_original: 2, ups_combined: null })
    ).toMatchObject({ display: null, upsCombined: null, upsCounted: false });

    // is_approved=false menang walaupun ups_counted keliru true.
    expect(
      resolveUps({ is_approved: false, ups_counted: true, ups_original: 2, ups_combined: 2 })
    ).toMatchObject({ display: null, upsCombined: null, upsCounted: false });
  });

  it('mengecualikan baris removed dan tanpa part number dari total', () => {
    expect(
      billableUps({
        partNumber: 'JKG66-0910',
        ups_counted: true,
        is_approved: true,
        ups_combined: 5,
        removedInLatestRev: false,
      })
    ).toBe(5);
    expect(
      billableUps({
        partNumber: 'JKG66-0910',
        ups_counted: true,
        is_approved: true,
        ups_combined: 5,
        removedInLatestRev: true,
      })
    ).toBe(0);
    expect(
      billableUps({
        partNumber: '',
        ups_counted: true,
        is_approved: true,
        ups_combined: 5,
        removedInLatestRev: false,
      })
    ).toBe(0);
  });

  it('tidak menjumlahkan scenario main dan alt maupun baris yang tidak dihitung', () => {
    const rows = [
      {
        scenario: 'main',
        partNumber: 'A',
        removedInLatestRev: false,
        upsCounted: true,
        upsCombined: 4,
        upsOriginal: 1,
        ups: '4',
      },
      {
        scenario: 'alt',
        partNumber: 'A',
        removedInLatestRev: false,
        upsCounted: true,
        upsCombined: 2,
        upsOriginal: 1,
        ups: '2',
      },
      {
        scenario: 'main',
        partNumber: 'B',
        removedInLatestRev: false,
        upsCounted: false,
        upsCombined: null,
        upsOriginal: 3,
        ups: null,
      },
    ];
    expect(sumUpsForScenario(rows, 'main')).toBe(4);
    expect(sumUpsForScenario(rows, 'alt')).toBe(2);
  });
});

describe('effective_spec', () => {
  it('mengambil seluruh kolom spec dari effective_spec', () => {
    const spec = normalizeEffectiveSpec({
      material: 'Paper',
      gramatur: '450 g/m²',
      supplier: 'Hongkong Paper',
      sheeted_size: '48 x 60 CM',
      formula_material: '0.25 kg/sheet',
    });

    expect(spec).toMatchObject({
      material: 'Paper',
      gramatur: '450 g/m²',
      supplier: 'Hongkong Paper',
      sheetedSize: '48 × 60 CM',
      lengthCm: 48,
      widthCm: 60,
      formulaMaterial: '0.25 kg/sheet',
      specAvailable: true,
    });
  });

  it('effective_spec null -> specAvailable false dan semua kolom null', () => {
    const spec = normalizeEffectiveSpec(null);
    expect(spec.specAvailable).toBe(false);
    expect(spec.material).toBeNull();
    expect(spec.gramatur).toBeNull();
    expect(spec.supplier).toBeNull();
    expect(spec.sheetedSize).toBeNull();
    expect(spec.formulaMaterial).toBeNull();
  });
});

describe('normalizeMainRow', () => {
  it('tidak memakai part_name sebagai part number dan tidak memakai judul NPOF sebagai product name', () => {
    const row = normalizeMainRow({
      part_number: '',
      part_name: 'RTN LID FRONT 21A',
      npof_title: 'NPOF - BRB MUSIC SERIES - JKG66-9993',
      product_name: 'BRB MUSIC SERIES PROJECT HEARTH',
      selected_npof_id: 130,
      scenario: 'main',
      status_label: 'Draft',
      is_approved: false,
      ups_counted: false,
      ups_original: 3,
      ups_combined: null,
      selected_rev: 'Rev B',
    });

    expect(row.partNumber).toBe('');
    expect(row.productName).toBe('BRB MUSIC SERIES PROJECT HEARTH');
    expect(row.npofTitle).toContain('NPOF - BRB');
    expect(row.statusLabel).toBe('Draft');
    expect(row.isApproved).toBe(false);
    expect(row.upsCounted).toBe(false);
    expect(row.ups).toBeNull();
    expect(row.selectedRev).toBe('Rev B');
  });

  it('menyimpan status, spec_source parent, dan raw spec', () => {
    const row = normalizeMainRow({
      part_number: ' ABC ',
      part_name: '1234',
      product_name: 'Produk',
      scenario: 'MAIN',
      status_label: 'Waiting for Approval',
      is_approved: false,
      ups_counted: false,
      ups_original: 2,
      ups_combined: null,
      gang_print_parent: 'ABC',
      spec_source: 'parent',
      spec: { gramatur: '450', formula_material: null },
      effective_spec: {
        material: 'Paper',
        gramatur: '450',
        supplier: 'Hongkong Paper',
        sheeted_size: '55 x 45 CM',
        formula_material: '0.111375 kg/sheet',
      },
    });

    expect(row.partNumber).toBe('ABC');
    expect(row.partNumberNorm).toBe('ABC');
    expect(row.scenario).toBe('main');
    expect(row.statusLabel).toBe('Waiting for Approval');
    expect(row.specSource).toBe('parent');
    expect(row.rawSpec).toEqual({ gramatur: '450', formula_material: null });
    expect(row.spec.formulaMaterial).toBe('0.111375 kg/sheet');
    expect(row.ups).toBeNull();
  });

  it('menormalkan scenario tak dikenal menjadi lowercase', () => {
    expect(normalizeScenario(' MAIN ')).toBe('main');
    expect(normalizeScenario('Alt')).toBe('alt');
    expect(normalizeScenario(null)).toBe('main');
  });
});

describe('buildNpofTitleForRev', () => {
  it('mengganti label revisi di depan judul', () => {
    expect(
      buildNpofTitleForRev(
        'IR - JRP25-35-50-37-38-JA10 - HXD63-978B',
        'IR',
        'Rev A'
      )
    ).toBe('Rev A - JRP25-35-50-37-38-JA10 - HXD63-978B');
  });

  it('memakai prefix "NPOF" bila revisi baris kosong', () => {
    expect(buildNpofTitleForRev('NPOF - MJ - CTXD', null, 'Rev B')).toBe('Rev B - MJ - CTXD');
  });

  it('mengembalikan judul apa adanya bila revisi sama/kosong', () => {
    expect(buildNpofTitleForRev('IR - ABC - XYZ', 'IR', 'IR')).toBe('IR - ABC - XYZ');
    expect(buildNpofTitleForRev('IR - ABC - XYZ', 'IR', '')).toBe('IR - ABC - XYZ');
    expect(buildNpofTitleForRev('IR - ABC - XYZ', 'IR', null)).toBe('IR - ABC - XYZ');
  });

  it('tidak menebak bila format judul tidak dikenal', () => {
    expect(buildNpofTitleForRev('NPOF - 4CT Blouse - 051 00 9874', 'IR', 'Rev A')).toBe(
      'NPOF - 4CT Blouse - 051 00 9874'
    );
    expect(buildNpofTitleForRev(null, 'IR', 'Rev A')).toBeNull();
    expect(buildNpofTitleForRev('  -  ', 'IR', 'Rev A')).toBeNull();
  });
});

describe('attachNpofTitles', () => {
  it('menambahkan npof_title ke source_npofs tanpa judul', () => {
    const result = attachNpofTitles(
      [
        { npof_id: 384, rev: 'Rev A' },
        { npof_id: 383, rev: 'IR' },
      ],
      'IR - JRP25-35-50-37-38-JA10 - HXD63-978B',
      'IR'
    ) as Array<Record<string, unknown>>;

    expect(result[0].npof_title).toBe('Rev A - JRP25-35-50-37-38-JA10 - HXD63-978B');
    expect(result[1].npof_title).toBe('IR - JRP25-35-50-37-38-JA10 - HXD63-978B');
    expect(result[0].npof_id).toBe(384);
  });

  it('mempertahankan judul dari SNF dan mengabaikan nilai bukan array', () => {
    const result = attachNpofTitles(
      [{ npof_id: 7, npof_title: 'Judul dari SNF' }],
      'IR - ABC',
      'IR'
    ) as Array<Record<string, unknown>>;

    expect(result[0].npof_title).toBe('Judul dari SNF');
    expect(attachNpofTitles(null, 'IR - ABC', 'IR')).toBeNull();
  });
});

describe('resolveRowPlantId', () => {
  it('menerima baris tanpa plant_id dengan plant pemanggil', () => {
    expect(resolveRowPlantId(undefined, 2, [2])).toEqual({ plantId: 2, reason: null });
  });

  it('menolak baris plant lain', () => {
    const result = resolveRowPlantId(1, 2, [2]);
    expect(result.plantId).toBeNull();
    expect(result.reason).toContain('tidak sama');
  });

  it('menolak plant yang tidak ada di daftar izin', () => {
    const result = resolveRowPlantId(3, 3, [2]);
    expect(result.plantId).toBeNull();
    expect(result.reason).toContain('SNF_ALLOWED_PLANT_IDS');
  });
});
