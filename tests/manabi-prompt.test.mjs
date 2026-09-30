import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { MANABI_AI_PROMPT } from '../app/manabi-import-prompt.ts';
import { parseManabiImport } from '../app/manabi-import-model.ts';

test('copied prompt includes the complete import schema and supported course fields', () => {
  const schema = JSON.parse(MANABI_AI_PROMPT.split('JSON Schema:\n')[1]);
  assert.equal(schema.properties.schema_version.const, '1.0');
  assert.ok(JSON.stringify(schema).includes('weekday'));
  assert.ok(JSON.stringify(schema).includes('period'));
});

test('course instructions expose exact timetable slots and require schedule evidence', () => {
  for (const mapping of ['月=1', '火=2', '水=3', '木=4', '金=5', '土=6',
    '1=08:40〜10:10', '2=10:20〜11:50', '3=12:40〜14:10', '4=14:20〜15:50', '5=16:00〜17:30',
    '1〜2限はperiod=1', '3〜4限はperiod=2', '5〜6限はperiod=3']) {
    assert.ok(MANABI_AI_PROMPT.includes(mapping), `missing timetable mapping: ${mapping}`);
  }
  assert.match(MANABI_AI_PROMPT, /シラバス・時間割.*抽出/);
  assert.match(MANABI_AI_PROMPT, /source\.locator.*source\.excerpt/);
  assert.match(MANABI_AI_PROMPT, /曜日.*時限.*両方null/);
  assert.match(MANABI_AI_PROMPT, /複数.*uncertainties.*needs_review/);
});

test('course instructions separate enrollment decisions from academic-year normalization', () => {
  assert.match(MANABI_AI_PROMPT, /2026年度 前期/);
  assert.match(MANABI_AI_PROMPT, /2026年度 後期/);
  assert.match(MANABI_AI_PROMPT, /2年次後期.*年度.*推測しない/);
  assert.match(MANABI_AI_PROMPT, /単位取得済み.*過去.*履修候補/);
  assert.match(MANABI_AI_PROMPT, /利用者.*選択.*確認/);
  assert.match(MANABI_AI_PROMPT, /有料API/);
});

test('course example validates known and unknown schedules with review evidence', async () => {
  const pack = parseManabiImport(await readFile(new URL('../examples/manabi-import-courses.json', import.meta.url), 'utf8'));
  const known = pack.items.find(entry => entry.id === 'sample101-2026-front');
  const unknown = pack.items.find(entry => entry.id === 'sample202-candidate');
  assert.equal(known.type, 'course');
  assert.equal(known.data.weekday, 1);
  assert.equal(known.data.period, 1);
  assert.equal(known.data.term, '2026年度 前期');
  assert.match(known.source.excerpt, /月.*1〜2限/);
  assert.ok(known.source.locator);
  assert.equal(unknown.data.weekday, null);
  assert.equal(unknown.data.period, null);
  assert.equal(unknown.data.term, null);
  assert.equal(unknown.needs_review, true);
  assert.ok(unknown.uncertainties.length);
  assert.match(unknown.summary, /履修候補/);
});
