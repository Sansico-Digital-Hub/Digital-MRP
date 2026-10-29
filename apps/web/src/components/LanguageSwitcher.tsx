import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Globe } from 'lucide-react';
import { cn } from '../lib/utils';
import { LANG_OPTIONS } from '../stores/languageStore';
import { useTranslation } from '../i18n';

/**
 * Tombol ganti bahasa (Bahasa Indonesia / English).
 *
 * Ditempatkan di kanan atas setiap halaman. Pilihan bahasa disimpan di
 * localStorage lewat `useLanguageStore`, sehingga bertahan setelah refresh.
 */
export function LanguageSwitcher({ className = '' }: { className?: string }) {
  const { t, lang, setLang } = useTranslation();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const active = LANG_OPTIONS.find((option) => option.value === lang) ?? LANG_OPTIONS[0];

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        title={t('layout.changeLanguage')}
        aria-label={t('layout.changeLanguage')}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex h-9 items-center gap-1.5 rounded-md border bg-background px-2.5 text-sm font-semibold text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground cursor-pointer"
      >
        <Globe size={16} />
        <span>{active.short}</span>
        <ChevronDown size={14} className={cn('transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label={t('layout.language')}
          className="absolute right-0 z-50 mt-1 w-48 overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-lg"
        >
          {LANG_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === lang}
              onClick={() => {
                setLang(option.value);
                setOpen(false);
              }}
              className={cn(
                'flex w-full items-center justify-between gap-2 px-3 py-2 text-sm transition-colors hover:bg-secondary cursor-pointer',
                option.value === lang ? 'font-semibold text-primary' : 'text-foreground',
              )}
            >
              <span>{option.label}</span>
              {option.value === lang && <Check size={16} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
