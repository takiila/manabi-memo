import { MAX_IMPORT_BYTES, parseManabiImport } from './manabi-import-model.ts';
import type { ImportItem, ManabiImport } from './manabi-import-types';

export const ICAL_COLLECTION = 'ical-calendar';
type Property = { name: string; params: string; value: string };
const unsupported = new Set(['RRULE', 'RDATE', 'EXDATE', 'EXRULE', 'RECURRENCE-ID', 'DURATION']);

function text(value: string) {
  return value.replace(/\\([nN,;\\])/g, (_, char: string) => /[nN]/.test(char) ? '\n' : char);
}

function date(property: Property): string {
  const { params, value } = property;
  if (params === ';VALUE=DATE' && /^\d{8}$/.test(value)) {
    const result = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
    if (new Date(`${result}T00:00:00Z`).toISOString().slice(0, 10) === result) return result;
  }
  if (/^\d{8}T\d{6}Z?$/.test(value)) {
    const zone = params === '' && value.endsWith('Z') ? 'Z' : [';TZID=Asia/Tokyo', ';TZID="Asia/Tokyo"'].includes(params) && !value.endsWith('Z') ? '+09:00' : '';
    const day = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
    if (zone && new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day && Number(value.slice(9, 11)) < 24 && Number(value.slice(11, 13)) < 60 && Number(value.slice(13, 15)) < 60) {
      return `${day}T${value.slice(9, 11)}:${value.slice(11, 13)}:${value.slice(13, 15)}${zone}`;
    }
  }
  throw new Error('ICSの日時を確認できません。UTC、Asia/Tokyo、日付のみの形式に対応しています。時差や時刻は推測しません。');
}

/** Converts a finite calendar snapshot; persistence uses the normal Inbox review. */
export async function parseICalendar(raw: string): Promise<ManabiImport> {
  if (new TextEncoder().encode(raw).length > MAX_IMPORT_BYTES) throw new Error('ICSは1MB以内にしてください。');
  const lines = raw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').trim().split('\n');
  if (lines[0] !== 'BEGIN:VCALENDAR' || lines.at(-1) !== 'END:VCALENDAR') throw new Error('VCALENDAR形式のICSファイルを選んでください。');
  const events: Property[][] = [];
  let event: Property[] | null = null;
  for (const line of lines.slice(1, -1)) {
    if (!line) continue;
    if (line === 'BEGIN:VEVENT') {
      if (event) throw new Error('ICSの予定構造が不正です。');
      event = []; continue;
    }
    if (line === 'END:VEVENT') {
      if (!event) throw new Error('ICSの予定構造が不正です。');
      events.push(event); event = null; continue;
    }
    const match = /^([A-Za-z0-9-]+)((?:;[^:]*)?):(.*)$/.exec(line);
    if (!match) throw new Error('ICSの行を解析できません。');
    const property = { name: match[1].toUpperCase(), params: match[2], value: match[3] };
    if (['BEGIN', 'END'].includes(property.name)) throw new Error('VEVENT以外の構成要素にはまだ対応していません。予定を一部だけ取り込むことはしません。');
    if (!event) {
      if (property.name === 'VERSION' && property.value === '2.0') continue;
      if (property.name === 'METHOD' && property.value !== 'PUBLISH') throw new Error('公開用カレンダー以外の更新・取り消し通知には未対応です。');
      continue;
    }
    if (unsupported.has(property.name) || (property.name === 'STATUS' && property.value !== 'CONFIRMED')) throw new Error('繰り返し・例外・未確定・取り消し予定にはまだ対応していません。元の予定は変更していません。');
    event.push(property);
  }
  if (event || !events.length || events.length > 200 || !lines.includes('VERSION:2.0')) throw new Error('ICSはVERSION 2.0、完結した予定1〜200件で指定してください。');
  const items: ImportItem[] = [];
  for (const properties of events) {
    function one(name: string, required = false) {
      const matches = properties.filter(p => p.name === name);
      if (matches.length > 1 || (required && !matches.length)) throw new Error(`ICSの${name}が不足または重複しています。`);
      return matches[0];
    }
    const uid = text(one('UID', true)!.value);
    const title = text(one('SUMMARY', true)!.value);
    if (!uid.trim() || !title.trim()) throw new Error('ICSのUID・件名を確認してください。');
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(uid));
    const id = `ical.${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}`;
    const start = date(one('DTSTART', true)!);
    const endProperty = one('DTEND');
    let end = endProperty ? date(endProperty) : undefined;
    if (end && ((start.length === 10) !== (end.length === 10) || Date.parse(end) < Date.parse(start))) throw new Error('ICSの開始・終了日時が矛盾しています。');
    if (title.includes('提出期限') && end && Date.parse(end) !== Date.parse(start)) throw new Error('提出期限の予定に期間があります。開始と終了のどちらが締切か推測せず、原資料の確認が必要です。');
    // RFC 5545 DATE DTEND is exclusive; the Inbox date range is inclusive.
    if (end?.length === 10) {
      if (end === start) throw new Error('ICSの終日予定の終了日は開始日より後にしてください。');
      end = new Date(Date.parse(`${end}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
    }
    const description = text(one('DESCRIPTION')?.value ?? '');
    const categories = properties.filter(p => p.name === 'CATEGORIES').flatMap(p => p.value.split(/(?<!\\),/).map(text));
    const code = categories.length === 1 && /^[A-Za-z]+\d+$/.test(categories[0]) ? categories[0] : undefined;
    const url = one('URL')?.value;
    const common = {
      id, title, source: { kind: 'other' as const, title: 'LMS / iCalendar', locator: `UID: ${uid}`, ...(url ? { url } : {}) },
      ...(description ? { summary: description } : {}), tags: ['LMS', ...categories], needs_review: true,
      uncertainties: ['件名から分類しています。科目・日時・提出期限か開始／終了の案内かを原資料で確認してください。履修科目への自動登録・自動共有はしません。'],
      extensions: { 'x-ical-uid': uid, ...(code ? { 'x-course-code': code } : {}) },
    };
    // Only an explicit submission-deadline label becomes an assignment.
    items.push(title.includes('提出期限') ? {
      ...common, type: 'assignment', data: { due_at: start, ...(code ? { course_code: code } : {}), ...(description ? { instructions: description } : {}), ...(url ? { submission_url: url } : {}) },
    } : {
      ...common, type: 'event', data: { starts_at: start, ...(end ? { ends_at: end } : {}), ...(one('LOCATION') ? { location: text(one('LOCATION')!.value) } : {}), ...(url ? { url } : {}) },
    });
  }
  return parseManabiImport(JSON.stringify({ schema_version: '1.0', collection: ICAL_COLLECTION, items }));
}
