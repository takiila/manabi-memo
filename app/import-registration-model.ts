import type { ImportPlanRow } from './manabi-import-types';

export function registrationEntries(rows: Pick<ImportPlanRow, 'item' | 'kind'>[], collection: string, selected: string[]) {
  return rows.filter(row => row.item.type === 'course' && (row.kind === 'same' || ((row.kind === 'add' || row.kind === 'update') && selected.includes(row.item.id)))).map(row => ({ collection, item: row.item }));
}

export function displayImportValue(value: unknown, key?: string): string {
  if (value == null || (Array.isArray(value) && !value.length)) return '未確認';
  if (key === 'weekday' && typeof value === 'number' && value >= 1 && value <= 6) return `${['月', '火', '水', '木', '金', '土'][value - 1]}曜日（${value}）`;
  if (key === 'period' && typeof value === 'number' && value >= 1 && value <= 5) return `${value}枠（${['08:40〜10:10', '10:20〜11:50', '12:40〜14:10', '14:20〜15:50', '16:00〜17:30'][value - 1]}）`;
  if (Array.isArray(value)) return value.join('、');
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value}（時刻未確認）`;
  return String(value);
}
