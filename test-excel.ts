import * as xlsx from 'xlsx';
import * as fs from 'fs';

const buffer = fs.readFileSync('../../HOTLIST.xlsm');
const workbook = xlsx.read(buffer, { type: 'buffer' });
const sheetName = workbook.SheetNames[0];
const sheet = workbook.Sheets[sheetName];

const rows = xlsx.utils.sheet_to_json(sheet, { header: 1 }) as any[][];

console.log('First 10 rows:');
for (let i = 0; i < Math.min(10, rows.length); i++) {
  console.log(`Row ${i}:`, rows[i]);
}
