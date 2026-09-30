'use client';

import { useState } from 'react';
import { applyManabiImport, FIELD_LABELS, informationWarnings, ITEM_LABELS, MAX_IMPORT_BYTES, parseManabiImport, planManabiImport } from './manabi-import-model';
import { MANABI_AI_PROMPT } from './manabi-import-prompt';
import sample from '../examples/manabi-import-seminar.json';
import courseSample from '../examples/manabi-import-courses.json';
import catalogSample from '../examples/manabi-import-catalog.json';
import type { ImportItem, ImportItemType, InformationInbox, ManabiImport } from './manabi-import-types';
import type { TransferCourse } from './course-transfer';
import { courseEntryKey, courseSelectionConflict, planInboxCourses, type CourseEntry } from './inbox-course-model';
import { InboxCoursePreview } from './inbox-course-preview';
import { CourseCatalog } from './course-catalog';
import { registrationEntries, displayImportValue as displayValue } from './import-registration-model';


function ItemDetails({ item, previous }: { item: ImportItem; previous?: ImportItem }) {
  const next = { ...item.data } as Record<string, unknown>, old = previous ? { ...previous.data } as Record<string, unknown> : undefined;
  if (item.type === 'course') next.term ??= item.term;
  if (previous?.type === 'course' && old) old.term ??= previous.term;
  const keys = Array.from(new Set([...Object.keys(next), ...Object.keys(old ?? {})]));
  return <>
    {item.summary && <p>{item.summary}</p>}
    {previous && <p className="inbox-warning">更新を選ぶと、この情報全体をJSONの内容に置き換えます。省略された項目も外れます。変更前の情報は履歴に残ります。</p>}
    <div className="inbox-table-wrap"><table><caption>{previous ? '変更前と取り込む情報' : '取り込む情報'}</caption><thead><tr><th>項目</th>{previous && <th>現在</th>}<th>{previous ? '取り込み後' : '内容'}</th></tr></thead><tbody>{keys.map(key => <tr key={key}><th>{FIELD_LABELS[key] ?? key}</th>{previous && <td>{displayValue(old?.[key], key)}</td>}<td>{displayValue(next[key], key)}</td></tr>)}</tbody></table></div>
    <p>出典: {item.source.title} {item.source.locator ?? ''}{item.source.url && <> · <a href={item.source.url} target="_blank" rel="noopener noreferrer">原資料を開く</a></>}</p>
    {item.source.excerpt && <blockquote>{item.source.excerpt}</blockquote>}
    {(item.related_ids?.length ?? 0) > 0 && <p>関連ID: {item.related_ids?.join('、')}</p>}
    <details><summary>出典・関連・拡張を含む全項目{previous ? 'の比較' : ''}</summary>{previous && <><h4>現在</h4><pre>{JSON.stringify(previous, null, 2)}</pre><h4>取り込み後</h4></>}<pre>{JSON.stringify(item, null, 2)}</pre></details>
  </>;
}

export function UniversityInbox({ inbox, courses, disabled, onChange, onImport }: { inbox: InformationInbox; courses: TransferCourse[]; disabled: boolean; onChange: (value: InformationInbox) => void; onImport: (inbox: InformationInbox, entries: CourseEntry[], terms: Record<string, string>, selected: string[], baseline: string) => void }) {
  const [text, setText] = useState(''), [bundle, setBundle] = useState<ManabiImport | null>(null);
  const [baseline, setBaseline] = useState(''), [selected, setSelected] = useState<string[]>([]), [reviewed, setReviewed] = useState<string[]>([]);
  const [message, setMessage] = useState(''), [promptVisible, setPromptVisible] = useState(false);
  const [query, setQuery] = useState(''), [type, setType] = useState<ImportItemType | ''>(''), [unreadOnly, setUnreadOnly] = useState(false);
  const [recovery, setRecovery] = useState(false), [courseBaseline, setCourseBaseline] = useState('');
  const [courseTerms, setCourseTerms] = useState<Record<string, string>>({}), [courseSelected, setCourseSelected] = useState<string[]>([]), [courseReviewed, setCourseReviewed] = useState(false);
  const [importMode, setImportMode] = useState<'catalog' | 'register'>('catalog');
  const rows = bundle ? planManabiImport(inbox, bundle) : [];
  const stale = Boolean((bundle || recovery) && (baseline !== JSON.stringify(inbox) || courseBaseline !== JSON.stringify(courses)));
  const invalidChoice = rows.some(row => selected.includes(row.item.id) && (row.kind === 'blocked' || (row.warnings.length > 0 && !reviewed.includes(row.item.id))));
  const chosen = rows.filter(row => selected.includes(row.item.id) && (row.kind === 'add' || row.kind === 'update'));
  const courseEntries = recovery ? inbox.records.filter(record => record.item.type === 'course').map(record => ({ collection: record.collection, item: record.item })) : bundle && importMode === 'register' ? registrationEntries(rows, bundle.collection, selected) : [];
  const courseRows = planInboxCourses(courses, courseEntries, courseTerms);
  const selectedCourseRows = courseRows.filter(row => courseSelected.includes(row.key));
  const invalidCourses = courseSelectionConflict(selectedCourseRows) || selectedCourseRows.some(row => row.kind === 'blocked') || (selectedCourseRows.some(row => row.warnings.length) && !courseReviewed);
  const filtered = inbox.records.filter(record => (!type || record.item.type === type) && (!unreadOnly || record.status === 'unread') && JSON.stringify([record.collection, record.item]).toLocaleLowerCase('ja-JP').includes(query.toLocaleLowerCase('ja-JP')));
  const schedule = filtered.flatMap(record => Object.entries(record.item.data).filter(([key, value]) => typeof value === 'string' && /^(starts_at|due_at|guidance_at|application_start|application_end|result_at|opens_at|closes_at)$/.test(key)).map(([key, value]) => ({ record, key, date: value as string }))).sort((left, right) => Date.parse(left.date) - Date.parse(right.date));
  function edit(value: string) { setText(value); setBundle(null); setRecovery(false); setSelected([]); setReviewed([]); setMessage(''); }
  function preview() {
    try {
      const parsed = parseManabiImport(text);
      setBundle(parsed); setRecovery(false); setBaseline(JSON.stringify(inbox)); setCourseBaseline(JSON.stringify(courses)); setCourseTerms({}); setCourseReviewed(false);
      setCourseSelected(planInboxCourses(courses, parsed.items.map(item => ({ collection: parsed.collection, item }))).filter(row => row.kind === 'add' || row.kind === 'blocked').map(row => row.key));
      setSelected(planManabiImport(inbox, parsed).filter(row => row.kind === 'add').map(row => row.item.id)); setReviewed([]); setMessage('新規項目を選択しています。出典と反映先を確認してください。まだ保存されていません。');
    }
    catch (cause) { setBundle(null); setMessage(cause instanceof Error ? cause.message : '解析できませんでした。'); }
  }
  function confirm() {
    if (disabled || stale || invalidCourses || (!recovery && (!bundle || invalidChoice || (!chosen.length && !selectedCourseRows.length))) || (recovery && !selectedCourseRows.length)) return;
    try {
      const next = recovery ? inbox : applyManabiImport(inbox, bundle!, selected, reviewed, baseline);
      onImport(next, courseEntries, courseTerms, selectedCourseRows.map(row => row.key), courseBaseline);
      setBundle(null); setRecovery(false); setSelected([]); setReviewed([]);
      setMessage(selectedCourseRows.length ? `講義${selectedCourseRows.length}件を時間割・ノートに登録しました。${selectedCourseRows[0].course.term}へ切り替えています。上部の保存状態をご確認ください。` : `大学情報${chosen.length}件を保存しました。授業候補の保存だけでは時間割・ノートに登録されません。時間割で対象年度・学期の空き枠から選ぶか、上の授業カタログで確認して登録してください。`);
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : '取り込めませんでした。'); }
  }
  async function copyPrompt() {
    try { await navigator.clipboard.writeText(MANABI_AI_PROMPT); setMessage('AIへの依頼文をコピーしました。資料と一緒に普段使うAIへ渡してください。'); }
    catch { setPromptVisible(true); setMessage('下の依頼文を選択してコピーしてください。'); }
  }
  function toggle(values: string[], id: string, checked: boolean) { return checked ? [...values, id] : values.filter(value => value !== id); }
  return <section className="university-inbox" aria-label="大学情報Inbox">
    <header><p className="eyebrow">UNIVERSITY INBOX</p><h1>大学情報Inbox</h1><p>大学の案内・ゼミ配属・教員情報を、出典と一緒に整理します。</p><p>ChatGPT / Claude / Gemini / ローカルLLMなど、普段使うAIで資料をJSONに変換してください。まなびメモからAIへの送信やAPI呼び出しはありません。</p></header>
    <CourseCatalog key={JSON.stringify(inbox.catalogProfile ?? null)} inbox={inbox} courses={courses} disabled={disabled} onChange={onChange} onImport={onImport} />
    <section className="inbox-card" aria-label="AIから情報を取り込む">
      <h2>AIから情報を取り込む</h2><p>① 依頼文と資料をAIへ渡す → ② JSONを貼る → ③ 解析・確認 → ④ 選んで取り込む</p>
      <fieldset><legend>講義情報の取り込み先</legend><label className="inbox-check"><input type="radio" name="course-import-mode" checked={importMode === 'catalog'} onChange={() => { setImportMode('catalog'); setCourseReviewed(false); }} />授業カタログ・Inboxに保存（候補を選ぶまで講義・ノートは作らない）</label><label className="inbox-check"><input type="radio" name="course-import-mode" checked={importMode === 'register'} onChange={() => { setImportMode('register'); setCourseReviewed(false); }} />確認した講義を時間割・ノートにも直接登録</label></fieldset>
      <div className="inbox-actions"><button type="button" onClick={() => void copyPrompt()}>AI向け依頼文をコピー</button><button type="button" onClick={() => edit(JSON.stringify(catalogSample, null, 2))}>授業カタログのサンプルを表示</button><button type="button" onClick={() => edit(JSON.stringify(courseSample, null, 2))}>講義・時間割のサンプルを表示</button><button type="button" onClick={() => edit(JSON.stringify(sample, null, 2))}>ゼミのサンプルを表示</button><button type="button" onClick={() => setPromptVisible(!promptVisible)}>依頼文を表示</button></div>
      {promptVisible && <label>AI向け依頼文（Schemaを含む）<textarea readOnly rows={8} value={MANABI_AI_PROMPT} onFocus={event => event.target.select()} /></label>}
      <label>JSONファイル<input type="file" accept=".json,application/json" disabled={disabled} onChange={async event => {
        const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
        if (file.size > MAX_IMPORT_BYTES) { edit(''); setMessage('JSONは1MB以内にしてください。'); return; }
        try { edit(await file.text()); } catch { edit(''); setMessage('ファイルを読めませんでした。'); }
      }} /></label>
      <label>JSONを貼り付け<textarea rows={10} value={text} onChange={event => edit(event.target.value)} spellCheck={false} placeholder={'{"schema_version":"1.0","collection":"大学・年度の識別子","items":[…]}'} /></label>
      <button type="button" onClick={preview} disabled={disabled || !text.trim()}>JSONを解析して確認</button>
      <p role="status" aria-live="polite">{message}</p>
      {disabled && <p role="alert">端末の読み込み・保存状態を確認するまで、取り込みと既読の変更を停止しています。</p>}
      {stale && <p role="alert">確認後に大学情報が変わりました。もう一度「JSONを解析して確認」を押してください。</p>}
      {bundle && <section aria-label="取り込みプレビュー">
        <h3>取り込みプレビュー</h3><p>情報集合: {bundle.collection}</p>
        <button type="button" disabled={disabled || stale} onClick={() => setSelected(rows.filter(row => row.kind === 'add' || row.kind === 'update').map(row => row.item.id))}>新規・更新候補をすべて選択</button>
        <p>新規 {rows.filter(row => row.kind === 'add').length}件 / 更新 {rows.filter(row => row.kind === 'update').length}件 / 重複 {rows.filter(row => row.kind === 'same').length}件 / 要確認 {rows.filter(row => row.warnings.length).length}件 / 適用不可 {rows.filter(row => row.kind === 'blocked').length}件</p>
        {rows.some(row => row.kind === 'same' && row.item.type === 'course') && <p>「重複」は同じ情報がInboxに保存済みという意味です。時間割・ノートへの登録済みとは限りません。再保存は不要で、講義登録だけ確認できます。<button type="button" disabled={disabled || stale} onClick={() => { setImportMode('register'); setCourseReviewed(false); }}>保存済み情報の講義登録を確認</button></p>}
        {chosen.some(row => row.warnings.length) && <label className="inbox-check"><input type="checkbox" checked={chosen.filter(row => row.warnings.length).every(row => reviewed.includes(row.item.id))} disabled={disabled || stale} onChange={event => setReviewed(event.target.checked ? chosen.filter(row => row.warnings.length).map(row => row.item.id) : [])} />選択した情報すべての出典・要確認事項を読み、不明点を残して保存することを確認しました</label>}
        {rows.map(row => <article className="inbox-item" key={row.item.id}>
          <h4>{row.item.title}</h4><p>{ITEM_LABELS[row.item.type]} · {{ add: '新規', update: '更新候補', same: '情報は保存済み（再保存不要）', blocked: '適用不可' }[row.kind]}</p>
          {row.warnings.length > 0 && <ul className="inbox-warning">{row.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>}
          <ItemDetails item={row.item} previous={row.kind === 'update' ? row.existing?.item : undefined} />
          {(row.kind === 'add' || row.kind === 'update') && <>
            <label className="inbox-check"><input type="checkbox" checked={selected.includes(row.item.id)} disabled={disabled || stale} onChange={event => setSelected(toggle(selected, row.item.id, event.target.checked))} />{row.kind === 'update' ? '変更前後を確認して更新する' : 'この情報を取り込む'}</label>
            {row.warnings.length > 0 && <label className="inbox-check"><input type="checkbox" checked={reviewed.includes(row.item.id)} disabled={disabled || stale} onChange={event => setReviewed(toggle(reviewed, row.item.id, event.target.checked))} />要確認の内容を読み、不明点を残して取り込むことを確認しました</label>}
          </>}
        </article>)}
        <InboxCoursePreview rows={courseRows} terms={courseTerms} selected={courseSelected} disabled={disabled || stale} onTerm={(key, term) => { setCourseTerms(current => ({ ...current, [key]: term })); setCourseSelected(current => current.filter(value => value !== key)); setCourseReviewed(false); }} onSelect={(key, checked) => { setCourseSelected(toggle(courseSelected, key, checked)); setCourseReviewed(false); }} />
        {selectedCourseRows.some(row => row.warnings.length) && <label className="inbox-check"><input type="checkbox" checked={courseReviewed} disabled={disabled || stale} onChange={event => setCourseReviewed(event.target.checked)} />講義の反映先・未設定・重複の注意を確認しました</label>}
        <button type="button" onClick={confirm} disabled={disabled || stale || invalidChoice || invalidCourses || (!chosen.length && !selectedCourseRows.length)}>{selectedCourseRows.length ? `確認した講義${selectedCourseRows.length}件を時間割・ノートに登録` : `確認した${chosen.length}件を取り込む`}</button>
        {importMode === 'catalog' && <p>この操作では候補だけ保存します。上の授業カタログで履修する授業を選んでください。</p>}
      </section>}
    </section>
    <section className="inbox-card" aria-label="取り込み済み大学情報">
      <h2>取り込み済みの情報</h2><p>{inbox.records.length}件 · 未読 {inbox.records.filter(record => record.status === 'unread').length}件。端末に保存し、同期を有効にした場合だけ個人のクラウドへ送ります。</p>
      <button type="button" disabled={disabled || !inbox.records.some(record => record.item.type === 'course')} onClick={() => {
        setBundle(null); setRecovery(true); setBaseline(JSON.stringify(inbox)); setCourseBaseline(JSON.stringify(courses)); setCourseTerms({}); setCourseReviewed(false);
        setCourseSelected(planInboxCourses(courses, inbox.records).filter(row => row.kind === 'add' || row.kind === 'blocked').map(row => courseEntryKey(row.entry)));
        setMessage('保存済み情報を再利用します。新規講義だけ選択しています。対象学期と登録する科目を確認してください。');
      }}>保存済みの講義を時間割・ノートに反映</button>
      {recovery && <>
        <InboxCoursePreview rows={courseRows} terms={courseTerms} selected={courseSelected} disabled={disabled || stale} onTerm={(key, term) => { setCourseTerms(current => ({ ...current, [key]: term })); setCourseSelected(current => current.filter(value => value !== key)); setCourseReviewed(false); }} onSelect={(key, checked) => { setCourseSelected(toggle(courseSelected, key, checked)); setCourseReviewed(false); }} />
        {selectedCourseRows.some(row => row.warnings.length) && <label className="inbox-check"><input type="checkbox" checked={courseReviewed} disabled={disabled || stale} onChange={event => setCourseReviewed(event.target.checked)} />講義の反映先・未設定・重複の注意を確認しました</label>}
        <button type="button" onClick={confirm} disabled={disabled || stale || invalidCourses || !selectedCourseRows.length}>確認した講義{selectedCourseRows.length}件を登録</button>
      </>}
      <div className="inbox-filters"><label>検索<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="ゼミ・教員・研究分野など" /></label><label>種類<select value={type} onChange={event => setType(event.target.value as ImportItemType | '')}><option value="">すべて</option>{Object.entries(ITEM_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label className="inbox-check"><input type="checkbox" checked={unreadOnly} onChange={event => setUnreadOnly(event.target.checked)} />未読だけ</label></div>
      {!inbox.records.length && <p>まだ大学情報はありません。まず上のサンプルで取り込みの流れを確認できます。</p>}
      {inbox.records.length > 0 && !filtered.length && <p>条件に一致する情報がありません。</p>}
      {schedule.length > 0 && <details open><summary>配属日程・予定・締切（{schedule.length}件）</summary><ol className="inbox-schedule">{schedule.map(entry => <li key={`${entry.record.id}-${entry.key}`}><strong>{displayValue(entry.date)}</strong><span>{entry.record.item.title} · {FIELD_LABELS[entry.key]}</span></li>)}</ol></details>}
      {filtered.slice().reverse().map(record => <article className="inbox-item" key={record.id}>
        <div className="inbox-item-heading"><h3>{record.item.title}</h3><button type="button" disabled={disabled} onClick={() => onChange({ ...inbox, records: inbox.records.map(entry => entry.id === record.id ? { ...entry, status: entry.status === 'read' ? 'unread' : 'read' } : entry) })}>{record.status === 'unread' ? '既読にする' : '未読に戻す'}</button></div>
        <p>{ITEM_LABELS[record.item.type]} · {record.status === 'unread' ? '未読' : '既読'} · {record.collection}</p>
        {informationWarnings(record.item).length > 0 && <ul className="inbox-warning">{informationWarnings(record.item).map(warning => <li key={warning}>{warning}</li>)}</ul>}
        <details><summary>内容・出典・関連を確認</summary><ItemDetails item={record.item} /><p>取り込み: {record.importedAt} / 更新: {record.updatedAt}</p></details>
        {record.history.length > 0 && <details><summary>変更履歴（{record.history.length}件）</summary>{record.history.slice().reverse().map((entry, index) => <div key={`${entry.replacedAt}-${index}`}><p>{entry.replacedAt}に更新する前</p><ItemDetails item={entry.item} /></div>)}</details>}
      </article>)}
    </section>
  </section>;
}
