/**
 * Logika murni Printing Planning: kekurangan stok dari MRP, kelayakan mesin
 * dari master layout (list2026), rekomendasi, dan jadwal. Dipakai API dan
 * browser (jadwal live saat planner mengedit), jadi JANGAN import Node/DB di sini.
 *
 * Diport dari Production-Planning `src/planning.js` (perilaku identik, tes ikut
 * diport di `planning.test.ts`).
 */
import {
  HOURS_PER_DAY,
  SETUP_HOURS,
  planningMachine,
  withCapacity,
  type CapacityMap,
  type PlanningMachine,
  type PrintingMachineSpec,
  type Size,
} from './machines';

// Waktu plan = string jam dinding WIB tanpa zona (2026-10-05T07:00), diolah sebagai UTC
// supaya jam pabrik tidak pernah bergeser mengikuti zona waktu server atau browser.
const toMs = (iso: string) =>
  Date.parse(iso.length <= 10 ? `${iso}T00:00:00Z` : `${iso.slice(0, 16)}:00Z`);
const toIso = (ms: number) => new Date(ms).toISOString().slice(0, 16);
/** Serial tanggal Excel → ISO jam dinding. Workbook bersistem tanggal 1904 mulai 1462 hari kemudian. */
export const excelSerialToIso = (serial: number, date1904 = false) =>
  toIso(Math.round(((serial + (date1904 ? 1462 : 0) - 25569) * 864e5) / 60000) * 60000);
/** Date → jam dinding WIB (UTC+7), mis. untuk "sekarang" sebagai awal plan. */
export const wibIso = (ms: number) => toIso(ms + 7 * 36e5);
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const pad = (n: number) => String(n).padStart(2, '0');
export function formatDay(iso: string) {
  const d = new Date(toMs(iso));
  return `${DAYS[d.getUTCDay()]} ${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}`;
}
export function formatDateTime(iso: string) {
  const d = new Date(toMs(iso));
  return `${formatDay(iso)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
export const normalizeCode = (code: unknown) =>
  String(code ?? '')
    .toUpperCase()
    .replace(/\s+/g, '');
const roundUp1 = (n: number) => Math.ceil(n * 10 - 1e-9) / 10;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

// ---------- Demand (Plan Produksi / MRP) ----------

export interface WeekRequirement {
  week: string;
  qty: number;
}

/**
 * Proyeksi stok per minggu = BI total + WIP − kebutuhan kumulatif (kolom "Total Req" di
 * Plan Produksi). Saldo negatif terdalam = yang masih harus diproduksi, minggu negatif
 * pertama = kapan dibutuhkan. Untuk HRG52-4B32 hasilnya sama dengan "Quantity Requirement"
 * di sheet (5.4 dari WE 10/3).
 */
export function computeShortage(bi: number, wip: number, reqs: WeekRequirement[]) {
  let balance = bi + wip,
    shortage = 0,
    due: string | null = null;
  const balances = reqs.map((r) => {
    balance -= r.qty;
    if (balance < -1e-9) {
      due ??= r.week;
      shortage = Math.max(shortage, -balance);
    }
    return round3(balance);
  });
  return { balances, shortage: round3(shortage), due };
}

// ---------- Layout master (list2026) ----------

/** "81 x 50.5 cm", "62,5 X 75.5 CM", "49*81CM", "96.5cm x 68.5 cm" → [panjang, pendek] cm. */
export function parseSize(text: unknown): Size | null {
  const m = /(\d+(?:[.,]\d+)?)\s*(?:cm)?\s*[xX×*]\s*(\d+(?:[.,]\d+)?)/i.exec(String(text ?? ''));
  if (!m) return null;
  const a = Number(m[1].replace(',', '.')),
    b = Number(m[2].replace(',', '.'));
  if (!(a > 0 && b > 0)) return null;
  return a >= b ? [a, b] : [b, a];
}
/** "4'4" → [4,4], "1*1*1" → [1,1,1], "3/16/3/2" → [3,16,3,2], 12 → [12]. */
export function parseUps(value: unknown): number[] {
  if (typeof value === 'number') return value > 0 ? [value] : [];
  return String(value ?? '')
    .split(/['’`*/,]+/)
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
}
export function parseMachineHints(text: unknown): string[] {
  const t = String(text ?? '').toUpperCase(),
    out = new Set<string>();
  if (t.includes('GENIUS')) out.add('genius');
  for (const m of t.matchAll(/KBA\s*([1-4](?:\s*\/\s*[1-4])*)/g))
    for (const d of m[1].match(/[1-4]/g) ?? []) out.add(`kba${d}`);
  return [...out];
}
/** Token pendek mewarisi prefix token sebelumnya: HLW03/05 → HLW05, JA10/30 → JA30, 4B11/30 → 4B30. */
function inheritPrefix(tokens: string[]) {
  let prev = '';
  return tokens.map((t) => {
    const tail = /\d+$/.exec(prev)?.[0];
    const out =
      /^\d+$/.test(t) && tail && t.length === tail.length ? prev.slice(0, -tail.length) + t : t;
    prev = out;
    return out;
  });
}
const ITEM_BASE = /^[A-Z]{3}\d{2}$/;

export interface ExpandedLayout {
  key: string;
  codes: string[];
  aliases: [string, string][];
  clean: boolean;
  variant: string;
  hints: string[];
}

/**
 * Semua kode item yang dicetak sebuah layout. Pemisahnya "/" dan "_":
 * "HLW47/48-4B10" → HLW47-4B10, HLW48-4B10; "JPL73-JA10/30" → JPL73-JA10, JPL73-JA30;
 * "JLT64-JA10/JLT63-4B40" → kedua kode; "JLX39-MA10G1" juga cocok dengan JLX39-MA10.
 * Teks setelah kode ("KBA 4", "6 ups", "(Alternatif)") menandai varian layout yang sama.
 */
export function expandLayout(raw: unknown): ExpandedLayout {
  const [first = '', ...rest] = String(raw).trim().split(/\s+/),
    key = normalizeCode(first);
  const groups: { left: string[]; right: string[] }[] = [];
  let g: { left: string[]; right: string[] } | null = null;
  for (const token of key.split(/[/_,]/).filter(Boolean)) {
    const dash = token.indexOf('-');
    if (dash > 0) {
      if (!g || g.right.length) groups.push((g = { left: [], right: [] }));
      g.left.push(token.slice(0, dash));
      g.right.push(token.slice(dash + 1));
    } else if (!g || !g.right.length) {
      if (!g) groups.push((g = { left: [], right: [] }));
      g.left.push(token);
    } else if (ITEM_BASE.test(token)) groups.push((g = { left: [token], right: [] }));
    else g.right.push(token);
  }
  // Kode sesuai urutan tulis, jadi UP ke-n milik kode ke-n (JPL14/16/17/18-MA10 + 2'1'1'1).
  const codes: string[] = [],
    aliases: [string, string][] = [];
  let clean = true;
  for (const { left, right } of groups) {
    if (!right.length) continue;
    const ls = inheritPrefix(left),
      rs = inheritPrefix(right);
    if (ls.length > 1 && rs.length > 1) clean = false;
    for (const l of ls)
      for (const r of rs) {
        const code = `${l}-${r}`;
        if (codes.includes(code)) continue;
        codes.push(code);
        // JLX39-MA10G1 juga mencetak JLX39-MA10; alias memakai UP kodenya sendiri.
        const v = /^(.*\d)G\d+$/.exec(code);
        if (v) aliases.push([v[1], code]);
      }
  }
  return {
    key,
    codes: codes.length ? codes : [key],
    aliases,
    clean,
    variant: rest.join(' '),
    hints: parseMachineHints(rest.join(' ')),
  };
}

const FINISH =
  /\b(COATING|WATER\s*BASE[D]?|W\/B|WB|SPOT\s*UV|SPOT|UV|BLISTER|BISTER|BLISTR|MATTE?|SATIN|GLOSS|OPP|PRIMER|VARNISH|UFP|LAMINA\w*|FMO|ISO|DRI?F+\s*OFF|DOFF|PRINT|ZETIAN|PP\d?)\b/g;
const PROCESS_WORDS = /\b(BLACK|CYAN|MAGENTA|YELLOW)\b/g;
const COLOUR_WORDS =
  /\b(WHITE|GOLD|SILVER|GREY|GRAY|BLUE|ORANGE|PINK|GREEN|RED|BROWN|PURPLE|VIOLET|METAL+IC|NAVY|CREAM|TARGET|REF)\b/;
const PANTONE = /\bP(?:ANTONE)?\.?\s*\d{2,5}(?:\s*C\b)?/g;

export interface InkProfile {
  inks: number | null;
  special: boolean;
  confident: boolean;
}

/**
 * Jumlah tinta dari teks warna. Kolom COLOR angka sering kurang diisi (4 untuk
 * "CRYK+P224"), jadi hasil parsing menang kalau lebih besar. Finishing seperti coating,
 * W/B, spot UV, blister, dan FMO bukan tinta.
 */
export function inkProfile(text: unknown, colorColumn?: number | null): InkProfile {
  let t = ` ${String(text ?? '').toUpperCase()} `;
  if (!t.trim()) return { inks: colorColumn ?? null, special: false, confident: false };
  let process = 0,
    special = 0,
    confident = true;
  if (/C\s*[MR]\s*Y\s*K/.test(t)) {
    process = 4;
    t = t.replace(/C\s*[MR]\s*Y\s*K/g, ' ');
  } else if (/\bCYK\b/.test(t)) {
    process = 3;
    t = t.replace(/\bCYK\b/g, ' ');
  }
  special += (t.match(PANTONE) ?? []).length;
  t = t
    .replace(PANTONE, ' ')
    .replace(/\bDIC\b/g, ' ')
    .replace(FINISH, ' ');
  for (const segment of t
    .split(/[,+&.;]+/)
    .map((s) => s.trim())
    .filter(Boolean)) {
    const words = segment.match(PROCESS_WORDS)?.length ?? 0;
    process += words;
    const restText = segment.replace(PROCESS_WORDS, ' ').trim();
    if (!restText || /^[\s\-()]*$/.test(restText)) continue;
    if (COLOUR_WORDS.test(restText) || /SPESIAL|SPECIAL/.test(restText)) special += 1;
    else if (/[A-Z]{2,}/.test(restText) && !words) confident = false;
  }
  const parsed = process + special;
  if (!parsed) return { inks: colorColumn ?? null, special: false, confident: false };
  return { inks: Math.max(parsed, colorColumn ?? 0), special: special > 0, confident };
}

/** Satu baris list2026 (kolom mentah). */
export interface LayoutRow {
  layout?: unknown;
  up?: unknown;
  color?: unknown;
  colour?: unknown;
  material?: unknown;
  size?: unknown;
  mesin?: unknown;
}

export interface Layout {
  layout: string;
  key: string;
  codes: { code: string; up: number }[];
  upCertain: boolean;
  hints: string[];
  colors: number | null;
  colourText: string;
  ink: InkProfile;
  material: string;
  sizeText: string;
  size: Size | null;
}

export function buildLayout(row: LayoutRow): Layout | null {
  const layout = String(row.layout ?? '').trim();
  if (!layout) return null;
  const x = expandLayout(layout),
    ups = parseUps(row.up),
    colors = typeof row.color === 'number' ? row.color : Number(row.color) || null;
  const perCode = x.codes.length > 1 && ups.length === x.codes.length;
  // Satu UP berlaku untuk semua kode. Jumlah yang tidak cocok dipetakan berurutan sejauh
  // mungkin. Layout silang (JPD80/81/82-0201/0202) tidak punya urutan pasti, jadi memakai UP
  // terkecil: kelebihan cetak sedikit lebih aman daripada kurang. Keduanya ditandai untuk dicek.
  const upAt = (i: number) =>
    ups.length <= 1 ? (ups[0] ?? 1) : !x.clean ? Math.min(...ups) : (ups[i] ?? ups[0]);
  const codes = x.codes.map((code, i) => ({ code, up: upAt(i) }));
  for (const [alias, code] of x.aliases)
    if (!x.codes.includes(alias))
      codes.push({ code: alias, up: codes.find((c) => c.code === code)!.up });
  const colourText = String(row.colour ?? '').trim();
  return {
    layout,
    key: x.key,
    codes,
    upCertain: x.clean && (perCode || ups.length === 1) && ups.every((u) => u > 0),
    hints: [...new Set([...parseMachineHints(row.mesin), ...x.hints])],
    colors,
    colourText,
    ink: inkProfile(colourText, colors),
    material: String(row.material ?? '').trim(),
    sizeText: String(row.size ?? '').trim(),
    size: parseSize(row.size),
  };
}
/** Layout yang mencetak item ini: kode layout persis atau salah satu kode layout gabungan. */
export function layoutsFor(code: unknown, layouts: Layout[]) {
  const c = normalizeCode(code);
  return layouts.filter((l) => l.key === c || l.codes.some((x) => x.code === c));
}
export const upFor = (layout: Layout, code: unknown) =>
  layout.codes.find((x) => x.code === normalizeCode(code))?.up ?? layout.codes[0]?.up ?? 1;

// ---------- Kelayakan mesin ----------

const dim = (s: Size) => `${s[0]}×${s[1]}`;
export function checkMachine(layout: Layout, machine: PrintingMachineSpec) {
  const reasons: string[] = [],
    warnings: string[] = [],
    { ink, size } = layout;
  if (ink.inks == null) warnings.push('Colour count not recorded');
  else if (ink.inks > machine.colors)
    reasons.push(`${ink.inks} colours, press has ${machine.colors}`);
  if (ink.special && !machine.special) reasons.push('Cannot print special ink');
  if (!size) reasons.push('Sheet size unreadable, check manually');
  else if (size[0] > machine.max[0] || size[1] > machine.max[1])
    reasons.push(`Size ${dim(size)} above max ${dim(machine.max)}`);
  else if (size[0] < machine.min[0] || size[1] < machine.min[1])
    reasons.push(`Size ${dim(size)} below min ${dim(machine.min)}`);
  if (layout.hints.length && !layout.hints.includes(machine.id))
    warnings.push(`list2026 marks ${layout.hints.map((h) => planningMachine(h)?.name).join('/')}`);
  if (ink.special && machine.note) warnings.push(machine.note);
  if (!ink.confident && ink.inks != null) warnings.push('Colour text needs a manual check');
  if (!layout.upCertain) warnings.push('Combined-layout UP needs a manual check');
  return { machine: machine.id, ok: reasons.length === 0, reasons, warnings };
}
/**
 * Ribu lembar yang dicetak: kekurangan (ribu pcs) + spare reject/defect, ÷ UP, dibulatkan
 * ke atas 0.1. HRG52-4B32: 5.412 × 1.10 ÷ 2 up = 2.98 → 3.0.
 */
export const sheetsFor = (shortage: number, up: number, spare = 0) =>
  roundUp1((shortage * (1 + spare)) / Math.max(up, 1));
/** Prioritas per baris yang diatur planner; makin kecil makin dulu di mesinnya. */
export const PRIORITIES: Record<number, string> = { 1: 'High', 2: 'Normal', 3: 'Low' };
export const DEFAULT_PRIORITY = 2;
export const jobHours = (sheets: number, machine: { speed: number; setupHours?: number }) =>
  sheets / machine.speed + (machine.setupHours ?? SETUP_HOURS);

// ---------- Kalender ----------

// Jam Excel: N jam kerja memajukan N/21 hari kalender (jam kerja mesin per hari).
// Dengan kalender (plan sejak Okt 2026) mesin berjalan di jam nyata dan berhenti saat
// istirahat shift, hari libur, dan jendela maintenance; plan lama tetap memakai jam N/21.
const DAY = 864e5;
const clockMs = (hhmm: string) => {
  const [h, m] = String(hhmm).split(':').map(Number);
  return (h * 60 + m) * 60000;
};

export interface Workdays {
  sunday: boolean;
  holidays: boolean;
}
export interface Holiday {
  date: string;
  name: string;
}
export interface ShiftInput {
  name: string;
  start?: string;
  end?: string;
  breakStart?: string;
  breakEnd?: string;
}
export interface MaintenanceWindow {
  machineId: string;
  start: string;
  end: string;
  reason: string;
}
/** Kalender yang disimpan bersama sebuah plan. */
export interface PlanCalendar {
  breaks: { shift: string; start: string; end: string }[];
  dayStart: string;
  workdays: Workdays;
  holidays: Holiday[];
  maintenance: MaintenanceWindow[];
}

interface Closed {
  dayStart: number;
  sunday: boolean;
  holidays: Set<number>;
}
/** Mesin dengan kalender plan (istirahat, maintenance, hari libur) dalam ms. */
export interface ScheduledMachine extends PlanningMachine {
  breaks?: [number, number][];
  downtime?: [number, number][];
  closed?: Closed | null;
}

/**
 * Hari libur (Minggu & tanggal merah yang tidak dicetak plan) berlaku dari jam mulai shift
 * pertama sampai jam yang sama hari berikutnya: Minggu libur = Minggu 07:00 – Senin 07:00,
 * jadi shift malam Sabtu tetap selesai seperti biasa.
 */
const productionDay = (t: number, closed: Closed) => Math.floor((t - closed.dayStart) / DAY);
const isOff = (day: number, closed: Closed) =>
  (closed.sunday && (day + 4) % 7 === 0) || closed.holidays.has(day);
function offUntil(t: number, closed: Closed) {
  let day = productionDay(t, closed);
  if (!isOff(day, closed)) return null;
  while (isOff(day, closed)) day++;
  return day * DAY + closed.dayStart;
}
function nextOff(t: number, closed: Closed) {
  const today = productionDay(t, closed);
  for (let day = today + 1; day <= today + 400; day++)
    if (isOff(day, closed)) return day * DAY + closed.dayStart;
  return Infinity;
}
/** Akhir istirahat/hari libur/maintenance yang memuat t, atau null kalau mesin bisa jalan. */
function blockedUntil(t: number, machine: ScheduledMachine) {
  if (machine.closed) {
    const end = offUntil(t, machine.closed);
    if (end !== null) return end;
  }
  const day = Math.floor(t / DAY) * DAY;
  for (const [from, to] of machine.breaks ?? [])
    for (const d of [day - DAY, day]) {
      const s = d + from,
        e = d + to + (to <= from ? DAY : 0);
      if (t >= s && t < e) return e;
    }
  for (const [s, e] of machine.downtime ?? []) if (t >= s && t < e) return e;
  return null;
}
function nextStop(t: number, machine: ScheduledMachine) {
  const day = Math.floor(t / DAY) * DAY;
  let next = Infinity;
  for (const [from] of machine.breaks ?? [])
    for (const d of [day, day + DAY])
      if (d + from > t) {
        next = Math.min(next, d + from);
        break;
      }
  for (const [s] of machine.downtime ?? []) if (s > t) next = Math.min(next, s);
  if (machine.closed) next = Math.min(next, nextOff(t, machine.closed));
  return next;
}
/** Saat pertama pada/setelah t ketika mesin tidak sedang istirahat atau maintenance. */
const nextWorking = (t: number, machine: ScheduledMachine) => {
  if (!machine?.breaks) return t;
  for (let end; (end = blockedUntil(t, machine)) !== null; ) t = end;
  return t;
};
const advance = (startMs: number, hours: number, machine: ScheduledMachine) => {
  if (!machine?.breaks) return startMs + (hours / (machine?.hoursPerDay || HOURS_PER_DAY)) * DAY;
  let t = nextWorking(startMs, machine),
    left = hours * 36e5;
  for (;;) {
    const stop = nextStop(t, machine);
    if (t + left <= stop) return t + left;
    left -= stop - t;
    t = nextWorking(stop, machine);
  }
};
/**
 * Mulai & selesai job yang ditaruh pada/setelah t. Job berhenti saat istirahat shift tetapi
 * tidak pernah menabrak maintenance: kalau akan menabrak, job mulai setelah maintenance
 * (berhenti di tengah job = setup ulang). Job yang lebih panjang dari semua celah di antara
 * maintenance tetap harus melewati salah satunya.
 */
function place(t: number, hours: number, machine: ScheduledMachine) {
  let start = nextWorking(t, machine),
    end = advance(start, hours, machine);
  for (let i = 0; machine?.downtime && i < 50; i++) {
    const hit = machine.downtime.find(([s]) => s > start && s < end);
    if (!hit) break;
    const later = nextWorking(hit[1], machine),
      laterEnd = advance(later, hours, machine);
    [start, end] = [later, laterEnd];
  }
  return { start, end };
}
const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
/** Durasi istirahat dalam menit ("HH:MM"); istirahat boleh melewati tengah malam. */
export const breakMinutes = (start: string, end: string) =>
  (minutesOf(end) - minutesOf(start) + 1440) % 1440;
/** Jam efektif per hari = 24 jam − semua istirahat shift (3 × 30 menit → 22.5). */
export const effectiveHoursOf = (shifts: ShiftInput[]) =>
  24 -
  shifts.reduce(
    (sum, s) => sum + (s.breakStart && s.breakEnd ? breakMinutes(s.breakStart, s.breakEnd) : 0),
    0,
  ) /
    60;

/** Hari yang dicetak plan. Kalender sebelum pilihan ini ada mencetak setiap hari. */
export const ALL_DAYS: Workdays = { sunday: true, holidays: true };
const dayNumber = (date: string) => Math.floor(Date.parse(`${date}T00:00:00Z`) / DAY);
/**
 * Press settings + kalender sebuah plan: kapasitas per mesin, ditambah istirahat shift,
 * hari libur, dan jendela maintenance kalau plan punya kalender.
 */
export const planMachines = (
  capacity: CapacityMap | null | undefined,
  calendar?: PlanCalendar | null,
): ScheduledMachine[] => {
  const workdays = calendar?.workdays ?? ALL_DAYS;
  const closed: Closed | null =
    calendar && (!workdays.sunday || !workdays.holidays)
      ? {
          dayStart: clockMs(calendar.dayStart ?? '07:00'),
          sunday: !workdays.sunday,
          holidays: new Set(
            workdays.holidays ? [] : (calendar.holidays ?? []).map((h) => dayNumber(h.date)),
          ),
        }
      : null;
  return withCapacity(capacity).map((m) =>
    calendar
      ? {
          ...m,
          breaks: calendar.breaks.map((b): [number, number] => [clockMs(b.start), clockMs(b.end)]),
          downtime: calendar.maintenance
            .filter((x) => x.machineId === m.id)
            .map((x): [number, number] => [toMs(x.start), toMs(x.end)]),
          closed,
        }
      : m,
  );
};
/**
 * Shift, hari libur, dan maintenance dari pengaturan + pilihan plan untuk mencetak di hari
 * Minggu & tanggal merah → kalender yang disimpan plan.
 */
export const plannerCalendar = (
  {
    shifts = [],
    maintenance = [],
    holidays = [],
  }: { shifts?: ShiftInput[]; maintenance?: MaintenanceWindow[]; holidays?: Holiday[] } = {},
  workdays: Workdays = ALL_DAYS,
): PlanCalendar => ({
  breaks: shifts
    .filter((s) => s.breakStart && s.breakEnd)
    .map((s) => ({ shift: s.name, start: s.breakStart!, end: s.breakEnd! })),
  dayStart: shifts[0]?.start ?? '07:00',
  workdays: { sunday: !!workdays.sunday, holidays: !!workdays.holidays },
  holidays: holidays
    .map(({ date, name }) => ({ date, name }))
    .sort((a, b) => a.date.localeCompare(b.date)),
  maintenance: maintenance
    .map(({ machineId, start, end, reason }) => ({ machineId, start, end, reason }))
    .sort((a, b) => a.start.localeCompare(b.start)),
});
/** Ringkasan hari cetak plan, mis. "Sundays off · holidays off (2 listed)". */
export const workdaysLabel = (calendar?: PlanCalendar | null) => {
  if (!calendar) return 'Every day (plan made before the working-day choice)';
  const w = calendar.workdays ?? ALL_DAYS,
    n = calendar.holidays?.length ?? 0;
  return `Sundays ${w.sunday ? 'printed' : 'off'} · holidays ${w.holidays ? 'printed' : 'off'}${
    !w.holidays ? ` (${n} listed)` : ''
  }`;
};
/** Hari Minggu & libur yang tidak dicetak plan di [from, to] (YYYY-MM-DD → label). */
export const offDaysBetween = (
  calendar: PlanCalendar | null | undefined,
  from: string | null | undefined,
  to: string | null | undefined,
): Holiday[] => {
  const w = calendar?.workdays ?? ALL_DAYS,
    out: Holiday[] = [];
  if (!calendar || (w.sunday && w.holidays) || !from || !to) return out;
  const names = new Map((w.holidays ? [] : (calendar.holidays ?? [])).map((h) => [h.date, h.name]));
  for (let day = dayNumber(from.slice(0, 10)); day <= dayNumber(to.slice(0, 10)); day++) {
    const date = new Date(day * DAY).toISOString().slice(0, 10);
    if (names.has(date)) out.push({ date, name: names.get(date)! });
    else if (!w.sunday && (day + 4) % 7 === 0) out.push({ date, name: 'Sunday' });
  }
  return out;
};
/** Jendela maintenance sebuah mesin yang beririsan dengan [from, to) (ISO jam dinding). */
export const maintenanceBetween = (
  calendar: PlanCalendar | null | undefined,
  machineId: string,
  from: string,
  to?: string,
) =>
  (calendar?.maintenance ?? []).filter(
    (x) => x.machineId === machineId && x.end > from && (!to || x.start < to),
  );

// ---------- Rekomendasi & jadwal ----------

export interface Demand {
  id: string;
  code: string;
  customer?: string;
  section?: string;
  bi?: number;
  wip?: number;
  reqs?: WeekRequirement[];
  balances?: number[];
  shortage: number;
  due?: string | null;
  /** Sudah ada di Plan Produksi (mesin, qty, tanggal). */
  existing?: { machine: string; qty: number | string; date?: string | null } | null;
}
export interface Selection {
  include: boolean;
  layout: string;
  machine: string;
  qty: number;
  priority?: number;
  note?: string;
  reason?: string;
  spk?: string;
  remark?: string;
}
export type Selections = Record<string, Selection | undefined>;
/** Jam bebas tiap mesin (ISO jam dinding), mis. akhir job terakhir yang sudah dijadwalkan. */
export type FreeAt = Record<string, string | undefined>;

const freeAt = (free: FreeAt, id: string, start: string) =>
  Math.max(toMs(start), free[id] ? toMs(free[id]!) : 0);
const dueCutoff = (due?: string | null) => (due ? toMs(due) + 864e5 - 60000 : Infinity);
const byDue = (a: Demand, b: Demand) =>
  (a.due ?? '9999').localeCompare(b.due ?? '9999') || b.shortage - a.shortage;
const priorityOf = (selection?: Selection) => Number(selection?.priority) || DEFAULT_PRIORITY;

/**
 * Greedy, due paling awal dulu. Tiap item masuk ke pasangan (layout, mesin) layak dengan biaya
 * terendah: waktu selesai di antrian mesin, + penalti unit warna menganggur (mesin 6 warna tetap
 * kosong untuk job yang membutuhkannya) dan penalti mengabaikan tanda mesin di list2026.
 * Layout gabungan mencetak semua itemnya dalam satu run, jadi item yang layout-nya sudah
 * direncanakan ikut run itu di mesin yang sama, tidak dicetak ulang.
 * Planner meninjau dan bisa mengubah setiap baris; tidak ada yang final sebelum approval.
 */
export function recommend(
  demands: Demand[],
  layouts: Layout[],
  free: FreeAt,
  start: string,
  {
    spare = 0,
    machines = withCapacity(),
  }: { spare?: number; machines?: ScheduledMachine[] } = {},
): Record<string, Selection & { reason: string }> {
  const extra = spare ? ` (incl. ${Math.round(spare * 100)}% spare)` : '';
  const queue = new Map(machines.map((m) => [m.id, freeAt(free, m.id, start)]));
  // layout → { machine, sheets, codes } untuk layout yang sudah direncanakan
  const runs = new Map<string, { machine: string; sheets: number; codes: string[] }>();
  const out: Record<string, Selection & { reason: string }> = {};
  for (const d of [...demands].sort(byDue)) {
    const candidates = layoutsFor(d.code, layouts);
    const shared = candidates.find((l) => runs.has(l.layout));
    if (shared) {
      const run = runs.get(shared.layout)!,
        machine = machines.find((m) => m.id === run.machine)!,
        sheets = sheetsFor(d.shortage, upFor(shared, d.code), spare);
      // Hanya lembar tambahan di atas ukuran run sekarang yang menambah jam mesin.
      const extraHours = Math.max(0, sheets - run.sheets) / machine.speed;
      queue.set(machine.id, advance(queue.get(machine.id)!, extraHours, machine));
      const reason = `Printed together with ${run.codes.join(', ')} on layout ${shared.layout} on ${machine.name} · ${upFor(shared, d.code)} up → ${sheets}k sheets${extra}; one job uses the largest qty (${Math.max(run.sheets, sheets)}k sheets)`;
      out[d.id] = {
        include: !d.existing,
        layout: shared.layout,
        machine: machine.id,
        qty: sheets,
        priority: DEFAULT_PRIORITY,
        note: '',
        reason: d.existing
          ? `Already planned in Plan Produksi (${d.existing.machine} · ${d.existing.qty}). Tick it if more is still needed. Suggestion: ${reason}`
          : reason,
      };
      if (!d.existing) {
        run.sheets = Math.max(run.sheets, sheets);
        run.codes.push(d.code);
      }
      continue;
    }
    if (!candidates.length) {
      out[d.id] = {
        include: false,
        layout: '',
        machine: '',
        qty: roundUp1(d.shortage * (1 + spare)),
        priority: DEFAULT_PRIORITY,
        note: '',
        reason: 'No layout in list2026, check manually.',
      };
      continue;
    }
    let best: {
      layout: Layout;
      machine: ScheduledMachine;
      sheets: number;
      end: number;
      cost: number;
    } | null = null;
    for (const layout of candidates)
      for (const machine of machines) {
        if (!checkMachine(layout, machine).ok) continue;
        const sheets = sheetsFor(d.shortage, upFor(layout, d.code), spare),
          end = place(queue.get(machine.id)!, jobHours(sheets, machine), machine).end;
        const late = end > dueCutoff(d.due) ? 1000 : 0,
          idle = Math.max(0, machine.colors - (layout.ink.inks ?? machine.colors)) * 1.5,
          hint = layout.hints.length && !layout.hints.includes(machine.id) ? 3 : 0;
        const cost = late + (end - toMs(start)) / 36e5 + idle + hint;
        if (!best || cost < best.cost) best = { layout, machine, sheets, end, cost };
      }
    if (!best) {
      const why = [
        ...new Set(candidates.flatMap((l) => machines.flatMap((m) => checkMachine(l, m).reasons))),
      ]
        .slice(0, 3)
        .join('; ');
      out[d.id] = {
        include: false,
        layout: candidates[0].layout,
        machine: '',
        qty: sheetsFor(d.shortage, upFor(candidates[0], d.code), spare),
        priority: DEFAULT_PRIORITY,
        note: '',
        reason: `No press meets the rules (${why}).`,
      };
      continue;
    }
    const { layout, machine, sheets, end } = best;
    const onTime = end <= dueCutoff(d.due);
    const reason = [
      `${machine.name}: ${layout.ink.inks ?? '?'} colours${layout.ink.special ? ' (special ink)' : ''}, ${layout.size ? dim(layout.size) : '?'} cm fits`,
      `${layout.layout} ${upFor(layout, d.code)} up → ${sheets}k sheets${extra}`,
      d.due
        ? `done ${formatDateTime(toIso(end))}, ${onTime ? 'before' : 'AFTER'} WE ${formatDay(d.due)}`
        : `done ${formatDateTime(toIso(end))}`,
    ].join(' · ');
    if (d.existing) {
      const e = d.existing;
      out[d.id] = {
        include: false,
        layout: layout.layout,
        machine: machine.id,
        qty: sheets,
        priority: DEFAULT_PRIORITY,
        note: '',
        reason: `Already planned in Plan Produksi (${e.machine} · ${e.qty}${e.date ? ` · ${formatDay(e.date)}` : ''}). Tick it if more is still needed. Suggestion: ${reason}`,
      };
      continue;
    }
    queue.set(machine.id, end);
    runs.set(layout.layout, { machine: machine.id, sheets, codes: [d.code] });
    out[d.id] = {
      include: true,
      layout: layout.layout,
      machine: machine.id,
      qty: sheets,
      priority: DEFAULT_PRIORITY,
      note: '',
      reason,
    };
  }
  return out;
}

export interface ScheduledItem {
  id: string;
  code: string;
  customer?: string;
  qty: number;
  up: number;
  due?: string | null;
  late: boolean;
  spk: string;
  remark: string;
}
export interface ScheduledJob {
  id: string;
  lineIds: string[];
  items: ScheduledItem[];
  code: string;
  customer: string;
  layout: string;
  up: number | string;
  qty: number;
  hours: number;
  start: string;
  end: string;
  due: string | null;
  late: boolean;
  priority: number;
  note: string;
  spk: string;
  remark: string;
}

/**
 * Susun baris terpilih di tiap mesin setelah antriannya: prioritas, lalu due paling awal.
 * Baris di mesin yang sama dengan layout yang sama = satu run cetak: satu setup, dengan qty
 * baris yang butuh lembar terbanyak (semua item di lembar itu tercetak bersama).
 */
export function schedule(
  demands: Demand[],
  layouts: Layout[],
  selections: Selections,
  free: FreeAt,
  start: string,
  machines: ScheduledMachine[] = withCapacity(),
): Record<string, ScheduledJob[]> {
  const out: Record<string, ScheduledJob[]> = Object.fromEntries(machines.map((m) => [m.id, []]));
  for (const machine of machines) {
    let at = freeAt(free, machine.id, start);
    const lines = demands
      .filter((x) => {
        const s = selections[x.id];
        return s?.include && s.machine === machine.id && s.qty > 0;
      })
      .sort((a, b) => priorityOf(selections[a.id]) - priorityOf(selections[b.id]) || byDue(a, b));
    const runs = new Map<string, Demand[]>();
    for (const d of lines) {
      const key = selections[d.id]!.layout || `line:${d.id}`;
      if (!runs.has(key)) runs.set(key, []);
      runs.get(key)!.push(d);
    }
    for (const run of runs.values()) {
      const first = selections[run[0].id]!,
        layout = layouts.find((l) => l.layout === first.layout),
        qty = Math.max(...run.map((d) => selections[d.id]!.qty)),
        hours = jobHours(qty, machine);
      const placed = place(at, hours, machine),
        end = placed.end;
      at = placed.start;
      const items: ScheduledItem[] = run.map((d) => ({
        id: d.id,
        code: d.code,
        customer: d.customer,
        qty: selections[d.id]!.qty,
        up: layout ? upFor(layout, d.code) : 1,
        due: d.due,
        late: end > dueCutoff(d.due),
        spk: selections[d.id]!.spk || '',
        remark: selections[d.id]!.remark || '',
      }));
      const unique = (values: (string | undefined)[]) => [...new Set(values.filter(Boolean))];
      const dues = items
        .map((i) => i.due)
        .filter((due): due is string => !!due)
        .sort();
      out[machine.id].push({
        id: run[0].id,
        lineIds: items.map((i) => i.id),
        items,
        code: items.map((i) => i.code).join(' / '),
        customer: [...new Set(items.map((i) => i.customer))].join(' / '),
        layout: first.layout,
        up: items.length > 1 ? items.map((i) => i.up).join("'") : items[0].up,
        qty,
        hours: round3(hours),
        start: toIso(at),
        end: toIso(end),
        due: dues[0] ?? null,
        late: items.some((i) => i.late),
        priority: Math.min(...run.map((d) => priorityOf(selections[d.id]))),
        note: unique(run.map((d) => selections[d.id]!.note)).join(' · '),
        spk: unique(items.map((i) => i.spk)).join(' / '),
        remark: unique(items.map((i) => i.remark)).join(' · '),
      });
      at = end;
    }
  }
  return out;
}

/** True kalau layout terpilih mencetak item ini dan lolos aturan mesin. */
export function selectionFits(demand: Demand, selection: Selection, layouts: Layout[]) {
  const layout = layouts.find((x) => x.layout === selection.layout),
    machine = planningMachine(selection.machine);
  return (
    !!layout &&
    !!machine &&
    checkMachine(layout, machine).ok &&
    layoutsFor(demand.code, [layout]).length > 0
  );
}

