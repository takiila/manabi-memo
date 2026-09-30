import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import schema from '../schema/manabi-memo.schema.json' with { type: 'json' };
import type { ImportItem, ImportItemType, ImportPlanRow, InformationInbox, ManabiImport } from './manabi-import-types';

export const MAX_IMPORT_BYTES = 1024 * 1024;
export const EMPTY_INFORMATION_INBOX: InformationInbox = { version: 1, records: [] };
export const ITEM_LABELS: Record<ImportItemType, string> = {
  event: '予定', deadline: '締切', assignment: '課題', announcement: 'お知らせ', seminar: 'ゼミ配属',
  laboratory: '研究室', teacher: '教員', course: '講義情報', exam: '試験', registration: '申請', document: '資料',
};
const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
addFormats(ajv);
const validate = ajv.compile<ManabiImport>(schema);
const validateTimestamp = ajv.compile({ type: 'string', format: 'date-time', pattern: '(?:Z|[+-][0-9]{2}:[0-9]{2})$' });

export function parseManabiImport(text: string): ManabiImport {
  if (new TextEncoder().encode(text).length > MAX_IMPORT_BYTES) throw new Error('JSONは1MB以内にしてください。');
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error('JSONを解析できません。説明文やコードブロックを除き、JSONだけを貼り付けてください。'); }
  return validateManabiImport(value);
}

function validateManabiImport(value: unknown): ManabiImport {
  if (!validate(value)) {
    const errors = (validate.errors ?? []).filter(error => error.keyword !== 'if').slice(0, 6);
    throw new Error(`形式を確認してください: ${errors.map(error => `${error.instancePath || '/'} ${error.message}`).join(' / ')}`);
  }
  const ids = new Set<string>();
  for (const item of value.items) {
    if (ids.has(item.id)) throw new Error(`idが重複しています: ${item.id}`);
    ids.add(item.id);
    const data = item.data as Record<string, unknown>;
    for (const [key, entry] of Object.entries({ ...data, source_url: item.source.url })) {
      if (typeof entry !== 'string' || !(key === 'url' || key === 'website' || key.endsWith('_url'))) continue;
      const parsed = new URL(entry);
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error(`${item.title}: URLに認証情報や未対応の形式が含まれています。`);
    }
    for (const [startKey, endKey] of [['starts_at', 'ends_at'], ['application_start', 'application_end'], ['opens_at', 'closes_at']]) {
      const start = data[startKey], end = data[endKey];
      if (typeof start !== 'string' || typeof end !== 'string') continue;
      if ((start.length === 10) !== (end.length === 10)) continue;
      if (Date.parse(start) > Date.parse(end)) throw new Error(`${item.title}: ${endKey}が${startKey}より前です。`);
    }
    if (item.type === 'course' && (Boolean(item.data.weekday) !== Boolean(item.data.period))) throw new Error(`${item.title}: 曜日と時限は両方指定するか、両方を不明にしてください。`);
  }
  return structuredClone(value);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(',')}}`;
  return JSON.stringify(value);
}

function identity(collection: string, item: ImportItem) {
  return JSON.stringify([collection, item.type, item.id]);
}

const REQUIRED_FACTS: Partial<Record<ImportItemType, string[]>> = {
  event: ['starts_at'], deadline: ['due_at'], assignment: ['due_at', 'course_code'], seminar: ['academic_year', 'guidance_at', 'application_end', 'selection_method', 'result_at'],
  laboratory: ['teacher_ids', 'selection_method', 'guidance_at'], teacher: ['name'], course: ['code', 'term'], exam: ['starts_at', 'course_code'], registration: ['closes_at', 'procedure'], document: ['url'],
};
export const FIELD_LABELS: Record<string, string> = {
  starts_at: '開始日時', ends_at: '終了日時', due_at: '締切', published_at: '公開日', location: '場所',
  academic_year: '配属年度', guidance_at: 'ガイダンス日時', application_start: '希望受付開始', application_end: '希望受付締切', selection_method: '選抜方法', result_at: '結果発表', capacity: '定員',
  teacher_ids: '担当教員ID', research_fields: '研究分野', themes: '指導テーマ', website: 'Webサイト', name: '氏名', affiliation: '所属', email: 'メール',
  code: '科目コード', term: '年度・学期', instructor: '担当教員', credits: '単位', weekday: '曜日（月1〜土6）', period: '授業枠（1〜5）', room: '教室', syllabus_url: 'シラバス',
  course_code: '科目コード', instructions: '説明・提出方法', submission_url: '提出先', scope: '試験範囲', opens_at: '受付開始', closes_at: '受付締切', procedure: '手続き', url: 'URL', filename: 'ファイル名',
};

export function informationWarnings(item: ImportItem): string[] {
  const data = item.data as Record<string, unknown>;
  const warnings = (REQUIRED_FACTS[item.type] ?? []).filter(key => data[key] == null || (Array.isArray(data[key]) && data[key].length === 0)).map(key => `${FIELD_LABELS[key] ?? key}が未確認です。`);
  if (item.needs_review) warnings.push('AIが確認を必要としています。');
  warnings.push(...(item.uncertainties ?? []));
  for (const [startKey, endKey] of [['starts_at', 'ends_at'], ['application_start', 'application_end'], ['opens_at', 'closes_at']]) {
    const start = data[startKey], end = data[endKey];
    if (typeof start === 'string' && typeof end === 'string' && (start.length === 10) !== (end.length === 10)) warnings.push('期間の開始と終了で日時の精度が異なります。原資料を確認してください。');
  }
  return warnings;
}

export function planManabiImport(inbox: InformationInbox, bundle: ManabiImport): ImportPlanRow[] {
  return bundle.items.map(item => {
    const matches = inbox.records.filter(record => identity(record.collection, record.item) === identity(bundle.collection, item));
    const existing = matches[0];
    const warnings = informationWarnings(item);
    if ([...inbox.records.filter(record => record.collection === bundle.collection).map(record => record.item), ...bundle.items].some(other => other.id !== item.id && other.type === item.type && other.title.normalize('NFKC').trim() === item.title.normalize('NFKC').trim())) warnings.push('同じタイトルの別IDがあります。重複かどうか確認してください。');
    for (const relatedId of [...(item.related_ids ?? []), ...(item.type === 'laboratory' ? item.data.teacher_ids ?? [] : [])]) {
      const related = [...bundle.items, ...inbox.records.filter(record => record.collection === bundle.collection).map(record => record.item)].filter(other => other.id === relatedId);
      if (!related.length) warnings.push(`関連情報 ${relatedId} が見つかりません。`);
      else if (item.type === 'laboratory' && item.data.teacher_ids?.includes(relatedId) && related.some(other => other.type !== 'teacher')) warnings.push(`担当教員 ${relatedId} の種別が教員ではありません。`);
    }
    if (matches.length > 1) warnings.push('同じ識別子の情報が複数あります。バックアップ復元で追加された内容を確認してください。');
    return { item, existing, kind: matches.length > 1 ? 'blocked' : !existing ? 'add' : canonical(existing.item) === canonical(item) ? 'same' : 'update', warnings: Array.from(new Set(warnings)) };
  });
}

export function applyManabiImport(inbox: InformationInbox, bundle: ManabiImport, selected: string[], reviewed: string[], baseline: string): InformationInbox {
  if (JSON.stringify(inbox) !== baseline) throw new Error('確認後に大学情報が変わりました。もう一度解析してください。');
  const checked = parseManabiImport(JSON.stringify(bundle));
  const rows = planManabiImport(inbox, checked);
  if (selected.some(id => !rows.some(row => row.item.id === id))) throw new Error('選択された情報がプレビューにありません。');
  const result = structuredClone(inbox);
  const now = new Date().toISOString();
  for (const row of rows.filter(entry => selected.includes(entry.item.id))) {
    if (row.kind === 'blocked') throw new Error('重複した識別子があるため取り込めません。');
    if (row.kind === 'same') continue;
    if (row.warnings.length && !reviewed.includes(row.item.id)) throw new Error(`${row.item.title}: 要確認の内容を承認してください。`);
    if (row.kind === 'add') {
      result.records.push({ id: crypto.randomUUID(), collection: checked.collection, item: row.item, status: 'unread', importedAt: now, updatedAt: now, history: [] });
    } else {
      const record = result.records.find(entry => entry.id === row.existing?.id)!;
      record.history.push({ item: record.item, replacedAt: now });
      record.item = row.item;
      record.status = 'unread';
      record.updatedAt = now;
    }
  }
  return result;
}

export function normalizeInformationInbox(value: unknown): InformationInbox {
  if (value === undefined) return structuredClone(EMPTY_INFORMATION_INBOX);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('大学情報Inboxの保存形式が不正です。');
  const inbox = value as InformationInbox;
  if (inbox.version !== 1 || !Array.isArray(inbox.records)) throw new Error('大学情報Inboxの保存版を確認してください。');
  const ids = new Set<string>();
  const records = inbox.records.map(record => {
    if (!record || typeof record.id !== 'string' || !record.id.trim() || ids.has(record.id) || !['read', 'unread'].includes(record.status) || !validateTimestamp(record.importedAt) || !validateTimestamp(record.updatedAt) || !Array.isArray(record.history)) throw new Error('大学情報Inboxの保存内容が不正です。元のデータを保ったまま読み込みを停止しました。');
    ids.add(record.id);
    const item = validateManabiImport({ schema_version: '1.0', collection: record.collection, items: [record.item] }).items[0];
    const history = record.history.map(entry => {
      if (!entry || !validateTimestamp(entry.replacedAt)) throw new Error('大学情報Inboxの変更履歴が不正です。');
      const previous = validateManabiImport({ schema_version: '1.0', collection: record.collection, items: [entry.item] }).items[0];
      if (identity(record.collection, previous) !== identity(record.collection, item)) throw new Error('大学情報Inboxの変更履歴の識別子が不正です。');
      return { item: previous, replacedAt: entry.replacedAt };
    });
    return { id: record.id, collection: record.collection, item, status: record.status, importedAt: record.importedAt, updatedAt: record.updatedAt, history };
  });
  return { version: 1, records };
}

export function mergeInformationInboxes(existingValue: unknown, incomingValue: unknown): InformationInbox {
  const existing = normalizeInformationInbox(existingValue), incoming = normalizeInformationInbox(incomingValue);
  for (const record of incoming.records) {
    if (existing.records.some(entry => identity(entry.collection, entry.item) === identity(record.collection, record.item) && canonical(entry.item) === canonical(record.item) && canonical(entry.history) === canonical(record.history))) continue;
    const id = existing.records.some(entry => entry.id === record.id) ? crypto.randomUUID() : record.id;
    existing.records.push({ ...record, id });
  }
  return existing;
}
