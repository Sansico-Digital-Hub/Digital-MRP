import { useState } from 'react';
import { Loader2, Plus, X } from 'lucide-react';
import { usePeriods, useCreatePeriod, monthLabel, periodDisplayLabel } from '../hooks/usePeriods';
import { useTranslation } from '../i18n';

/**
 * Pemilih PERIODE untuk modal Import Excel dan form Isi/Add Manual.
 *
 * Periode wajib dipilih sebelum data boleh disimpan. User bisa memilih periode
 * yang sudah ada, atau memilih "+ Tambah periode baru…" untuk membuat periode
 * baru langsung dari sini.
 */
export function PeriodSelect({
  value,
  onChange,
  label,
  className = '',
}: {
  value: string | null;
  onChange: (periodId: string | null) => void;
  label?: string;
  className?: string;
}) {
  const { t, lang } = useTranslation();
  const labelText = label ?? t('components.periodLabel');
  const { data: periodsRes } = usePeriods();
  const periods = periodsRes?.data ?? [];
  const createPeriod = useCreatePeriod();

  const [adding, setAdding] = useState(false);
  const [month, setMonth] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!month) return;
    setError(null);
    try {
      const res = await createPeriod.mutateAsync({ uploadMonth: month });
      setAdding(false);
      setMonth('');
      onChange(res.data.id);
    } catch (e: any) {
      setError(e?.message || t('components.periodCreateFailed'));
    }
  };

  return (
    <div className={className}>
      <label className="block text-sm font-medium text-gray-700 mb-1">
        {labelText} <span className="text-red-500">*</span>
      </label>

      {adding ? (
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="month"
            value={month}
            autoFocus
            onChange={(e) => setMonth(e.target.value)}
            className="px-3 py-2 text-sm border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <button
            type="button"
            onClick={handleCreate}
            disabled={!month || createPeriod.isPending}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {createPeriod.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Plus className="w-4 h-4" />
            )}
            {t('components.createPeriod', {
              label: month ? monthLabel(month, lang) : t('components.periodLower'),
            })}
          </button>
          <button
            type="button"
            onClick={() => {
              setAdding(false);
              setMonth('');
              setError(null);
            }}
            className="inline-flex items-center gap-1 px-2 py-2 text-sm rounded-md border text-gray-600 hover:bg-gray-50"
            title={t('components.cancelAddPeriod')}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <select
          value={value ?? ''}
          onChange={(e) => {
            if (e.target.value === '__new__') {
              setAdding(true);
              return;
            }
            onChange(e.target.value || null);
          }}
          className="w-full px-3 py-2 text-sm border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="">{t('components.periodPlaceholder')}</option>
          {periods.map((p) => (
            <option key={p.id} value={p.id}>
              {periodDisplayLabel(p, lang)}
              {p.isLocked ? t('components.periodLocked') : ''}
            </option>
          ))}
          <option value="__new__">{t('components.addPeriod')}</option>
        </select>
      )}

      {!adding && !value && (
        <p className="text-xs text-amber-600 mt-1">
          {t('components.periodRequired')}
        </p>
      )}
      {value && !adding && (
        <p className="text-xs text-muted-foreground mt-1">
          {t('components.periodSaved')}
        </p>
      )}
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
    </div>
  );
}
