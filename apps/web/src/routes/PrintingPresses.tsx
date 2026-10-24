import { useState } from 'react';
import { format } from 'date-fns';
import { Info, Loader2, Pencil, Printer, Save, X } from 'lucide-react';
import { effectiveHoursOf } from '@pdits/shared/src/printing';
import {
  usePrintingCalendar,
  usePrintingMachines,
  useUpdatePrintingMachine,
  type PrintingMachine,
} from '../hooks/usePrinting';
import { useAuthStore } from '../stores/authStore';
import { useTranslation } from '../i18n';

type Draft = { speed: string; setupHours: string; effectiveHours: string };

const inputClass =
  'w-24 px-2 py-1 bg-secondary/50 border rounded-md text-sm text-right focus:outline-none focus:ring-2 focus:ring-primary/50';

export function PrintingPresses() {
  const { t, locale, dateLocale } = useTranslation();
  const canEdit = useAuthStore((s) => s.canEdit('production'));
  const { data, isLoading } = usePrintingMachines();
  const { data: calendarRes } = usePrintingCalendar();
  const update = useUpdatePrintingMachine();

  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({ speed: '', setupHours: '', effectiveHours: '' });
  const [error, setError] = useState('');

  const machines = data?.data ?? [];
  const shifts = calendarRes?.data.shifts ?? [];
  const calendarHours = shifts.length ? effectiveHoursOf(shifts) : null;
  const number = (n: number) => n.toLocaleString(locale, { maximumFractionDigits: 2 });

  const startEdit = (m: PrintingMachine) => {
    setEditing(m.id);
    setError('');
    setDraft({ speed: String(m.speed), setupHours: String(m.setupHours), effectiveHours: String(m.effectiveHours) });
  };

  const save = async (m: PrintingMachine) => {
    setError('');
    try {
      await update.mutateAsync({
        id: m.id,
        version: m.version,
        speed: Number(draft.speed),
        setupHours: Number(draft.setupHours),
        effectiveHours: Number(draft.effectiveHours),
      });
      setEditing(null);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : t('printing.presses.saveFailed'));
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Printer size={24} className="text-primary" />
          {t('printing.presses.title')}
        </h2>
        <p className="text-muted-foreground">{t('printing.presses.subtitle')}</p>
      </div>

      <div className="flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
        <Info size={16} className="mt-0.5 shrink-0" />
        <div>
          <p>{t('printing.presses.savedPlansNote')}</p>
          {calendarHours !== null && (
            <p className="mt-1">{t('printing.presses.breaksLeave', { hours: number(calendarHours) })}</p>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>
      )}

      <div className="bg-card border rounded-lg shadow-sm overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="text-xs text-muted-foreground uppercase bg-secondary/30">
            <tr>
              <th className="px-4 py-3 font-medium">{t('printing.presses.press')}</th>
              <th className="px-4 py-3 font-medium">{t('printing.presses.spec')}</th>
              <th className="px-4 py-3 font-medium text-right">{t('printing.presses.speed')}</th>
              <th className="px-4 py-3 font-medium text-right">{t('printing.presses.setup')}</th>
              <th className="px-4 py-3 font-medium text-right">{t('printing.presses.effective')}</th>
              <th className="px-4 py-3 font-medium">{t('printing.presses.updated')}</th>
              {canEdit && <th className="px-4 py-3 font-medium text-right">{t('common.actions')}</th>}
            </tr>
          </thead>
          <tbody className="divide-y">
            {isLoading ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center">
                  <Loader2 className="w-6 h-6 animate-spin mx-auto text-primary" />
                  <p className="mt-2 text-sm text-muted-foreground">{t('printing.presses.loading')}</p>
                </td>
              </tr>
            ) : (
              machines.map((m) => {
                const isEditing = editing === m.id;
                const mismatch = calendarHours !== null && Math.abs(m.effectiveHours - calendarHours) > 0.01;
                return (
                  <tr key={m.id} className="hover:bg-secondary/20 transition-colors">
                    <td className="px-4 py-3 font-semibold whitespace-nowrap">{m.name}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {m.colors !== null && m.min && m.max
                        ? t('printing.presses.specText', {
                            colors: m.colors,
                            min: m.min.join('×'),
                            max: m.max.join('×'),
                            ink: t(m.special ? 'printing.presses.specialInk' : 'printing.presses.noSpecialInk'),
                          })
                        : m.spec}
                      {m.note && <p className="text-xs text-amber-700 mt-0.5">{t(`printing.presses.notes.${m.id}`)}</p>}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {isEditing ? (
                        <input type="number" min="0" step="0.1" className={inputClass} value={draft.speed}
                          onChange={(e) => setDraft({ ...draft, speed: e.target.value })} />
                      ) : (
                        <>{number(m.speed)} <span className="text-xs text-muted-foreground">{t('printing.presses.speedUnit')}</span></>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {isEditing ? (
                        <input type="number" min="0" step="0.25" className={inputClass} value={draft.setupHours}
                          onChange={(e) => setDraft({ ...draft, setupHours: e.target.value })} />
                      ) : (
                        <>{number(m.setupHours)} <span className="text-xs text-muted-foreground">{t('printing.presses.hoursUnit')}</span></>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {isEditing ? (
                        <input type="number" min="0" max="24" step="0.5" className={inputClass} value={draft.effectiveHours}
                          onChange={(e) => setDraft({ ...draft, effectiveHours: e.target.value })} />
                      ) : (
                        <span title={mismatch ? t('printing.presses.mismatch', { hours: number(calendarHours!) }) : undefined}
                          className={mismatch ? 'text-amber-700 font-medium' : undefined}>
                          {number(m.effectiveHours)} <span className="text-xs text-muted-foreground">{t('printing.presses.perDay')}</span>
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                      {format(new Date(m.updatedAt), 'dd MMM yyyy HH:mm', { locale: dateLocale })}
                      {m.updatedBy && <div>{t('printing.presses.byUser', { name: m.updatedBy })}</div>}
                    </td>
                    {canEdit && (
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {isEditing ? (
                          <div className="inline-flex gap-1">
                            <button onClick={() => save(m)} disabled={update.isPending}
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-50">
                              {update.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                              {t('common.save')}
                            </button>
                            <button onClick={() => { setEditing(null); setError(''); }}
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border text-xs hover:bg-secondary">
                              <X size={14} />
                              {t('common.cancel')}
                            </button>
                          </div>
                        ) : (
                          <button onClick={() => startEdit(m)} disabled={editing !== null}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border text-xs hover:bg-secondary disabled:opacity-40">
                            <Pencil size={14} />
                            {t('common.edit')}
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default PrintingPresses;
