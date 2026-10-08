/**
 * Komponen tampilan kolom referensi customer ("Ref-B").
 *
 * Nilainya berasal dari kolom Excel `PR Ref-B` (Outstanding PO) atau
 * `Ref_B_PO` (Stock Raw Material), dan disimpan ke satu field seragam `refB`.
 * Hanya baris yang nilainya mengandung "MTL" yang masuk ke sistem.
 */

/**
 * Cermin dari `matchesMtl()` di API (`apps/api/src/lib/excelRef.ts`).
 * Dipakai untuk validasi cepat di form supaya user tidak menunggu round-trip:
 * mengandung "MTL" (bukan sama persis), tidak case-sensitive, spasi diabaikan.
 */
export function matchesMtl(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  const text = String(value).trim();
  if (!text || text.toUpperCase() === 'NAN') return false;
  return text.toUpperCase().includes('MTL');
}

/** Pesan error yang seragam untuk form manual (Add / Edit). */
export const REF_B_MTL_MESSAGE = 'Kolom Ref-B wajib diisi dan harus mengandung "MTL".';

/** Referensi customer pada baris grup (maks 2 badge, sisanya "+N lagi"). */
export function RefBSummary({ refs }: { refs: string[] }) {
  if (refs.length === 0) return <span className="text-muted-foreground text-xs">—</span>;
  const shown = refs.slice(0, 2);
  return (
    <div className="flex flex-wrap gap-1 max-w-[220px]" title={refs.join(', ')}>
      {shown.map((r) => (
        <span
          key={r}
          className="font-mono text-[11px] bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 px-1.5 py-0.5 rounded whitespace-nowrap"
        >
          {r}
        </span>
      ))}
      {refs.length > shown.length && (
        <span className="text-[11px] font-semibold text-muted-foreground self-center">
          +{refs.length - shown.length} lagi
        </span>
      )}
    </div>
  );
}

/** Nilai Ref-B satu baris. */
export function RefBValue({ value }: { value?: string | null }) {
  const v = (value || '').trim();
  if (!v) return <span className="text-muted-foreground text-xs">—</span>;
  return <span className="font-mono text-[11px] text-emerald-700 dark:text-emerald-400">{v}</span>;
}
