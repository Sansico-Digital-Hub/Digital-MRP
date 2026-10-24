import { useState, type ReactNode } from 'react';
import { format } from 'date-fns';
import { CalendarDays, CalendarOff, Clock, Loader2, Pencil, Plus, Save, Trash2, Wrench, X } from 'lucide-react';
import { effectiveHoursOf, wibIso } from '@pdits/shared/src/printing';
import {
  useAddPrintingHoliday,
  useDeletePrintingHoliday,
  useDeletePrintingMaintenance,
  usePrintingCalendar,
  usePrintingMachines,
  useSavePrintingMaintenance,
  useSavePrintingShifts,
  type MaintenanceInput,
  type PrintingCalendar as Calendar,
  type PrintingMaintenance,
  type PrintingShift,
} from '../hooks/usePrinting';
import { useAuthStore } from '../stores/authStore';
import { useTranslation } from '../i18n';

const inputClass =
  'px-2 py-1.5 bg-secondary/50 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/50';
const primaryButton =
  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50';
const secondaryButton =
  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-sm hover:bg-secondary disabled:opacity-40';
const iconButton = 'p-1.5 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground disabled:opacity-40';

/** Jam dinding WIB → teks tampilan. Parse & format sama-sama lokal, jadi jamnya tidak bergeser. */
function useWall() {
  const { dateLocale } = useTranslation();
  return {
    dateTime: (wall: string) => format(new Date(wall), 'EEE dd MMM yyyy HH:mm', { locale: dateLocale }),
    date: (day: string) => format(new Date(`${day}T00:00`), 'EEE dd MMM yyyy', { locale: dateLocale }),
  };
}

function Card({ icon, title, hint, children }: { icon: ReactNode; title: string; hint: string; children: ReactNode }) {
  return (
    <section className="bg-card border rounded-lg shadow-sm">
      <div className="p-4 border-b">
        <h3 className="font-semibold flex items-center gap-2">
          {icon}
          {title}
        </h3>
        <p className="text-sm text-muted-foreground mt-1">{hint}</p>
      </div>
      <div className="p-4 space-y-4">{children}</div>
    </section>
  );
}

function ErrorText({ message }: { message: string }) {
  if (!message) return null;
  return <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{message}</p>;
}

export function PrintingCalendar() {
  const { t } = useTranslation();
  const canEdit = useAuthStore((s) => s.canEdit('production'));
  const { data, isLoading } = usePrintingCalendar();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <CalendarDays size={24} className="text-primary" />
          {t('printing.calendar.title')}
        </h2>
        <p className="text-muted-foreground">
          {t('printing.calendar.subtitle')} {t('printing.wib')}
        </p>
      </div>

      {isLoading || !data ? (
        <div className="py-12 text-center">
          <Loader2 className="w-6 h-6 animate-spin mx-auto text-primary" />
          <p className="mt-2 text-sm text-muted-foreground">{t('printing.calendar.loading')}</p>
        </div>
      ) : (
        <>
          <Shifts calendar={data.data} canEdit={canEdit} />
          <div className="grid gap-6 xl:grid-cols-2">
            <Maintenance calendar={data.data} canEdit={canEdit} />
            <Holidays calendar={data.data} canEdit={canEdit} />
          </div>
        </>
      )}
    </div>
  );
}

// ---------- Shift ----------

function Shifts({ calendar, canEdit }: { calendar: Calendar; canEdit: boolean }) {
  const { t, locale } = useTranslation();
  const save = useSavePrintingShifts();
  const [draft, setDraft] = useState<PrintingShift[] | null>(null);
  const [error, setError] = useState('');
  const rows = draft ?? calendar.shifts;
  const hours = effectiveHoursOf(rows).toLocaleString(locale, { maximumFractionDigits: 2 });

  const change = (i: number, key: keyof PrintingShift, value: string) =>
    setDraft(rows.map((s, j) => (j === i ? { ...s, [key]: value } : s)));

  const submit = async () => {
    setError('');
    try {
      await save.mutateAsync({ version: calendar.shiftsVersion, shifts: rows });
      setDraft(null);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : t('printing.calendar.shifts.saveFailed'));
    }
  };

  const columns: [keyof PrintingShift, string][] = [
    ['start', 'start'],
    ['end', 'end'],
    ['breakStart', 'breakStart'],
    ['breakEnd', 'breakEnd'],
  ];

  return (
    <Card icon={<Clock size={18} className="text-primary" />} title={t('printing.calendar.shifts.title')} hint={t('printing.calendar.shifts.hint')}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="text-xs text-muted-foreground uppercase bg-secondary/30">
            <tr>
              <th className="px-3 py-2 font-medium">{t('printing.calendar.shifts.name')}</th>
              {columns.map(([key, label]) => (
                <th key={key} className="px-3 py-2 font-medium">{t(`printing.calendar.shifts.${label}`)}</th>
              ))}
              {draft && <th className="px-3 py-2" />}
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((s, i) => (
              <tr key={i}>
                <td className="px-3 py-2 font-medium">
                  {draft ? (
                    <input className={`${inputClass} w-32`} value={s.name} maxLength={40} onChange={(e) => change(i, 'name', e.target.value)} />
                  ) : (
                    s.name
                  )}
                </td>
                {columns.map(([key]) => (
                  <td key={key} className="px-3 py-2 tabular-nums">
                    {draft ? (
                      <input type="time" className={inputClass} value={s[key]} onChange={(e) => change(i, key, e.target.value)} />
                    ) : (
                      s[key]
                    )}
                  </td>
                ))}
                {draft && (
                  <td className="px-3 py-2 text-right">
                    <button className={iconButton} title={t('printing.calendar.shifts.removeShift')} disabled={rows.length <= 1}
                      onClick={() => setDraft(rows.filter((_, j) => j !== i))}>
                      <Trash2 size={16} />
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-medium">{t('printing.calendar.shifts.effective', { hours })}</p>
        {canEdit &&
          (draft ? (
            <div className="flex flex-wrap gap-2">
              <button className={secondaryButton} disabled={rows.length >= 6}
                onClick={() => setDraft([...rows, { name: `Shift ${rows.length + 1}`, start: '', end: '', breakStart: '', breakEnd: '' }])}>
                <Plus size={16} />
                {t('printing.calendar.shifts.addShift')}
              </button>
              <button className={secondaryButton} onClick={() => { setDraft(null); setError(''); }}>
                <X size={16} />
                {t('common.cancel')}
              </button>
              <button className={primaryButton} onClick={submit} disabled={save.isPending}>
                {save.isPending ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                {t('common.save')}
              </button>
            </div>
          ) : (
            <button className={secondaryButton} onClick={() => setDraft(calendar.shifts.map((s) => ({ ...s })))}>
              <Pencil size={16} />
              {t('common.edit')}
            </button>
          ))}
      </div>
      <ErrorText message={error} />
    </Card>
  );
}

// ---------- Maintenance ----------

const emptyMaintenance = (machineId = ''): MaintenanceInput => ({ machineId, start: '', end: '', reason: '' });

function Maintenance({ calendar, canEdit }: { calendar: Calendar; canEdit: boolean }) {
  const { t } = useTranslation();
  const wall = useWall();
  const { data: machinesRes } = usePrintingMachines();
  const machines = machinesRes?.data ?? [];
  const save = useSavePrintingMaintenance();
  const remove = useDeletePrintingMaintenance();
  const [form, setForm] = useState<MaintenanceInput>(emptyMaintenance());
  const [error, setError] = useState('');

  // Sekali per buka halaman; cukup untuk memisahkan yang sudah lewat.
  const [now] = useState(() => wibIso(Date.now()));
  const pressName = (id: string) => machines.find((m) => m.id === id)?.name ?? id;
  const upcoming = calendar.maintenance.filter((m) => m.end > now);
  const past = calendar.maintenance.filter((m) => m.end <= now).reverse();

  const submit = async () => {
    setError('');
    try {
      await save.mutateAsync(form);
      setForm(emptyMaintenance(form.machineId));
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : t('printing.calendar.maintenance.saveFailed'));
    }
  };

  const edit = (m: PrintingMaintenance) => {
    setError('');
    setForm({ id: m.id, version: m.version, machineId: m.machineId, start: m.start, end: m.end, reason: m.reason });
  };

  const del = async (m: PrintingMaintenance) => {
    if (!confirm(t('printing.calendar.maintenance.confirmDelete', { press: pressName(m.machineId), start: wall.dateTime(m.start) }))) return;
    setError('');
    try {
      await remove.mutateAsync({ id: m.id, version: m.version });
      if (form.id === m.id) setForm(emptyMaintenance(form.machineId));
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : t('printing.calendar.maintenance.saveFailed'));
    }
  };

  const row = (m: PrintingMaintenance, isPast: boolean) => (
    <li key={m.id} className={`flex items-start justify-between gap-3 py-2.5 ${isPast ? 'opacity-60' : ''}`}>
      <div className="min-w-0">
        <p className="font-medium">
          {pressName(m.machineId)} · {m.reason}
          {!isPast && m.start <= now && (
            <span className="ml-2 px-1.5 py-0.5 rounded-sm text-[10px] font-medium bg-amber-100 text-amber-800">
              {t('printing.calendar.maintenance.ongoing')}
            </span>
          )}
        </p>
        <p className="text-xs text-muted-foreground tabular-nums">
          {wall.dateTime(m.start)} – {wall.dateTime(m.end)}
          {m.updatedBy && ` · ${m.updatedBy}`}
        </p>
      </div>
      {canEdit && (
        <div className="flex shrink-0">
          <button className={iconButton} title={t('common.edit')} onClick={() => edit(m)}>
            <Pencil size={16} />
          </button>
          <button className={iconButton} title={t('common.delete')} onClick={() => del(m)} disabled={remove.isPending}>
            <Trash2 size={16} />
          </button>
        </div>
      )}
    </li>
  );

  return (
    <Card icon={<Wrench size={18} className="text-primary" />} title={t('printing.calendar.maintenance.title')} hint={t('printing.calendar.maintenance.hint')}>
      {canEdit && (
        <div className="rounded-md border bg-secondary/20 p-3 space-y-3">
          {form.id && <p className="text-xs font-semibold uppercase tracking-wide text-primary">{t('printing.calendar.maintenance.editing')}</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm space-y-1">
              <span className="text-muted-foreground">{t('printing.calendar.maintenance.press')}</span>
              <select className={`${inputClass} w-full`} value={form.machineId} onChange={(e) => setForm({ ...form, machineId: e.target.value })}>
                <option value="">{t('common.select')}</option>
                {machines.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </label>
            <label className="text-sm space-y-1">
              <span className="text-muted-foreground">{t('printing.calendar.maintenance.reason')}</span>
              <input className={`${inputClass} w-full`} maxLength={200} value={form.reason}
                placeholder={t('printing.calendar.maintenance.reasonPlaceholder')} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
            </label>
            <label className="text-sm space-y-1">
              <span className="text-muted-foreground">{t('printing.calendar.maintenance.start')}</span>
              <input type="datetime-local" className={`${inputClass} w-full`} value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} />
            </label>
            <label className="text-sm space-y-1">
              <span className="text-muted-foreground">{t('printing.calendar.maintenance.end')}</span>
              <input type="datetime-local" className={`${inputClass} w-full`} value={form.end} min={form.start || undefined}
                onChange={(e) => setForm({ ...form, end: e.target.value })} />
            </label>
          </div>
          <div className="flex justify-end gap-2">
            {form.id && (
              <button className={secondaryButton} onClick={() => { setForm(emptyMaintenance(form.machineId)); setError(''); }}>
                <X size={16} />
                {t('common.cancel')}
              </button>
            )}
            <button className={primaryButton} onClick={submit} disabled={save.isPending}>
              {save.isPending ? <Loader2 size={16} className="animate-spin" /> : form.id ? <Save size={16} /> : <Plus size={16} />}
              {form.id ? t('common.save') : t('printing.calendar.maintenance.add')}
            </button>
          </div>
          <ErrorText message={error} />
        </div>
      )}

      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('printing.calendar.maintenance.upcoming')}</h4>
        {upcoming.length ? (
          <ul className="divide-y">{upcoming.map((m) => row(m, false))}</ul>
        ) : (
          <p className="py-3 text-sm text-muted-foreground">{t('printing.calendar.maintenance.none')}</p>
        )}
      </div>
      {past.length > 0 && (
        <details>
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t('printing.calendar.maintenance.past')} ({past.length})
          </summary>
          <ul className="divide-y">{past.map((m) => row(m, true))}</ul>
        </details>
      )}
    </Card>
  );
}

// ---------- Hari libur ----------

function Holidays({ calendar, canEdit }: { calendar: Calendar; canEdit: boolean }) {
  const { t } = useTranslation();
  const wall = useWall();
  const add = useAddPrintingHoliday();
  const remove = useDeletePrintingHoliday();
  const [form, setForm] = useState({ date: '', name: '' });
  const [error, setError] = useState('');

  const [today] = useState(() => wibIso(Date.now()).slice(0, 10));
  const upcoming = calendar.holidays.filter((h) => h.date >= today);
  const past = calendar.holidays.filter((h) => h.date < today).reverse();

  const submit = async () => {
    setError('');
    try {
      await add.mutateAsync(form);
      setForm({ date: '', name: '' });
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : t('printing.calendar.holidays.saveFailed'));
    }
  };

  const del = async (id: string, date: string, name: string) => {
    if (!confirm(t('printing.calendar.holidays.confirmDelete', { date: wall.date(date), name }))) return;
    setError('');
    try {
      await remove.mutateAsync(id);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : t('printing.calendar.holidays.saveFailed'));
    }
  };

  const row = (h: Calendar['holidays'][number], isPast: boolean) => (
    <li key={h.id} className={`flex items-center justify-between gap-3 py-2.5 ${isPast ? 'opacity-60' : ''}`}>
      <div>
        <p className="font-medium">{h.name}</p>
        <p className="text-xs text-muted-foreground">{wall.date(h.date)}</p>
      </div>
      {canEdit && (
        <button className={iconButton} title={t('common.delete')} onClick={() => del(h.id, h.date, h.name)} disabled={remove.isPending}>
          <Trash2 size={16} />
        </button>
      )}
    </li>
  );

  return (
    <Card icon={<CalendarOff size={18} className="text-primary" />} title={t('printing.calendar.holidays.title')} hint={t('printing.calendar.holidays.hint')}>
      {canEdit && (
        <div className="rounded-md border bg-secondary/20 p-3 space-y-3">
          <div className="grid gap-3 sm:grid-cols-[auto_1fr_auto] sm:items-end">
            <label className="text-sm space-y-1">
              <span className="text-muted-foreground">{t('printing.calendar.holidays.date')}</span>
              <input type="date" className={`${inputClass} w-full`} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </label>
            <label className="text-sm space-y-1">
              <span className="text-muted-foreground">{t('printing.calendar.holidays.name')}</span>
              <input className={`${inputClass} w-full`} maxLength={80} value={form.name}
                placeholder={t('printing.calendar.holidays.namePlaceholder')} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </label>
            <button className={primaryButton} onClick={submit} disabled={add.isPending}>
              {add.isPending ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
              {t('common.add')}
            </button>
          </div>
          <ErrorText message={error} />
        </div>
      )}

      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('printing.calendar.holidays.upcoming')}</h4>
        {upcoming.length ? (
          <ul className="divide-y">{upcoming.map((h) => row(h, false))}</ul>
        ) : (
          <p className="py-3 text-sm text-muted-foreground">{t('printing.calendar.holidays.none')}</p>
        )}
      </div>
      {past.length > 0 && (
        <details>
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t('printing.calendar.holidays.past')} ({past.length})
          </summary>
          <ul className="divide-y">{past.map((h) => row(h, true))}</ul>
        </details>
      )}
    </Card>
  );
}

export default PrintingCalendar;
