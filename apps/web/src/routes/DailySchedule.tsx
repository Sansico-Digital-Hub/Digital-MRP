import React, { useState, useMemo } from 'react';
import { useDailySchedules, useUpsertDailySchedule, useBulkUpsertDailySchedule, useBulkDeleteDailySchedule } from '../hooks/useDailySchedule';
import { useItems, useMasterCartons } from '../hooks/useItems';
import { SearchableSelect } from '../components/SearchableSelect';
import { Calendar, Plus, Save, Upload, Trash2, Search, Edit2, Layers, Package, Clock } from 'lucide-react';
// import { format } from 'date-fns';
import * as XLSX from 'xlsx';
import { useAuthStore } from '../stores/authStore';
import { useTranslation } from '../i18n';

interface ImportRecord {
  id: string;
  toyName: string;
  masterCarton: string;
  partNumber: string;
  date: string;
  shift: number;
  quantity: number;
}

// Helper to convert Excel serial date number to YYYY-MM-DD string
function excelSerialToDate(serial: number): string {
  try {
    const parsed = XLSX.SSF.parse_date_code(serial);
    if (parsed) {
      const year = parsed.y;
      const month = String(parsed.m).padStart(2, '0');
      const day = String(parsed.d).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
  } catch (e) {
    // Ignore and fallback
  }
  // Excel uses 1900-01-01 as day 1, but JavaScript Date uses 1970-01-01
  // The offset 25569 is the number of days between 1900-01-01 and 1970-01-01
  // But Excel incorrectly treats 1900 as a leap year, so we need to subtract 1
  const utcDays = Math.floor(serial - 25569);
  const d = new Date(utcDays * 86400 * 1000);
  // Fix timezone offset issue - use UTC to avoid local timezone shifting
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Parse DailySchedule.xlsx with a flat table format:
 *   Row 1 (index 0): Header row — Toy Name | Master Carton | Part Number | Date | Shift 1 | Shift 2 | Shift 3 | Total Quantity
 *   Row 2+ (index 1+): Data rows
 *
 * The parser auto-detects column positions from the header row so the columns
 * can be in any order and extra columns are safely ignored.
 */
function parseFlatDailySchedule(ws: XLSX.WorkSheet): ImportRecord[] {
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
  const results: ImportRecord[] = [];

  // --- Step 1: Find the header row (first row whose cells contain recognizable column names) ---
  const headerKeywords: Record<string, string[]> = {
    toyName:      ['toy name', 'toyname', 'toy'],
    masterCarton: ['master carton', 'mastercarton', 'master'],
    partNumber:   ['part number', 'partnumber', 'part no', 'partno', 'item code', 'itemcode'],
    date:         ['date'],
    shift1:       ['shift 1', 'shift1'],
    shift2:       ['shift 2', 'shift2'],
    shift3:       ['shift 3', 'shift3'],
  };

  let headerRowIdx = -1;
  const colMap: Record<string, number> = {};

  for (let r = 0; r <= Math.min(5, range.e.r); r++) {
    const foundCols: Record<string, number> = {};
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (!cell || cell.v == null) continue;
      const text = String(cell.v).trim().toLowerCase();
      for (const [key, keywords] of Object.entries(headerKeywords)) {
        if (keywords.some(kw => text === kw || text.startsWith(kw))) {
          foundCols[key] = c;
        }
      }
    }
    // Consider this a valid header row if we find at least date + one shift
    if (foundCols.date !== undefined && (foundCols.shift1 !== undefined || foundCols.shift2 !== undefined)) {
      headerRowIdx = r;
      Object.assign(colMap, foundCols);
      break;
    }
  }

  if (headerRowIdx === -1) return results; // Not a flat-format sheet

  // --- Step 2: Parse data rows ---
  let idCounter = 0;
  for (let r = headerRowIdx + 1; r <= range.e.r; r++) {
    const getCellVal = (colKey: string): string => {
      if (colMap[colKey] === undefined) return '';
      const cell = ws[XLSX.utils.encode_cell({ r, c: colMap[colKey] })];
      return cell && cell.v != null ? String(cell.v).trim() : '';
    };

    const getCellNum = (colKey: string): number => {
      if (colMap[colKey] === undefined) return 0;
      const cell = ws[XLSX.utils.encode_cell({ r, c: colMap[colKey] })];
      if (!cell || cell.v == null) return 0;
      if (typeof cell.v === 'number') return Math.round(cell.v);
      const cleaned = String(cell.v).replace(/,/g, '').trim();
      const parsed = parseFloat(cleaned);
      return isNaN(parsed) ? 0 : Math.round(parsed);
    };

    const toyName    = getCellVal('toyName');
    const masterCarton = getCellVal('masterCarton');
    const partNumber = getCellVal('partNumber');
    const dateRaw    = getCellVal('date');
    const shift1     = getCellNum('shift1');
    const shift2     = getCellNum('shift2');
    const shift3     = getCellNum('shift3');

    // Skip empty or header-like rows
    if (!partNumber && !masterCarton && !toyName) continue;
    if (dateRaw.toLowerCase() === 'date') continue; // duplicate header

    // Parse date — try numeric serial, then string formats
    let dateStr = '';
    const dateCell = colMap.date !== undefined ? ws[XLSX.utils.encode_cell({ r, c: colMap.date })] : null;
    if (dateCell && typeof dateCell.v === 'number' && dateCell.v > 40000) {
      dateStr = excelSerialToDate(dateCell.v);
    } else if (dateRaw) {
      // Try MM/DD/YYYY or M/D/YYYY
      const slashMatch = dateRaw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
      if (slashMatch) {
        const month = slashMatch[1].padStart(2, '0');
        const day   = slashMatch[2].padStart(2, '0');
        let year    = parseInt(slashMatch[3]);
        if (year < 100) year += 2000;
        dateStr = `${year}-${month}-${day}`;
      } else {
        // Try D-Mon-YY or D-Mon-YYYY
        const monMatch = dateRaw.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/);
        if (monMatch) {
          const day = monMatch[1].padStart(2, '0');
          const monthMap: Record<string, string> = {
            jan:'01', feb:'02', mar:'03', apr:'04', may:'05', jun:'06',
            jul:'07', aug:'08', sep:'09', oct:'10', nov:'11', dec:'12'
          };
          const month = monthMap[monMatch[2].toLowerCase()];
          let year = parseInt(monMatch[3]);
          if (year < 100) year += 2000;
          if (month) dateStr = `${year}-${month}-${day}`;
        } else {
          // Last resort: use JS Date parser
          const d = new Date(dateRaw);
          if (!isNaN(d.getTime())) {
            dateStr = d.toISOString().split('T')[0];
          }
        }
      }
    }

    if (!dateStr) continue; // Can't determine date — skip row

    // Use part number if available, else fall back to master carton code
    const hasPartNumber = partNumber && partNumber !== '0' && partNumber !== '0.0' && partNumber !== '0.00';
    const finalPartNumber = hasPartNumber ? partNumber : masterCarton;
    if (!finalPartNumber) continue;

    // Emit one ImportRecord per shift that has quantity > 0
    const shifts: [number, number][] = [
      [1, shift1],
      [2, shift2],
      [3, shift3],
    ];

    for (const [shiftNum, qty] of shifts) {
      if (qty > 0) {
        idCounter++;
        results.push({
          id: `flat-${idCounter}`,
          toyName,
          masterCarton,
          partNumber: finalPartNumber,
          date: dateStr,
          shift: shiftNum,
          quantity: qty,
        });
      }
    }
  }

  return results;
}

/**
 * Parse the DailySchedule.xlsx file with the actual format from the uploaded file.
 * 
 * Layout Structure (based on the actual Excel file):
 *   Row 1: Contains date headers (14-Jun-26, 15-Jun-26, etc.)
 *   Row 2: Contains shift sub-headers (Shift 1, Shift 2, Shift 3 under each date)
 *   Row 3+: Data rows with:
 *     - Column A: "ND" (ignored as requested)
 *     - Column B: Toy name OR Master Carton code
 *     - Column C: Part number (when col B is master carton)
 *     - Columns D+: Quantity data for each shift/date combination
 * 
 * Detection logic:
 *   - If col B contains no hyphen and col C is empty/different → Toy Name
 *   - If col B contains hyphen → Master Carton, col C is Part Number
 */
function parseFAAttachSheet(ws: XLSX.WorkSheet): ImportRecord[] {
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
  const results: ImportRecord[] = [];

  console.log(`📊 Parsing Excel file with range: ${ws['!ref']}`);

  // Step 1: Find date headers in the first few rows
  const dateHeaderRow = 1; // Assuming dates are in row 2 (0-indexed = 1)
  const shiftHeaderRow = 2; // Assuming shift headers are in row 3 (0-indexed = 2)
  const dataStartRow = 3; // Data starts from row 4 (0-indexed = 3)

  // Step 2: Extract date and shift columns
  const shiftColumns: { col: number; date: string; shiftNum: number }[] = [];
  
  for (let c = 4; c <= range.e.c; c++) { // Start from column E (index 4)
    // Check for date in the date header row
    const dateCell = ws[XLSX.utils.encode_cell({ r: dateHeaderRow, c })];
    let dateStr = '';
    
    if (dateCell && dateCell.v != null) {
      if (typeof dateCell.v === 'number' && dateCell.v > 40000) {
        dateStr = excelSerialToDate(dateCell.v);
      } else if (typeof dateCell.v === 'string') {
        const trimmed = dateCell.v.trim();
        // Handle various date formats
        if (trimmed.match(/^\d{1,2}-[A-Za-z]{3}-\d{2,4}$/) || trimmed.match(/^\d{1,2}\/\d{1,2}\/\d{2,4}$/)) {
          const d = new Date(trimmed);
          if (!isNaN(d.getTime())) {
            const year = d.getFullYear();
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            dateStr = `${year}-${month}-${day}`;
          }
        } else {
          // Try to parse other formats like "14-Jun-26"
          const dateMatch = trimmed.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/);
          if (dateMatch) {
            const day = dateMatch[1].padStart(2, '0');
            const monthName = dateMatch[2].toLowerCase();
            let year = parseInt(dateMatch[3]);
            if (year < 100) year += 2000; // Convert 26 to 2026
            
            const monthMap: Record<string, string> = {
              jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
              jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
            };
            const month = monthMap[monthName];
            if (month) {
              dateStr = `${year}-${month}-${day}`;
            }
          }
        }
      }
    }

    // Check for shift header
    const shiftCell = ws[XLSX.utils.encode_cell({ r: shiftHeaderRow, c })];
    if (shiftCell && typeof shiftCell.v === 'string') {
      const shiftText = shiftCell.v.trim().toLowerCase();
      let shiftNum = 0;
      if (shiftText.includes('shift 1') || shiftText === 'shift1') shiftNum = 1;
      else if (shiftText.includes('shift 2') || shiftText === 'shift2') shiftNum = 2;
      else if (shiftText.includes('shift 3') || shiftText === 'shift3') shiftNum = 3;
      
      if (shiftNum > 0) {
        // If we have a date for this column, use it; otherwise use the most recent date
        let finalDate = dateStr;
        if (!finalDate) {
          // Look backwards to find the most recent date
          for (let prevC = c - 1; prevC >= 4; prevC--) {
            const prevDateCell = ws[XLSX.utils.encode_cell({ r: dateHeaderRow, c: prevC })];
            if (prevDateCell && prevDateCell.v != null) {
              if (typeof prevDateCell.v === 'number' && prevDateCell.v > 40000) {
                finalDate = excelSerialToDate(prevDateCell.v);
                break;
              } else if (typeof prevDateCell.v === 'string') {
                const trimmed = prevDateCell.v.trim();
                const dateMatch = trimmed.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/);
                if (dateMatch) {
                  const day = dateMatch[1].padStart(2, '0');
                  const monthName = dateMatch[2].toLowerCase();
                  let year = parseInt(dateMatch[3]);
                  if (year < 100) year += 2000;
                  
                  const monthMap: Record<string, string> = {
                    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
                    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
                  };
                  const month = monthMap[monthName];
                  if (month) {
                    finalDate = `${year}-${month}-${day}`;
                    break;
                  }
                }
              }
            }
          }
        }
        
        if (finalDate) {
          shiftColumns.push({ col: c, date: finalDate, shiftNum });
        }
      }
    }
  }

  if (shiftColumns.length === 0) {
    return results;
  }

  // Step 3: Parse data rows
  let currentToyName = '';
  let idCounter = 0;

  for (let r = dataStartRow; r <= range.e.r; r++) {
    const cellB = ws[XLSX.utils.encode_cell({ r, c: 1 })]; // Column B
    const cellC = ws[XLSX.utils.encode_cell({ r, c: 3 })]; // Column D (Part Number is at index 3)

    const colBVal = cellB && cellB.v != null ? String(cellB.v).trim() : '';
    const colCVal = cellC && cellC.v != null ? String(cellC.v).trim() : '';

    // Skip empty rows
    if (!colBVal) continue;

    // Skip total rows
    if (colBVal.toLowerCase().includes('total')) continue;

    // Collect quantities for this row
    const rowQtys: { shiftCol: number; rawQty: number; rawText: string }[] = [];
    let totalRawQty = 0;
    
    for (const sc of shiftColumns) {
      let qty = 0;
      let rawText = '';
      const qtyCell = ws[XLSX.utils.encode_cell({ r, c: sc.col })];
      if (qtyCell && qtyCell.v != null) {
        // Capture the formatted text before numeric parsing
        rawText = qtyCell.w || String(qtyCell.v);
        if (typeof qtyCell.v === 'number') {
          qty = qtyCell.v;
        } else if (typeof qtyCell.v === 'string') {
          const cleaned = qtyCell.v.replace(/,/g, '').trim();
          const parsed = parseFloat(cleaned);
          if (!isNaN(parsed)) qty = parsed;
        }
      }
      rowQtys.push({ shiftCol: sc.col, rawQty: qty, rawText });
      totalRawQty += qty;
    }

    // Determine if this is a toy name row or data row
    const colBHasHyphen = colBVal.includes('-');
    
    if (!colBHasHyphen && totalRawQty === 0) {
      // This is a toy name row
      currentToyName = colBVal;
    } else if (colBHasHyphen) {
      // This is a data row - col B is master carton, col C is part number
      const masterCarton = colBVal;
      const hasPartNumber = colCVal && colCVal !== '0' && colCVal !== '0.0' && colCVal !== '0.00';
      const partNumber = hasPartNumber ? colCVal : masterCarton; // Fallback to master carton if no part number

      // Create records for each shift with quantity > 0
      for (const rq of rowQtys) {
        if (rq.rawQty > 0) {
          const sc = shiftColumns.find(s => s.col === rq.shiftCol)!;
          idCounter++;

          let finalQty = rq.rawQty;
          
          // Excel stores quantities with dot as thousands separator (e.g. 3.000 = 3000, 1.288 = 1288)
          // When JS parses "3.000" it becomes the number 3, and "1.288" becomes 1.288
          // Detect this by checking if the raw cell text matches pattern X.XXX (dot + exactly 3 digits)
          if (/^\d+\.\d{3}$/.test(rq.rawText.trim())) {
            finalQty = Math.round(finalQty * 1000);
          } else {
            finalQty = Math.round(finalQty);
          }
          
          results.push({
            id: `import-${idCounter}`,
            toyName: currentToyName,
            masterCarton,
            partNumber: partNumber,
            date: sc.date,
            shift: sc.shiftNum,
            quantity: finalQty,
          });
        }
      }
    }
  }

  return results;
}

export function DailySchedule() {
  const { t, locale } = useTranslation();
  const { canEdit } = useAuthStore();
  // Production Planner & Admin boleh edit; Material Planner / User view-only.
  const isAdmin = canEdit('production');
  
  const [filterDate, setFilterDate] = useState(() => {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  });
  const [showForm, setShowForm] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importData, setImportData] = useState<ImportRecord[]>([]);
  const [importSearch, setImportSearch] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterShift, setFilterShift] = useState('');
  
  const { data: scheduleData, isLoading: loadingSchedules } = useDailySchedules(filterDate || undefined);
  const { data: itemsData } = useItems();
  const { data: mcData } = useMasterCartons();
  const upsertSchedule = useUpsertDailySchedule();
  const bulkUpsertSchedule = useBulkUpsertDailySchedule();
  const bulkDeleteSchedule = useBulkDeleteDailySchedule();

  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const [formData, setFormData] = useState({
    date: new Date().toISOString().split('T')[0],
    shift: 1,
    partNumber: '',
    toyName: '',
    masterCarton: '',
    quantity: 100,
  });

  const schedules = scheduleData?.data || [];
  const items = itemsData?.data || [];
  const masterCartons = mcData?.data || [];

  const filteredSchedules = (() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const filtered = schedules.filter(s => {
      if (filterShift && s.shift !== Number(filterShift)) return false;
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
            return s.item.partNumber.toLowerCase().includes(q) ||
              s.item.itemName.toLowerCase().includes(q) ||
             (s.toyName && s.toyName.toLowerCase().includes(q)) ||
             (s.masterCarton && s.masterCarton.toLowerCase().includes(q)) ||
             s.date.toLowerCase().includes(q) ||
             `shift ${s.shift}`.toLowerCase().includes(q) ||
             String(s.quantity).toLowerCase().includes(q);
    });
    const future = filtered.filter(s => new Date(s.date) >= today);
    const past = filtered.filter(s => new Date(s.date) < today);
    return [...future, ...past];
  })();

  const groupedSchedules = useMemo(() => {
    const groups: Record<string, any> = {};
    for (const schedule of filteredSchedules) {
      const dateStr = typeof schedule.date === 'string' ? schedule.date.split('T')[0] : new Date(schedule.date).toISOString().split('T')[0];
      const key = `${dateStr}_${schedule.item.partNumber}_${schedule.masterCarton || ''}`;
      if (!groups[key]) {
        groups[key] = {
          id: key,
          date: dateStr,
          partNumber: schedule.item.partNumber,
          toyName: schedule.toyName || schedule.item.itemName,
          masterCarton: schedule.masterCarton || '-',
          shift1: { id: null, quantity: 0 },
          shift2: { id: null, quantity: 0 },
          shift3: { id: null, quantity: 0 },
          total: 0,
          ids: [],
        };
      }
      if (schedule.shift === 1) groups[key].shift1 = { id: schedule.id, quantity: schedule.quantity };
      else if (schedule.shift === 2) groups[key].shift2 = { id: schedule.id, quantity: schedule.quantity };
      else if (schedule.shift === 3) groups[key].shift3 = { id: schedule.id, quantity: schedule.quantity };
      
      groups[key].total += schedule.quantity;
      groups[key].ids.push(schedule.id);
    }
    return Object.values(groups).sort((a: any, b: any) => a.date.localeCompare(b.date));
  }, [filteredSchedules]);

  const [editModal, setEditModal] = useState<{ isOpen: boolean; data: any }>({
    isOpen: false,
    data: null,
  });

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editModal.data) return;
    try {
      const records = [];
      if (editModal.data.shift1Qty > 0) records.push({ date: editModal.data.date, shift: 1, itemCode: editModal.data.partNumber, toyName: editModal.data.toyName, masterCarton: editModal.data.masterCarton === '-' ? '' : editModal.data.masterCarton, quantity: editModal.data.shift1Qty });
      if (editModal.data.shift2Qty > 0) records.push({ date: editModal.data.date, shift: 2, itemCode: editModal.data.partNumber, toyName: editModal.data.toyName, masterCarton: editModal.data.masterCarton === '-' ? '' : editModal.data.masterCarton, quantity: editModal.data.shift2Qty });
      if (editModal.data.shift3Qty > 0) records.push({ date: editModal.data.date, shift: 3, itemCode: editModal.data.partNumber, toyName: editModal.data.toyName, masterCarton: editModal.data.masterCarton === '-' ? '' : editModal.data.masterCarton, quantity: editModal.data.shift3Qty });

      if (editModal.data.ids && editModal.data.ids.length > 0) {
        await bulkDeleteSchedule.mutateAsync({ ids: editModal.data.ids });
      }
      if (records.length > 0) {
        await bulkUpsertSchedule.mutateAsync({ records, saveMode: 'add' });
      }
      setEditModal({ isOpen: false, data: null });
    } catch (err: any) {
      alert(err.message || t('dailySchedule.failedUpdate'));
    }
  };

  const handleDelete = async (ids: string[]) => {
    if (!confirm(t('dailySchedule.confirmDeleteOne'))) return;
    try {
      await bulkDeleteSchedule.mutateAsync({ ids });
    } catch (err: any) {
      alert(err.message || t('dailySchedule.failedDelete'));
    }
  };

  const handleDeleteSelected = async () => {
    if (selectedIds.length === 0) return;
    if (!confirm(t('dailySchedule.confirmDeleteMany', { count: selectedIds.length }))) return;
    try {
      await bulkDeleteSchedule.mutateAsync({ ids: selectedIds });
      setSelectedIds([]);
    } catch (err: any) {
      alert(err.message || t('dailySchedule.failedDeleteRecords'));
    }
  };

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      const newIds = new Set([...selectedIds, ...filteredSchedules.map(s => s.id)]);
      setSelectedIds(Array.from(newIds));
    } else {
      const filteredSet = new Set(filteredSchedules.map(s => s.id));
      setSelectedIds(selectedIds.filter(id => !filteredSet.has(id)));
    }
  };
  const allFilteredSelected = filteredSchedules.length > 0 && filteredSchedules.every(s => selectedIds.includes(s.id));

  const handleSubmit = async (e: React.FormEvent, saveMode: 'overwrite' | 'add') => {
    e.preventDefault();
    if (!formData.partNumber) {
      alert(t('dailySchedule.partNumberRequired'));
      return;
    }
    try {
      await bulkUpsertSchedule.mutateAsync({
        records: [{
          date: formData.date,
          shift: Number(formData.shift),
          itemCode: formData.partNumber,
          toyName: formData.toyName,
          masterCarton: formData.masterCarton,
          quantity: Number(formData.quantity),
        }],
        saveMode,
      });
      setShowForm(false);
      setFormData(prev => ({ ...prev, partNumber: '', toyName: '', masterCarton: '', quantity: 100 }));
    } catch (err: any) {
      alert(err.message || t('dailySchedule.failedSave'));
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });

        let parsed: ImportRecord[] = [];

        // Strategy 1: Try every sheet as a flat table (Toy Name | Master Carton | Part Number | Date | Shift 1 | Shift 2 | Shift 3)
        // This covers DailySchedule.xlsx format
        for (const sheetName of wb.SheetNames) {
          const ws = wb.Sheets[sheetName];
          parsed = parseFlatDailySchedule(ws);
          if (parsed.length > 0) {
            console.log(`✅ Flat format detected in sheet "${sheetName}", parsed ${parsed.length} records`);
            break;
          }
        }

        // Strategy 2: Fall back to FA_Attach pivot format (NEXT Week Daily Production Schedule.xlsm)
        if (parsed.length === 0) {
          const faSheet = wb.Sheets['FA_Attach'];
          if (faSheet) {
            parsed = parseFAAttachSheet(faSheet);
            if (parsed.length > 0) {
              console.log(`✅ FA_Attach pivot format detected, parsed ${parsed.length} records`);
            }
          }
        }

        // Strategy 3: Try all sheets with FA_Attach pivot parser as last resort
        if (parsed.length === 0) {
          for (const sheetName of wb.SheetNames) {
            const ws = wb.Sheets[sheetName];
            parsed = parseFAAttachSheet(ws);
            if (parsed.length > 0) {
              console.log(`✅ FA_Attach pivot format detected in sheet "${sheetName}", parsed ${parsed.length} records`);
              break;
            }
          }
        }

        if (parsed.length === 0) {
          alert(t('dailySchedule.parseError'));
          return;
        }

        setImportData(parsed);
      } catch (err) {
        console.error('Excel parse error:', err);
        alert(t('dailySchedule.parseFailed'));
      }
    };
    reader.readAsBinaryString(file);
    e.target.value = '';
  };

  const handleBulkSubmit = async (saveMode: 'overwrite' | 'add') => {
    if (importData.length === 0) return;
    try {
      await bulkUpsertSchedule.mutateAsync({
        records: importData.map(r => ({
          date: r.date,
          shift: r.shift,
          itemCode: r.partNumber,
          toyName: r.toyName,
          masterCarton: r.masterCarton,
          quantity: r.quantity,
        })),
        saveMode,
      });
      setShowImportModal(false);
      setImportData([]);
      alert(t('dailySchedule.importSuccess', { count: importData.length }));
    } catch (err: any) {
      alert(err.message || t('dailySchedule.failedBulkImport'));
    }
  };

  const filteredImportData = importData.filter(d => {
    if (!importSearch) return true;
    const q = importSearch.toLowerCase();
    return d.partNumber.toLowerCase().includes(q) ||
           d.toyName.toLowerCase().includes(q) ||
           (d.masterCarton && d.masterCarton.toLowerCase().includes(q)) ||
           d.date.includes(q);
  });

  const groupedImportData = useMemo(() => {
    const groups: Record<string, any> = {};
    for (const r of filteredImportData) {
      const key = `${r.date}_${r.partNumber}_${r.masterCarton || ''}`;
      if (!groups[key]) {
        groups[key] = {
          id: key,
          date: r.date,
          partNumber: r.partNumber,
          toyName: r.toyName,
          masterCarton: r.masterCarton || '-',
          shift1: { id: null, quantity: 0 },
          shift2: { id: null, quantity: 0 },
          shift3: { id: null, quantity: 0 },
          total: 0,
        };
      }
      if (r.shift === 1) groups[key].shift1 = { id: r.id, quantity: r.quantity };
      else if (r.shift === 2) groups[key].shift2 = { id: r.id, quantity: r.quantity };
      else if (r.shift === 3) groups[key].shift3 = { id: r.id, quantity: r.quantity };
      
      groups[key].total += r.quantity;
    }
    return Object.values(groups).sort((a, b) => a.date.localeCompare(b.date));
  }, [filteredImportData]);

  // Group import data summary
  const importSummary = importData.reduce((acc, r) => {
    acc.totalQty += r.quantity;
    acc.uniqueParts.add(r.partNumber);
    acc.dates.add(r.date);
    return acc;
  }, { totalQty: 0, uniqueParts: new Set<string>(), dates: new Set<string>() });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">{t('dailySchedule.title')}</h2>
          <p className="text-muted-foreground text-sm">{t('dailySchedule.subtitle')}</p>
        </div>
        <div className="flex items-center gap-3">
          <input 
            type="date" 
            className="h-10 px-3 py-2 border rounded-md text-sm bg-background"
            value={filterDate}
            onChange={(e) => setFilterDate(e.target.value)}
          />
          {isAdmin && (
            <button 
              onClick={() => setShowImportModal(true)}
              className="bg-secondary text-secondary-foreground border hover:bg-secondary/80 px-4 py-2 rounded-md font-medium text-sm flex items-center space-x-2 transition-colors"
            >
              <Upload size={16} />
              <span>{t('dailySchedule.importData')}</span>
            </button>
          )}
          {isAdmin && (
            <button 
              onClick={() => setShowForm(!showForm)}
              className="bg-primary text-primary-foreground hover:bg-primary/90 px-4 py-2 rounded-md font-medium text-sm flex items-center space-x-2 transition-colors"
            >
              <Plus size={16} />
              <span>{t('dailySchedule.addDemand')}</span>
            </button>
          )}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-card text-card-foreground border rounded-lg p-6 shadow-sm flex justify-between items-start">
          <div className="space-y-2">
            <p className="text-sm font-medium text-muted-foreground">{t('dailySchedule.runningItems')}</p>
            <h3 className="text-3xl font-bold tracking-tight text-blue-600 dark:text-blue-400">
              {groupedSchedules.length}
            </h3>
            <p className="text-xs text-muted-foreground">
              {t('dailySchedule.runningItemsDesc')}
            </p>
          </div>
          <div className="p-2 bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400 rounded-md">
            <Layers size={20} />
          </div>
        </div>

        <div className="bg-card text-card-foreground border rounded-lg p-6 shadow-sm flex justify-between items-start">
          <div className="space-y-2">
            <p className="text-sm font-medium text-muted-foreground">{t('dailySchedule.totalDemandQty')}</p>
            <h3 className="text-3xl font-bold tracking-tight text-green-600 dark:text-green-400">
              {groupedSchedules.reduce((acc, g) => acc + g.total, 0).toLocaleString(locale)}
            </h3>
            <p className="text-xs text-muted-foreground">
              {t('dailySchedule.totalDemandQtyDesc')}
            </p>
          </div>
          <div className="p-2 bg-green-50 dark:bg-green-950 text-green-600 dark:text-green-400 rounded-md">
            <Package size={20} />
          </div>
        </div>

        <div className="bg-card text-card-foreground border rounded-lg p-6 shadow-sm flex justify-between items-start">
          <div className="space-y-2 w-full">
            <p className="text-sm font-medium text-muted-foreground">{t('dailySchedule.shiftBreakdown')}</p>
            <div className="flex justify-between items-center pt-1">
              <div>
                <span className="text-xs text-muted-foreground block">{t('dailySchedule.shift1')}</span>
                <span className="text-lg font-bold text-red-500">
                  {groupedSchedules.reduce((acc, g) => acc + g.shift1.quantity, 0).toLocaleString(locale)}
                </span>
              </div>
              <div className="border-l h-8 mx-2" />
              <div>
                <span className="text-xs text-muted-foreground block">{t('dailySchedule.shift2')}</span>
                <span className="text-lg font-bold text-red-500">
                  {groupedSchedules.reduce((acc, g) => acc + g.shift2.quantity, 0).toLocaleString(locale)}
                </span>
              </div>
              <div className="border-l h-8 mx-2" />
              <div>
                <span className="text-xs text-muted-foreground block">{t('dailySchedule.shift3')}</span>
                <span className="text-lg font-bold text-red-500">
                  {groupedSchedules.reduce((acc, g) => acc + g.shift3.quantity, 0).toLocaleString(locale)}
                </span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {t('dailySchedule.shiftBreakdownDesc')}
            </p>
          </div>
          <div className="p-2 bg-red-50 dark:bg-red-950 text-red-500 rounded-md self-start">
            <Clock size={20} />
          </div>
        </div>
      </div>

      {showForm && (
        <div className="bg-card text-card-foreground border rounded-lg p-6 shadow-sm">
          <h3 className="font-semibold mb-4 flex items-center gap-2">
            <Calendar size={18} /> {t('dailySchedule.recordSchedule')}
          </h3>
          <p className="text-xs text-muted-foreground mb-4">{t('dailySchedule.recordNote')}</p>
          
          <form className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4 items-end">
            <div className="space-y-2">
              <label className="text-sm font-medium">{t('dailySchedule.toyName')}</label>
              <SearchableSelect
                options={items.filter((item: any) => item.itemCode !== item.itemName).map((item: any) => ({ value: item.itemName, label: item.itemName }))}
                value={formData.toyName}
                onChange={val => setFormData({...formData, toyName: val})}
                onAdd={(search) => setFormData({...formData, toyName: search})}
                placeholder={t('dailySchedule.selectOrEnterToyName')}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">{t('dailySchedule.masterCarton')}</label>
              <SearchableSelect
                options={masterCartons.map((mc: any) => ({ value: mc.cartonCode, label: mc.cartonCode }))}
                value={formData.masterCarton}
                onChange={val => {
                  const mc = masterCartons.find((m: any) => m.cartonCode === val);
                  if (mc) {
                    const matchedToy = items.find((i: any) => i.id === mc.toyNameItemId);
                    setFormData({...formData, masterCarton: val, partNumber: mc.partNumberCode, toyName: matchedToy ? matchedToy.itemName : formData.toyName});
                  } else {
                    setFormData({...formData, masterCarton: val});
                  }
                }}
                onAdd={(search) => setFormData({...formData, masterCarton: search})}
                placeholder={t('dailySchedule.selectOrEnterMasterCarton')}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">{t('dailySchedule.partNumber')}</label>
              <SearchableSelect
                options={items.map((item: any) => ({ value: item.itemCode, label: item.itemCode }))}
                value={formData.partNumber}
                onChange={val => setFormData({...formData, partNumber: val})}
                onAdd={(search) => setFormData({...formData, partNumber: search})}
                placeholder={t('dailySchedule.selectOrEnterPartNumber')}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">{t('common.date')}</label>
              <input 
                type="date" required
                className="w-full h-10 px-3 border rounded-md bg-background"
                value={formData.date} onChange={e => setFormData({...formData, date: e.target.value})}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">{t('dailySchedule.shift')}</label>
              <select 
                className="w-full h-10 px-3 border rounded-md bg-background"
                value={formData.shift} onChange={e => setFormData({...formData, shift: Number(e.target.value)})}
              >
                <option value={1}>{t('dailySchedule.shift1')}</option>
                <option value={2}>{t('dailySchedule.shift2')}</option>
                <option value={3}>{t('dailySchedule.shift3')}</option>
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">{t('dailySchedule.quantityRequired')}</label>
              <input 
                type="number" required min="1"
                className="w-full h-10 px-3 border rounded-md bg-background"
                value={formData.quantity} onChange={e => setFormData({...formData, quantity: Number(e.target.value)})}
              />
            </div>
            
            <div className="md:col-span-2 lg:col-span-6 flex justify-end gap-3 mt-4">
              <button type="button" onClick={() => setShowForm(false)} className="h-10 border px-6 rounded-md font-medium hover:bg-muted transition-colors">{t('common.cancel')}</button>
              <button 
                type="button" 
                onClick={(e) => handleSubmit(e, 'add')} 
                disabled={upsertSchedule.isPending} 
                className="h-10 bg-green-600 hover:bg-green-700 text-white px-6 rounded-md font-medium flex items-center gap-2 transition-colors"
              >
                <Plus size={16} /> {upsertSchedule.isPending ? t('dailySchedule.saving') : t('dailySchedule.saveAdd')}
              </button>
              <button 
                type="button" 
                onClick={(e) => handleSubmit(e, 'overwrite')} 
                disabled={upsertSchedule.isPending} 
                className="h-10 bg-primary text-primary-foreground hover:bg-primary/90 px-6 rounded-md font-medium flex items-center gap-2 transition-colors"
              >
                <Save size={16} /> {upsertSchedule.isPending ? t('dailySchedule.saving') : t('dailySchedule.saveOverwrite')}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="bg-card text-card-foreground border rounded-lg shadow-sm overflow-hidden">
        <div className="p-4 border-b bg-muted/10 flex flex-wrap items-center gap-3">
          {isAdmin && selectedIds.length > 0 && (
            <button 
              onClick={handleDeleteSelected}
              disabled={bulkDeleteSchedule.isPending}
              className="bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded-md font-medium text-sm flex items-center space-x-2 transition-colors mr-2"
            >
              <Trash2 size={16} />
              <span>{t('dailySchedule.deleteSelected', { count: selectedIds.length })}</span>
            </button>
          )}
          <div className="relative max-w-sm flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
            <input 
              type="text"
              placeholder={t('dailySchedule.searchPlaceholder')}
              className="w-full h-9 pl-9 pr-3 border rounded-md bg-background text-sm"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <select
            className="h-9 px-3 border rounded-md bg-background text-sm min-w-[130px]"
            value={filterShift}
            onChange={(e) => setFilterShift(e.target.value)}
          >
            <option value="">{t('dailySchedule.allShifts')}</option>
            <option value="1">{t('dailySchedule.shift1')}</option>
            <option value="2">{t('dailySchedule.shift2')}</option>
            <option value="3">{t('dailySchedule.shift3')}</option>
          </select>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-secondary/50 text-muted-foreground uppercase text-xs font-medium">
              <tr>
                {isAdmin && (
                  <th className="px-6 py-3 w-12 text-center">
                    <input type="checkbox" checked={allFilteredSelected} onChange={handleSelectAll} className="rounded border-gray-300" />
                  </th>
                )}
                <th className="px-6 py-3">{t('dailySchedule.toyName')}</th>
                <th className="px-6 py-3">{t('dailySchedule.masterCarton')}</th>
                <th className="px-6 py-3">{t('dailySchedule.partNumber')}</th>
                <th className="px-6 py-3">{t('common.date')}</th>
                <th className="px-6 py-3 text-right">{t('dailySchedule.shift1')}</th>
                <th className="px-6 py-3 text-right">{t('dailySchedule.shift2')}</th>
                <th className="px-6 py-3 text-right">{t('dailySchedule.shift3')}</th>
                <th className="px-6 py-3 text-right">{t('dailySchedule.targetDemand')}</th>
                {isAdmin && <th className="px-6 py-3 text-center">{t('common.actions')}</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loadingSchedules ? (
                <tr><td colSpan={isAdmin ? 10 : 8} className="p-8 text-center">{t('common.loading')}</td></tr>
              ) : groupedSchedules.length === 0 ? (
                <tr><td colSpan={isAdmin ? 10 : 8} className="p-8 text-center text-muted-foreground">{t('dailySchedule.noDemand')}</td></tr>
              ) : (
                groupedSchedules.map((group: any) => (
                  <tr key={group.id} className="hover:bg-muted/50 transition-colors">
                    {isAdmin && (
                      <td className="px-6 py-4 text-center">
                        <input 
                          type="checkbox" 
                          checked={group.ids.length > 0 && group.ids.every((id: string) => selectedIds.includes(id))} 
                          onChange={(e) => {
                            if (e.target.checked) {
                              const newIds = new Set([...selectedIds, ...group.ids]);
                              setSelectedIds(Array.from(newIds));
                            } else {
                              setSelectedIds(selectedIds.filter(id => !group.ids.includes(id)));
                            }
                          }} 
                          className="rounded border-gray-300"
                        />
                      </td>
                    )}
                    <td className="px-6 py-4 text-sm text-muted-foreground max-w-[200px] truncate" title={group.toyName}>{group.toyName}</td>
                    <td className="px-6 py-4 text-sm font-medium text-blue-600">{group.masterCarton}</td>
                    <td className="px-6 py-4 font-medium">{group.partNumber === group.masterCarton ? '' : group.partNumber}</td>
                    <td className="px-6 py-4 text-sm">{group.date}</td>
                    <td className="px-6 py-4 text-sm text-right font-bold text-red-500">{group.shift1.quantity > 0 ? group.shift1.quantity : '-'}</td>
                    <td className="px-6 py-4 text-sm text-right font-bold text-red-500">{group.shift2.quantity > 0 ? group.shift2.quantity : '-'}</td>
                    <td className="px-6 py-4 text-sm text-right font-bold text-red-500">{group.shift3.quantity > 0 ? group.shift3.quantity : '-'}</td>
                    <td className="px-6 py-4 text-right font-medium text-slate-700 dark:text-slate-300">{group.total}</td>
                    {isAdmin && (
                      <td className="px-6 py-4 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => setEditModal({
                              isOpen: true,
                              data: {
                                ids: group.ids,
                                date: group.date,
                                partNumber: group.partNumber,
                                toyName: group.toyName,
                                masterCarton: group.masterCarton,
                                shift1Qty: group.shift1.quantity,
                                shift2Qty: group.shift2.quantity,
                                shift3Qty: group.shift3.quantity,
                              }
                            })}
                            className="p-1.5 text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-950 rounded-md transition-colors"
                            title={t('dailySchedule.editRecord')}
                          >
                            <Edit2 size={16} />
                          </button>
                          <button
                            onClick={() => handleDelete(group.ids)}
                            className="p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-950 rounded-md transition-colors"
                            title={t('dailySchedule.deleteRecord')}
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Import Modal */}
      {showImportModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
          <div className="bg-card text-card-foreground border rounded-lg shadow-lg max-w-5xl w-full max-h-[90vh] flex flex-col">
            <div className="flex justify-between items-center p-6 border-b">
              <h3 className="text-xl font-bold flex items-center gap-2"><Upload size={20} /> {t('dailySchedule.importDailySchedule')}</h3>
              <button onClick={() => { setShowImportModal(false); setImportData([]); }} className="text-muted-foreground hover:text-foreground text-lg">✕</button>
            </div>
            
            <div className="p-6 flex-1 overflow-auto space-y-4">
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  {t('dailySchedule.importHint')}
                </p>
                <ul className="text-xs text-muted-foreground list-disc pl-5 space-y-1">
                  <li><strong>{t('dailySchedule.importFlatLabel')}</strong>{t('dailySchedule.importFlatPrefix')}<em>{t('dailySchedule.importFlatColumns')}</em>{t('dailySchedule.importFlatSuffix')}</li>
                  <li><strong>{t('dailySchedule.importPivotLabel')}</strong>{t('dailySchedule.importPivotDesc')}</li>
                </ul>
                <input 
                  type="file" 
                  accept=".xlsx, .xls, .xlsm, .csv" 
                  onChange={handleFileUpload} 
                  className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-primary/10 file:text-primary hover:file:bg-primary/20 cursor-pointer"
                />
              </div>

              {importData.length > 0 && (
                <>
                  {/* Summary Cards */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="bg-muted/30 rounded-lg p-3 text-center">
                      <div className="text-2xl font-bold text-primary">{importData.length}</div>
                      <div className="text-xs text-muted-foreground">{t('dailySchedule.totalRecords')}</div>
                    </div>
                    <div className="bg-muted/30 rounded-lg p-3 text-center">
                      <div className="text-2xl font-bold text-green-600">{importSummary.uniqueParts.size}</div>
                      <div className="text-xs text-muted-foreground">{t('dailySchedule.uniqueParts')}</div>
                    </div>
                    <div className="bg-muted/30 rounded-lg p-3 text-center">
                      <div className="text-2xl font-bold text-blue-600">{importSummary.dates.size}</div>
                      <div className="text-xs text-muted-foreground">{t('dailySchedule.days')}</div>
                    </div>
                    <div className="bg-muted/30 rounded-lg p-3 text-center">
                      <div className="text-2xl font-bold text-orange-600">{Math.round(importSummary.totalQty * 100) / 100}</div>
                      <div className="text-xs text-muted-foreground">{t('dailySchedule.totalQuantity')}</div>
                    </div>
                  </div>

                  {/* Search */}
                  <div className="flex justify-between items-center">
                    <span className="font-medium text-sm">{t('dailySchedule.recordsShown', { shown: filteredImportData.length, total: importData.length })}</span>
                    <div className="relative w-72">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
                      <input 
                        type="text" 
                        placeholder={t('dailySchedule.importSearchPlaceholder')} 
                        className="w-full h-9 pl-9 pr-4 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
                        value={importSearch}
                        onChange={e => setImportSearch(e.target.value)}
                      />
                    </div>
                  </div>

                  {/* Table */}
                  <div className="border rounded-md overflow-hidden max-h-[45vh] overflow-y-auto">
                    <table className="w-full text-sm text-left">
                      <thead className="bg-muted text-muted-foreground text-xs uppercase font-medium sticky top-0">
                        <tr>
                          <th className="px-4 py-3">{t('dailySchedule.toyName')}</th>
                          <th className="px-4 py-3">{t('dailySchedule.masterCarton')}</th>
                          <th className="px-4 py-3">{t('dailySchedule.partNumber')}</th>
                          <th className="px-4 py-3">{t('common.date')}</th>
                          <th className="px-4 py-3 text-right">{t('dailySchedule.shift1')}</th>
                          <th className="px-4 py-3 text-right">{t('dailySchedule.shift2')}</th>
                          <th className="px-4 py-3 text-right">{t('dailySchedule.shift3')}</th>
                          <th className="px-4 py-3 text-right">{t('dailySchedule.targetDemand')}</th>
                          <th className="px-4 py-3 text-center w-16">{t('common.action')}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {groupedImportData.map((group: any) => {
                          const updateImportQty = (shift: number, qty: number) => {
                            const newData = [...importData];
                            const idx = newData.findIndex(r => r.date === group.date && r.partNumber === group.partNumber && r.shift === shift && (r.masterCarton || '-') === group.masterCarton);
                            if (idx >= 0) {
                              if (qty === 0) newData.splice(idx, 1);
                              else newData[idx] = { ...newData[idx], quantity: qty };
                            } else if (qty > 0) {
                              newData.push({
                                  id: `manual-${Date.now()}-${shift}`,
                                  toyName: group.toyName,
                                  masterCarton: group.masterCarton === '-' ? '' : group.masterCarton,
                                  partNumber: group.partNumber,
                                  date: group.date,
                                shift,
                                quantity: qty
                              });
                            }
                            setImportData(newData);
                          };
                          
                          return (
                            <tr key={group.id} className="hover:bg-muted/50">
                              <td className="px-4 py-2 text-xs text-muted-foreground max-w-[160px] truncate" title={group.toyName}>{group.toyName || '-'}</td>
                              <td className="px-4 py-2 text-sm font-medium text-blue-600">{group.masterCarton || '-'}</td>
                              <td className="px-4 py-2 font-medium">{group.partNumber === group.masterCarton ? '' : group.partNumber}</td>
                              <td className="px-4 py-2 text-xs">{group.date}</td>
                              <td className="px-4 py-2 text-right">
                                <input type="number" min="0" className="w-16 h-8 px-1 border rounded text-right bg-background" value={group.shift1.quantity || 0} onChange={e => updateImportQty(1, Number(e.target.value))} />
                              </td>
                              <td className="px-4 py-2 text-right">
                                <input type="number" min="0" className="w-16 h-8 px-1 border rounded text-right bg-background" value={group.shift2.quantity || 0} onChange={e => updateImportQty(2, Number(e.target.value))} />
                              </td>
                              <td className="px-4 py-2 text-right">
                                <input type="number" min="0" className="w-16 h-8 px-1 border rounded text-right bg-background" value={group.shift3.quantity || 0} onChange={e => updateImportQty(3, Number(e.target.value))} />
                              </td>
                              <td className="px-4 py-2 text-right font-medium text-slate-700 dark:text-slate-300">{group.total}</td>
                              <td className="px-4 py-2 text-center">
                                <button 
                                  onClick={() => {
                                    const toDelete = new Set([group.shift1.id, group.shift2.id, group.shift3.id].filter(Boolean));
                                    setImportData(importData.filter(r => !toDelete.has(r.id)));
                                  }}
                                  className="p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-950 rounded-md transition-colors"
                                  title={t('dailySchedule.deleteRecord')}
                                >
                                  <Trash2 size={16} />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
            
            <div className="p-6 border-t flex justify-end gap-3 bg-muted/10">
              <button 
                onClick={() => { setShowImportModal(false); setImportData([]); }}
                className="h-10 border px-6 rounded-md font-medium hover:bg-muted text-sm transition-colors"
              >
                {t('common.cancel')}
              </button>
              <button 
                onClick={() => handleBulkSubmit('add')} 
                disabled={bulkUpsertSchedule.isPending || importData.length === 0} 
                className="h-10 bg-green-600 hover:bg-green-700 text-white px-6 rounded-md font-medium flex items-center gap-2 disabled:opacity-50 text-sm transition-colors"
              >
                <Plus size={16} /> {bulkUpsertSchedule.isPending ? t('dailySchedule.saving') : t('dailySchedule.saveAddParen')}
              </button>
              <button 
                onClick={() => handleBulkSubmit('overwrite')} 
                disabled={bulkUpsertSchedule.isPending || importData.length === 0} 
                className="h-10 bg-slate-900 dark:bg-slate-800 hover:bg-slate-800 dark:hover:bg-slate-700 text-white px-6 rounded-md font-medium flex items-center gap-2 disabled:opacity-50 text-sm transition-colors"
              >
                <Save size={16} /> {bulkUpsertSchedule.isPending ? t('dailySchedule.saving') : t('dailySchedule.saveOverwrite')}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Edit Modal */}
      {editModal.isOpen && editModal.data && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
          <div className="bg-card text-card-foreground border rounded-lg shadow-lg max-w-md w-full p-6 space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-bold">{t('dailySchedule.editDailySchedule')}</h3>
              <button 
                type="button" 
                onClick={() => setEditModal({ isOpen: false, data: null })}
                className="text-muted-foreground hover:text-foreground text-sm"
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleEditSubmit} className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-muted-foreground">{t('dailySchedule.partNumber')}</label>
                <div className="font-semibold">
                  {editModal.data.partNumber === editModal.data.masterCarton ? '' : `${editModal.data.partNumber} - `}
                  {editModal.data.toyName}
                </div>
                <div className="text-sm text-muted-foreground">{t('dailySchedule.dateValue', { date: editModal.data.date })}</div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">{t('dailySchedule.shift1')}</label>
                  <input 
                    type="number" min="0"
                    className="w-full h-10 px-3 border rounded-md bg-background"
                    value={editModal.data.shift1Qty} onChange={e => setEditModal(prev => ({...prev, data: {...prev.data, shift1Qty: Number(e.target.value)}}))}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">{t('dailySchedule.shift2')}</label>
                  <input 
                    type="number" min="0"
                    className="w-full h-10 px-3 border rounded-md bg-background"
                    value={editModal.data.shift2Qty} onChange={e => setEditModal(prev => ({...prev, data: {...prev.data, shift2Qty: Number(e.target.value)}}))}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">{t('dailySchedule.shift3')}</label>
                  <input 
                    type="number" min="0"
                    className="w-full h-10 px-3 border rounded-md bg-background"
                    value={editModal.data.shift3Qty} onChange={e => setEditModal(prev => ({...prev, data: {...prev.data, shift3Qty: Number(e.target.value)}}))}
                  />
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <button type="button" onClick={() => setEditModal({ isOpen: false, data: null })} className="h-10 border px-4 rounded-md font-medium hover:bg-muted transition-colors">{t('common.cancel')}</button>
                <button type="submit" disabled={bulkUpsertSchedule.isPending} className="h-10 bg-primary text-primary-foreground hover:bg-primary/90 px-4 rounded-md font-medium flex items-center gap-2 transition-colors">
                  <Save size={16} /> {bulkUpsertSchedule.isPending ? t('dailySchedule.saving') : t('dailySchedule.saveChanges')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
