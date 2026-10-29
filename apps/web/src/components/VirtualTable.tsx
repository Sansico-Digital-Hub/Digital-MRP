import React, { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { cn } from '../lib/utils';

export interface ColumnDef<T> {
  id: string;
  header: string | React.ReactNode;
  accessorKey?: keyof T;
  cell?: (info: { row: T; getValue: () => any }) => React.ReactNode;
  size?: number;
}

interface VirtualTableProps<T> {
  data: T[];
  columns: ColumnDef<T>[];
  className?: string;
  rowHeight?: number;
}

export function VirtualTable<T>({ data, columns, className, rowHeight = 40 }: VirtualTableProps<T>) {
  const parentRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: data.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan: 10,
  });

  return (
    <div 
      ref={parentRef} 
      className={cn("h-[600px] overflow-auto border rounded-md shadow-sm bg-card", className)}
    >
      <div 
        style={{
          height: `${rowVirtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {/* Header - sticky */}
        <div 
          className="sticky top-0 z-10 flex border-b bg-muted/50 font-semibold text-sm"
          style={{ height: rowHeight }}
        >
          {columns.map(col => (
            <div 
              key={col.id} 
              className="px-4 py-2 truncate border-r last:border-r-0"
              style={{ width: col.size || `${100 / columns.length}%`, flexShrink: 0 }}
            >
              {col.header}
            </div>
          ))}
        </div>

        {/* Virtualized Rows */}
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const row = data[virtualRow.index];
          return (
            <div
              key={virtualRow.key}
              className="absolute top-0 left-0 w-full flex border-b last:border-b-0 hover:bg-muted/30 transition-colors text-sm"
              style={{
                height: `${virtualRow.size}px`,
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              {columns.map(col => {
                const value = col.accessorKey ? row[col.accessorKey] : null;
                const cellContent = col.cell ? col.cell({ row, getValue: () => value }) : value as React.ReactNode;
                
                return (
                  <div 
                    key={col.id} 
                    className="px-4 py-2 truncate border-r last:border-r-0 flex items-center"
                    style={{ width: col.size || `${100 / columns.length}%`, flexShrink: 0 }}
                  >
                    {cellContent}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
