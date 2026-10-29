import { useState, useRef, useEffect } from 'react';
import { Search, Plus, Check, ChevronDown } from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { useTranslation } from '../i18n';

interface Option {
  value: string;
  label: string;
}

interface SearchableSelectProps {
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  onAdd?: (searchValue: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

export function cn(...inputs: (string | undefined | null | false)[]) {
  return twMerge(clsx(inputs));
}

export function SearchableSelect({
  options,
  value,
  onChange,
  onAdd,
  placeholder,
  className,
  disabled = false,
}: SearchableSelectProps) {
  const { t } = useTranslation();
  const placeholderText = placeholder ?? t('common.select');
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  const selectedOption = options.find((opt) => opt.value === value);

  const filteredOptions = options.filter((opt) =>
    opt.label.toLowerCase().includes(search.toLowerCase()) ||
    opt.value.toLowerCase().includes(search.toLowerCase())
  );

  const showAddOption =
    onAdd &&
    search.trim() !== "" &&
    !options.some((opt) => opt.label.toLowerCase() === search.toLowerCase());

  const handleSelect = (val: string) => {
    onChange(val);
    setIsOpen(false);
    setSearch("");
  };

  const handleAdd = () => {
    if (onAdd && search.trim()) {
      onAdd(search.trim());
      setIsOpen(false);
      setSearch("");
    }
  };

  return (
    <div className={cn("relative w-full text-sm", className)} ref={containerRef}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
          !selectedOption && "text-muted-foreground",
          className
        )}
      >
        <span className="truncate">{selectedOption ? selectedOption.label : placeholderText}</span>
        <ChevronDown className="h-4 w-4 opacity-50" />
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 z-50 mt-1 max-h-60 w-full overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md">
          <div className="flex items-center border-b px-3">
            <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
            <input
              className="flex h-10 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
              placeholder={t('common.search')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onClick={(e) => e.stopPropagation()}
            />
          </div>

          <div className="max-h-[200px] overflow-y-auto p-1">
            {filteredOptions.length === 0 && !showAddOption && (
              <div className="py-6 text-center text-sm text-muted-foreground">
                {t('components.noOptions')}
              </div>
            )}
            
            {filteredOptions.map((opt, idx) => (
              <button
                key={`${opt.value}-${opt.label}-${idx}`}
                type="button"
                className={cn(
                  "relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground",
                  opt.value === value && "bg-accent/50 text-accent-foreground"
                )}
                onClick={() => handleSelect(opt.value)}
              >
                {opt.value === value && (
                  <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
                    <Check className="h-4 w-4" />
                  </span>
                )}
                <span className="truncate">{opt.label}</span>
              </button>
            ))}

            {showAddOption && (
              <button
                type="button"
                className="relative flex w-full cursor-pointer select-none items-center rounded-sm py-1.5 px-2 text-sm outline-none hover:bg-accent hover:text-accent-foreground text-primary font-medium mt-1"
                onClick={handleAdd}
              >
                <Plus className="mr-2 h-4 w-4 shrink-0" />
                {t('components.addOption', { value: search })}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
