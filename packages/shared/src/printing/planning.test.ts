// Diport dari Production-Planning `tests/planning.test.js`: angka & ekspektasi sama persis,
// supaya hasil modul Printing di PlannerProject identik dengan aplikasi aslinya.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  PLANNING_MACHINES,
  breakMinutes,
  buildLayout,
  checkMachine,
  computeShortage,
  effectiveHoursOf,
  excelSerialToIso,
  expandLayout,
  inkProfile,
  layoutsFor,
  machineIdOf,
  maintenanceBetween,
  offDaysBetween,
  parseSize,
  planMachines,
  plannerCalendar,
  parseUps,
  recommend,
  schedule,
  selectionFits,
  sheetsFor,
  upFor,
  withCapacity,
  type Demand,
  type Layout,
  type LayoutRow,
  type Selection,
  type Workdays,
} from './index';

const build = (row: LayoutRow) => buildLayout(row)!;

const reqs = [
  { week: '2026-09-26', qty: 26.152 },
  { week: '2026-10-03', qty: 19 },
  { week: '2026-10-10', qty: 0 },
];
test('shortage = BI + WIP − cumulative requirement (HRG52-4B32 from Plan Produksi 09/23)', () => {
  const s = computeShortage(27.74, 12, reqs);
  assert.deepEqual(s.balances, [13.588, -5.412, -5.412]);
  assert.equal(s.shortage, 5.412);
  assert.equal(s.due, '2026-10-03');
  assert.deepEqual(computeShortage(50, 0, reqs), {
    balances: [23.848, 4.848, 4.848],
    shortage: 0,
    due: null,
  });
});

test('sheet sizes in the formats found in list2026', () => {
  assert.deepEqual(parseSize('81 x 50.5 cm'), [81, 50.5]);
  assert.deepEqual(parseSize('62,5 X 75.5 CM'), [75.5, 62.5]);
  assert.deepEqual(parseSize('62,5x 68.5 cm'), [68.5, 62.5]);
  assert.deepEqual(parseSize('49*81CM'), [81, 49]);
  assert.deepEqual(parseSize('96.5cm x 68.5 cm'), [96.5, 68.5]);
  assert.equal(parseSize('#N/A'), null);
});

test('UP strings', () => {
  assert.deepEqual(parseUps("4'4"), [4, 4]);
  assert.deepEqual(parseUps('1*1*1'), [1, 1, 1]);
  assert.deepEqual(parseUps('3/16/3/2'), [3, 16, 3, 2]);
  assert.deepEqual(parseUps(12), [12]);
});

test('layout codes expand to every printed item', () => {
  assert.deepEqual(expandLayout('HLW47/48-4B10').codes, ['HLW47-4B10', 'HLW48-4B10']);
  assert.deepEqual(expandLayout('HLW03/05/HLX22-4B10').codes, [
    'HLW03-4B10',
    'HLW05-4B10',
    'HLX22-4B10',
  ]);
  assert.deepEqual(expandLayout('JPL73-JA10/30').codes, ['JPL73-JA10', 'JPL73-JA30']);
  assert.deepEqual(expandLayout('JJB44-4B11_4B21 (Alternatif)').codes, [
    'JJB44-4B11',
    'JJB44-4B21',
  ]);
  assert.deepEqual(expandLayout('JLT64-JA10/JLT63-4B40').codes, ['JLT64-JA10', 'JLT63-4B40']);
  assert.deepEqual(expandLayout('JLX39-MA10G1').codes, ['JLX39-MA10G1']);
  assert.deepEqual(expandLayout('JLX39-MA10G1').aliases, [['JLX39-MA10', 'JLX39-MA10G1']]);
  assert.deepEqual(expandLayout('JMJ47-MA10,4B20,MA40').codes, [
    'JMJ47-MA10',
    'JMJ47-4B20',
    'JMJ47-MA40',
  ]);
  const variant = expandLayout('HRG52-4B32 KBA 4');
  assert.deepEqual(variant.codes, ['HRG52-4B32']);
  assert.deepEqual(variant.hints, ['kba4']);
  assert.equal(machineIdOf('KBA 4'), 'kba4');
  assert.equal(machineIdOf('GENIUS'), 'genius');
});

test('ink count trusts the colour text over an under-filled COLOR column', () => {
  assert.deepEqual(inkProfile('CRYK+P 224', 4), { inks: 5, special: true, confident: true });
  assert.deepEqual(inkProfile('CRYK COATING W/B', 4), { inks: 4, special: false, confident: true });
  assert.deepEqual(inkProfile('CMYK FMO, BLISTER SPOT UV', 4), {
    inks: 4,
    special: false,
    confident: true,
  });
  assert.deepEqual(inkProfile('BLACK.YELLOW,TARGET GREY COATING MATT', 3), {
    inks: 3,
    special: true,
    confident: true,
  });
  assert.deepEqual(inkProfile('CRYK + P134 + P224', 4), {
    inks: 6,
    special: true,
    confident: true,
  });
  assert.deepEqual(inkProfile('CMYK + PANTONE 185 C + gold', 4), {
    inks: 6,
    special: true,
    confident: true,
  });
  assert.equal(inkProfile('', 4).inks, 4);
});

const hrg = build({
  mesin: 'KBA4/3',
  layout: 'HRG52-4B32',
  up: 2,
  color: 4,
  material: 'DUPLEK MEGA 270G',
  size: '81 x 50.5 cm',
  colour: 'CRYK+P 224',
});
const hrgK4 = build({
  layout: 'HRG52-4B32 KBA 4',
  up: 4,
  color: 4,
  material: 'DUPLEK MEGA 270G',
  size: '81 x 100 cm',
  colour: 'CRYK+P 224',
});
test('machine rules for HRG52-4B32: colours, special ink, min/max sheet size', () => {
  const ok = (l: Layout) => Object.fromEntries(PLANNING_MACHINES.map((m) => [m.id, checkMachine(l, m).ok]));
  assert.deepEqual(ok(hrg), { kba1: false, kba2: true, kba3: true, kba4: false, genius: false });
  assert.deepEqual(ok(hrgK4), { kba1: false, kba2: false, kba3: false, kba4: true, genius: false });
  assert.ok(checkMachine(hrg, PLANNING_MACHINES[0]).reasons.includes('Cannot print special ink'));
  assert.match(checkMachine(hrg, PLANNING_MACHINES[3]).reasons.join(), /50.5 below min 72×60/);
  assert.match(checkMachine(hrg, PLANNING_MACHINES[1]).warnings.join(), /KBA 2 special inks/);
  assert.equal(layoutsFor('hrg52-4b32', [hrg, hrgK4]).length, 2);
});

const demand = (
  id: string,
  code: string,
  shortage: number,
  due: string,
  existing: Demand['existing'] = null,
): Demand => ({
  id,
  customer: 'MJD',
  section: '',
  code,
  bi: 0,
  wip: 0,
  reqs: [{ week: due, qty: shortage }],
  balances: [-shortage],
  shortage,
  due,
  existing,
});
test('recommendation picks a feasible press and the schedule follows the Excel 21-hour clock', () => {
  const plain = build({
    layout: 'HLW03-JA11',
    up: 6,
    color: 4,
    size: '69 x 67',
    colour: 'CRYK COATING W/B',
  });
  const ds = [
    demand('a', 'HRG52-4B32', 5.412, '2026-10-03'),
    demand('b', 'HLW03-JA11', 12, '2026-10-10'),
    demand('c', 'XXX00-0000', 1, '2026-10-10'),
    demand('d', 'HLW03-JA11', 3, '2026-10-10', { machine: 'KBA 1', qty: 1, date: null }),
  ];
  const rec = recommend(ds, [hrg, hrgK4, plain], {}, '2026-10-05T07:00');
  assert.ok(['kba2', 'kba3', 'kba4'].includes(rec.a.machine));
  assert.equal(rec.a.include, true);
  assert.equal(rec.b.qty, 2);
  assert.ok(
    ['kba1', 'genius'].includes(rec.b.machine),
    '4-colour job stays off the 6-colour presses',
  );
  assert.equal(rec.c.include, false);
  assert.match(rec.c.reason, /No layout in list2026/);
  assert.equal(rec.d.include, false, 'existing MRP plan is unchecked by default');
  assert.match(rec.d.reason, /Already planned/);
  const selections: Record<string, Selection> = {
    b: { include: true, layout: 'HLW03-JA11', machine: 'kba1', qty: 3, note: '' },
  };
  const jobs = schedule(
    ds,
    [hrg, hrgK4, plain],
    selections,
    { kba1: '2026-10-05T09:00' },
    '2026-10-05T07:00',
  );
  // 3 rb lembar / 4 per jam + 1 jam setup = 1.75 jam kerja → 1.75/21 hari = 2 jam kalender.
  assert.deepEqual(
    [jobs.kba1[0].start, jobs.kba1[0].end, jobs.kba1[0].late],
    ['2026-10-05T09:00', '2026-10-05T11:00', false],
  );
  assert.equal(selectionFits(ds[1], selections.b, [plain]), true);
  assert.equal(selectionFits(ds[0], { ...selections.b, layout: 'HRG52-4B32' }, [hrg]), false);
});

test('jobs past their week-ending date are flagged late', () => {
  const plain = build({
    layout: 'HLW03-JA11',
    up: 1,
    color: 4,
    size: '69 x 67',
    colour: 'CMYK',
  });
  const jobs = schedule(
    [demand('a', 'HLW03-JA11', 100, '2026-10-05')],
    [plain],
    { a: { include: true, layout: 'HLW03-JA11', machine: 'kba1', qty: 100, note: '' } },
    {},
    '2026-10-05T07:00',
  );
  assert.equal(jobs.kba1[0].late, true);
});

test('Excel serial dates, including the 1904 date system', () => {
  assert.equal(excelSerialToIso(46291), '2026-09-26T00:00');
  assert.equal(excelSerialToIso(46291 - 1462, true), '2026-09-26T00:00');
});

test('spare for reject/defect raises the print quantity before rounding', () => {
  // HRG52-4B32: 5.412 rb pcs × 1.10 = 5.953 ÷ 2 up = 2.98 → 3.0 rb lembar (2.8 without spare).
  assert.equal(sheetsFor(5.412, 2), 2.8);
  assert.equal(sheetsFor(5.412, 2, 0.1), 3);
  assert.equal(sheetsFor(12, 6, 0.1), 2.2, 'no float drift on exact multiples');
  const rec = recommend(
    [demand('a', 'HRG52-4B32', 5.412, '2026-10-03')],
    [hrg],
    {},
    '2026-10-05T07:00',
    {
      spare: 0.1,
    },
  );
  assert.equal(rec.a.qty, 3);
  assert.equal(rec.a.priority, 2);
  assert.match(rec.a.reason, /incl. 10% spare/);
});

test('planner priority orders the machine queue before the due date', () => {
  const a = build({ layout: 'HLW03-JA11', up: 1, size: '69 x 67', colour: 'CMYK' });
  const b = build({ layout: 'HLW05-JA11', up: 1, size: '69 x 67', colour: 'CMYK' });
  const ds = [
    demand('early', 'HLW03-JA11', 4, '2026-10-06'),
    demand('late', 'HLW05-JA11', 4, '2026-10-20'),
  ];
  const line = (layout: string, priority?: number): Selection => ({
    include: true,
    layout,
    machine: 'kba1',
    qty: 4,
    note: '',
    priority,
  });
  const order = (early?: number, late?: number) =>
    schedule(
      ds,
      [a, b],
      { early: line('HLW03-JA11', early), late: line('HLW05-JA11', late) },
      {},
      '2026-10-05T07:00',
    ).kba1.map((j) => j.id);
  assert.deepEqual(order(2, 2), ['early', 'late']);
  assert.deepEqual(order(2, 1), ['late', 'early']);
  assert.deepEqual(order(undefined, 3), ['early', 'late']);
});

test('GENIUS runs at 1000 sheets per hour as confirmed by the client', () => {
  const genius = PLANNING_MACHINES.find((m) => m.id === 'genius')!;
  assert.equal(genius.speed, 1);
});

test('UP per code follows the written order, with apostrophe or asterisk separators', () => {
  const ups = (layout: string, up: unknown) =>
    Object.fromEntries(
      build({ layout, up, size: '80x60', colour: 'CMYK' }).codes.map((c) => [c.code, c.up]),
    );
  // Examples from the GC PRINTING machine sheets (24 Sep 2026).
  assert.deepEqual(ups('JPL14/16/17/18-MA10', "2'1'1'1"), {
    'JPL14-MA10': 2,
    'JPL16-MA10': 1,
    'JPL17-MA10': 1,
    'JPL18-MA10': 1,
  });
  assert.deepEqual(ups('HCN17/18-4B21', '9*12'), { 'HCN17-4B21': 9, 'HCN18-4B21': 12 });
  assert.deepEqual(ups('JLT64-JA10/JLT63-4B40', "1'1"), { 'JLT64-JA10': 1, 'JLT63-4B40': 1 });
  assert.deepEqual(ups('JJN56/57/59/60-4B20/JJN58-4B21', "6'6'6'4'2"), {
    'JJN56-4B20': 6,
    'JJN57-4B20': 6,
    'JJN59-4B20': 6,
    'JJN60-4B20': 4,
    'JJN58-4B21': 2,
  });
  assert.deepEqual(ups('JPD81-JA10/4B30/4B20', '2*2*3'), {
    'JPD81-JA10': 2,
    'JPD81-4B30': 2,
    'JPD81-4B20': 3,
  });
  assert.deepEqual(ups('JPL73-JA10/30', 6), { 'JPL73-JA10': 6, 'JPL73-JA30': 6 });
  assert.deepEqual(ups('JMJ47-MA10,4B20,MA40', '3*2*6'), {
    'JMJ47-MA10': 3,
    'JMJ47-4B20': 2,
    'JMJ47-MA40': 6,
  });
  // G variants: the alias shares the UP of its own code, not the first UP.
  const g = build({ layout: 'JLX39/40-MA10G1', up: "2'1", size: '80x60', colour: 'CMYK' });
  assert.equal(upFor(g, 'JLX40-MA10'), 1);
  assert.equal(upFor(g, 'JLX39-MA10'), 2);
  assert.equal(g.upCertain, true);
  assert.equal(layoutsFor('JLX40-MA10', [g]).length, 1);
  // Counts that do not match stay in order and are flagged for a manual check.
  const off = build({
    layout: 'HLW04/08/10/12/14-JA20',
    up: "5'5'5'4",
    size: '80x60',
    colour: 'CMYK',
  });
  assert.equal(off.upCertain, false);
  assert.equal(upFor(off, 'HLW12-JA20'), 4);
  assert.equal(
    build({ layout: 'HLW03-JA21 old', up: '000', size: '80x60' }).upCertain,
    false,
  );
});

// JRP25-JA10/JRP35-JA10/JRP37-JA10 prints three items on one sheet (example from the KBA 1 export).
const jrp = build({
  layout: 'JRP25-JA10/JRP35-JA10/JRP37-JA10',
  up: "3'3'3",
  color: 4,
  size: '83 x 53 cm',
  colour: 'CMYK',
});
test('items sharing a combined layout on one machine are a single print run', () => {
  const ds = [
    demand('jrp25', 'JRP25-JA10', 86.3, '2026-10-10'),
    demand('jrp35', 'JRP35-JA10', 60, '2026-10-10'),
  ];
  const line = (qty: number, machine = 'kba1'): Selection => ({
    include: true,
    layout: jrp.layout,
    machine,
    qty,
    note: '',
    priority: 2,
  });
  const jobs = schedule(ds, [jrp], { jrp25: line(31.6), jrp35: line(22) }, {}, '2026-10-05T07:00');
  assert.equal(jobs.kba1.length, 1);
  const run = jobs.kba1[0];
  assert.deepEqual(run.lineIds, ['jrp25', 'jrp35']);
  assert.equal(run.qty, 31.6, 'the run prints the larger need; the other item rides along');
  assert.equal(run.code, 'JRP25-JA10 / JRP35-JA10');
  assert.equal(run.up, "3'3");
  assert.equal(run.hours, Math.round((31.6 / 4 + 1) * 1000) / 1000, 'one setup for the run');
  assert.deepEqual(
    run.items.map((i) => [i.code, i.qty]),
    [
      ['JRP25-JA10', 31.6],
      ['JRP35-JA10', 22],
    ],
  );
  // A planner who moves one item to another machine splits the run.
  const split = schedule(
    ds,
    [jrp],
    { jrp25: line(31.6), jrp35: line(22, 'genius') },
    {},
    '2026-10-05T07:00',
  );
  assert.equal(split.kba1.length + split.genius.length, 2);
});

test('the recommendation sends items of a planned combined layout to the same run', () => {
  const ds = [
    demand('jrp25', 'JRP25-JA10', 86.3, '2026-10-10'),
    demand('jrp35', 'JRP35-JA10', 60, '2026-10-17'),
    demand('jrp37', 'JRP37-JA10', 1, '2026-10-17', { machine: 'KBA 1', qty: 1, date: null }),
  ];
  const rec = recommend(ds, [jrp], {}, '2026-10-05T07:00', { spare: 0.1 });
  assert.equal(rec.jrp35.machine, rec.jrp25.machine);
  assert.equal(rec.jrp35.layout, jrp.layout);
  assert.equal(rec.jrp35.include, true);
  assert.match(rec.jrp35.reason, /Printed together with JRP25-JA10/);
  assert.equal(
    rec.jrp37.machine,
    rec.jrp25.machine,
    'already planned in MRP: suggested, not checked',
  );
  assert.equal(rec.jrp37.include, false);
  const jobs = schedule(ds, [jrp], rec, {}, '2026-10-05T07:00');
  assert.equal(jobs[rec.jrp25.machine].length, 1);
});

test('a cross layout without a reliable UP order takes the smallest UP and is flagged', () => {
  const l = build({
    layout: 'JPD80/81/82-0201/0202',
    up: '10*10*10*10*56',
    size: '80 x 46',
    colour: 'CMYK',
  });
  assert.equal(upFor(l, 'JPD82-0201'), 10);
  assert.equal(l.upCertain, false);
});

test('the schedule uses the capacity stored with the plan', () => {
  const layout = build({ layout: 'HLW03-JA11', up: 1, size: '69 x 67', colour: 'CMYK' });
  const ds = [{ id: 'a', code: 'HLW03-JA11', customer: 'MJD', shortage: 10, due: null }];
  const sel: Record<string, Selection> = { a: { include: true, layout: 'HLW03-JA11', machine: 'kba1', qty: 10, priority: 2 } };
  const start = '2026-10-05T07:00';
  const [standard] = schedule(ds, [layout], sel, {}, start).kba1;
  assert.equal(standard.hours, 3.5, '10 ÷ 4 + 1 h setup');
  const machines = withCapacity({ kba1: { speed: 5, setupHours: 2, hoursPerDay: 21 } });
  const [job] = schedule(ds, [layout], sel, {}, start, machines).kba1;
  assert.equal(job.hours, 4, '10 ÷ 5 + 2 h setup');
  assert.equal(job.end, '2026-10-05T11:34', '4 working hours = 4/21 of a day');
  assert.equal(withCapacity(undefined)[0].setupHours, 1, 'old plans keep the defaults');
});

test('press specs follow the client machine list (Oct 2026)', () => {
  const spec = Object.fromEntries(
    PLANNING_MACHINES.map((m) => [m.id, [m.colors, m.special, m.min.join('x'), m.max.join('x')]]),
  );
  assert.deepEqual(spec.kba1, [4, false, '51x38', '85x72'], 'KBA 1: no special ink at all');
  assert.deepEqual(spec.kba2, [5, true, '51x38', '102x72']);
  assert.deepEqual(spec.kba3, [6, true, '51x38', '102x72']);
  assert.deepEqual(spec.kba4, [6, true, '72x60', '142x100']);
  assert.match(PLANNING_MACHINES[1].note!, /differ from KBA 3/);
});

test('with a calendar the press stops for shift breaks and maintenance', () => {
  const layout = build({ layout: 'HLW03-JA11', up: 1, size: '69 x 67', colour: 'CMYK' });
  const ds = [
    { id: 'a', code: 'HLW03-JA11', customer: 'MJD', shortage: 10, due: null },
    { id: 'b', code: 'HLW03-JA11', customer: 'MJD', shortage: 2, due: null },
  ];
  const line = (qty: number, priority: number): Selection => ({
    include: true,
    layout: `line-${qty}`,
    machine: 'kba1',
    qty,
    priority,
  });
  const calendar = plannerCalendar({
    shifts: [
      { name: 'Shift 1', breakStart: '12:00', breakEnd: '12:30' },
      { name: 'Shift 2', breakStart: '18:30', breakEnd: '19:00' },
      { name: 'Shift 3', breakStart: '03:00', breakEnd: '03:30' },
    ],
    maintenance: [
      { machineId: 'kba1', start: '2026-10-05T14:00', end: '2026-10-05T16:00', reason: 'Roller' },
      {
        machineId: 'kba2',
        start: '2026-10-05T07:00',
        end: '2026-10-06T07:00',
        reason: 'Other press',
      },
    ],
  });
  const machines = planMachines({}, calendar);
  const jobs = schedule(
    ds,
    [layout],
    { a: line(10, 1), b: line(2, 2) },
    {},
    '2026-10-05T10:00',
    machines,
  ).kba1;
  // 10 ÷ 4 + 1 h setup = 3.5 h from 10:00, with the 12:00–12:30 break → 14:00.
  assert.deepEqual(
    [jobs[0].start, jobs[0].end, jobs[0].hours],
    ['2026-10-05T10:00', '2026-10-05T14:00', 3.5],
  );
  // KBA 1 maintenance 14:00–16:00: the next job waits, then 2 ÷ 4 + 1 = 1.5 h.
  assert.deepEqual([jobs[1].start, jobs[1].end], ['2026-10-05T16:00', '2026-10-05T17:30']);
  // Shift 3 breaks at 03:00 the next morning.
  const night = schedule(
    ds.slice(0, 1),
    [layout],
    { a: line(10, 1) },
    {},
    '2026-10-06T01:00',
    machines,
  ).kba1[0];
  assert.deepEqual([night.start, night.end], ['2026-10-06T01:00', '2026-10-06T05:00']);
  // A job that would run into maintenance starts after it: 13:00 + 3.5 h crosses 14:00.
  const blocked = schedule(
    ds.slice(0, 1),
    [layout],
    { a: line(10, 1) },
    {},
    '2026-10-05T13:00',
    machines,
  ).kba1[0];
  assert.deepEqual([blocked.start, blocked.end], ['2026-10-05T16:00', '2026-10-05T20:00']);
  // A job never starts inside a break.
  const atBreak = schedule(
    ds.slice(1),
    [layout],
    { b: line(2, 2) },
    {},
    '2026-10-06T12:10',
    machines,
  ).kba1[0];
  assert.equal(atBreak.start, '2026-10-06T12:30');
  assert.deepEqual(
    maintenanceBetween(calendar, 'kba1', '2026-10-05T07:00').map((m) => m.reason),
    ['Roller'],
  );
});

test('schedule: Sundays and holidays off pause the press from the first shift to the next day', () => {
  const layout = build({ layout: 'HLW03-JA11', up: 1, size: '69 x 67', colour: 'CMYK' });
  const d = [{ id: 'a', code: 'HLW03-JA11', customer: 'MJD', shortage: 36, due: null }];
  const sel: Record<string, Selection> = { a: { include: true, layout: 'HLW03-JA11', machine: 'kba1', qty: 36, priority: 1 } };
  const shifts = [
    { name: 'Shift 1', start: '07:00', breakStart: '12:00', breakEnd: '12:30' },
    { name: 'Shift 2', start: '15:00', breakStart: '18:30', breakEnd: '19:00' },
    { name: 'Shift 3', start: '23:00', breakStart: '03:00', breakEnd: '03:30' },
  ];
  const holidays = [{ date: '2026-10-12', name: 'Plant shutdown' }];
  const run = (workdays: Workdays, start = '2026-10-10T22:00') =>
    schedule(
      d,
      [layout],
      sel,
      {},
      start,
      planMachines({}, plannerCalendar({ shifts, holidays }, workdays)),
    ).kba1[0];
  // 36 ÷ 4 + 1 h setup = 10 h from Saturday 22:00: 8.5 h until Sunday 07:00 (03:00 break).
  assert.equal(run({ sunday: true, holidays: true }).end, '2026-10-11T08:30');
  assert.equal(run({ sunday: false, holidays: true }).end, '2026-10-12T08:30');
  assert.equal(run({ sunday: false, holidays: false }).end, '2026-10-13T08:30');
  // A job planned on a day off starts when the next working day's first shift starts.
  assert.equal(
    run({ sunday: false, holidays: true }, '2026-10-11T10:00').start,
    '2026-10-12T07:00',
  );
  const calendar = plannerCalendar({ shifts, holidays }, { sunday: false, holidays: false });
  assert.deepEqual(offDaysBetween(calendar, '2026-10-10T07:00', '2026-10-19T10:00'), [
    { date: '2026-10-11', name: 'Sunday' },
    { date: '2026-10-12', name: 'Plant shutdown' },
    { date: '2026-10-18', name: 'Sunday' },
  ]);
});

test('effective hours = 24 h minus the shift breaks, a break may cross midnight', () => {
  assert.equal(breakMinutes('23:45', '00:15'), 30);
  assert.equal(
    effectiveHoursOf([
      { name: 'Shift 1', breakStart: '12:00', breakEnd: '12:30' },
      { name: 'Shift 2', breakStart: '18:30', breakEnd: '19:00' },
      { name: 'Shift 3', breakStart: '03:00', breakEnd: '03:30' },
    ]),
    22.5,
  );
});
