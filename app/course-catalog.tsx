'use client';

import { useState } from 'react';
import type { TransferCourse } from './course-transfer';
import type { CatalogProfile, InformationInbox } from './manabi-import-types';
import { courseSelectionConflict, normalizeImportTerm, type CourseEntry } from './inbox-course-model';
import { CATALOG_SEMESTERS, createCatalogPrompt, filterCatalogRecords, normalizeCatalogProfile, planCatalogSelection } from './course-catalog-model';
import { InboxCoursePreview } from './inbox-course-preview';

export type CatalogImportHandler = (inbox: InformationInbox, entries: CourseEntry[], terms: Record<string, string>, selected: string[], baseline: string) => void;
const weekdays = ['月', '火', '水', '木', '金', '土'];
const slots = ['08:40〜10:10', '10:20〜11:50', '12:40〜14:10', '14:20〜15:50', '16:00〜17:30'];

export function CourseCatalog({ inbox, courses, disabled, onChange, onImport }: { inbox: InformationInbox; courses: TransferCourse[]; disabled: boolean; onChange: (inbox: InformationInbox) => void; onImport: CatalogImportHandler }) {
  const [profile, setProfile] = useState<CatalogProfile>(inbox.catalogProfile ?? { university: '', faculty: '', academicYear: new Date().getFullYear(), semester: '前期', syllabusUrl: '' });
  const [message, setMessage] = useState(''), [prompt, setPrompt] = useState('');
  const [query, setQuery] = useState(''), [term, setTerm] = useState(''), [collection, setCollection] = useState(''), [weekday, setWeekday] = useState(''), [period, setPeriod] = useState('');
  const [selected, setSelected] = useState<string[]>([]), [previewIds, setPreviewIds] = useState<string[] | null>(null);
  const [baseline, setBaseline] = useState(''), [courseBaseline, setCourseBaseline] = useState('');
  const [targetTerms, setTargetTerms] = useState<Record<string, string>>({}), [approved, setApproved] = useState<string[]>([]), [reviewed, setReviewed] = useState(false);
  const records = inbox.records.filter(record => record.item.type === 'course');
  const filtered = filterCatalogRecords(inbox, { query, term, collection, weekday, period });
  const terms = Array.from(new Set(records.map(record => normalizeImportTerm(record.item.type === 'course' ? record.item.data.term ?? record.item.term ?? '' : '')).filter(Boolean)));
  const collections = Array.from(new Set(records.map(record => record.collection)));
  const stale = Boolean(previewIds && (JSON.stringify(inbox) !== baseline || JSON.stringify(courses) !== courseBaseline));
  const rows = previewIds && !stale ? planCatalogSelection(courses, inbox, previewIds, targetTerms) : [];
  const applying = rows.filter(row => approved.includes(row.key));
  const invalid = applying.some(row => row.kind === 'blocked') || courseSelectionConflict(applying) || (applying.some(row => row.warnings.length) && !reviewed);

  function saveProfile() {
    try { const normalized = normalizeCatalogProfile(profile); onChange({ ...inbox, catalogProfile: normalized }); setProfile(normalized); setMessage('大学設定を端末に保存します。同期が有効な場合だけ他端末へ共有します。'); }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : '大学設定を確認してください。'); }
  }
  async function copyPrompt() {
    try {
      const value = createCatalogPrompt(profile); setPrompt(value);
      try { await navigator.clipboard.writeText(value); setMessage('調査依頼文をコピーしました。普段使うAIでシラバス読み込み・検索を行い、結果JSONを下の取り込み欄へ貼ってください。'); }
      catch { setMessage('下の依頼文を選択してコピーしてください。'); }
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : '大学設定を確認してください。'); }
  }
  function choose(id: string, checked: boolean) {
    setSelected(current => checked ? Array.from(new Set([...current, id])) : current.filter(value => value !== id));
    setPreviewIds(null); setReviewed(false);
  }
  function preview() {
    try {
      const planned = planCatalogSelection(courses, inbox, selected, {});
      setPreviewIds(selected.slice()); setBaseline(JSON.stringify(inbox)); setCourseBaseline(JSON.stringify(courses)); setTargetTerms({}); setReviewed(false);
      setApproved(planned.filter(row => row.kind !== 'update').map(row => row.key)); setMessage('選んだ授業の反映先を確認してください。まだ講義・ノートは作成していません。');
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : '選択を確認してください。'); }
  }
  function confirm() {
    if (disabled || stale || invalid || !applying.length || !previewIds) return;
    try {
      const entries = inbox.records.filter(record => previewIds.includes(record.id));
      onImport(inbox, entries, targetTerms, applying.map(row => row.key), courseBaseline);
      setPreviewIds(null); setSelected([]); setMessage(`選んだ${applying.length}件を時間割・ノートに登録しました。対象学期と上部の保存状態をご確認ください。`);
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : '登録できませんでした。'); }
  }

  return <section className="inbox-card course-catalog" aria-label="授業カタログ">
    <h2>授業カタログから選ぶ</h2>
    <p>全候補を保存してから、履修する授業だけ選びます。ログイン不要・端末内保存が基本です。アプリは自動検索やAI API呼び出しをしません。</p>
    <details><summary>大学設定・AIへのシラバス調査依頼</summary>
      <div className="catalog-profile">
        <label>大学<input value={profile.university} maxLength={160} onChange={event => setProfile({ ...profile, university: event.target.value })} /></label>
        <label>学部・学科<input value={profile.faculty} maxLength={160} onChange={event => setProfile({ ...profile, faculty: event.target.value })} /></label>
        <label>対象年度<input type="number" min={2000} max={2200} value={profile.academicYear} onChange={event => setProfile({ ...profile, academicYear: Number(event.target.value) })} /></label>
        <label>対象学期<select value={profile.semester} onChange={event => setProfile({ ...profile, semester: event.target.value })}>{CATALOG_SEMESTERS.map(value => <option key={value}>{value}</option>)}</select></label>
        <label>公式シラバスURL（任意）<input type="url" value={profile.syllabusUrl} maxLength={2000} onChange={event => setProfile({ ...profile, syllabusUrl: event.target.value })} /></label>
      </div>
      <div className="inbox-actions"><button type="button" disabled={disabled} onClick={saveProfile}>大学設定を保存</button><button type="button" onClick={() => void copyPrompt()}>シラバス調査依頼文をコピー</button></div>
      {inbox.catalogProfile && <p>保存中の設定: {inbox.catalogProfile.university} / {inbox.catalogProfile.faculty} / {inbox.catalogProfile.academicYear}年度 {inbox.catalogProfile.semester}</p>}
      <p>公式の科目一覧・各シラバス・時間割を各自のAIで調査します。1回200件・1MBまで、超える場合は同じcollectionのJSONを分割して追加してください。取得範囲はAIの調査記録で確認し、未取得がある状態を「全科目確認済み」と扱わないでください。</p>
      {prompt && <label>カタログ調査依頼文<textarea readOnly rows={8} value={prompt} onFocus={event => event.target.select()} /></label>}
    </details>
    <p role="status" aria-live="polite">{message}</p>
    <p>取り込まれた候補 {records.length}件 · 選択 {selected.length}件。候補件数は大学の全開講数を保証しません。</p>
    <div className="catalog-filters">
      <label>授業・教員を検索<input type="search" value={query} onChange={event => setQuery(event.target.value)} /></label>
      <label>候補の情報集合<select value={collection} onChange={event => setCollection(event.target.value)}><option value="">すべて</option>{collections.map(value => <option key={value}>{value}</option>)}</select></label>
      <label>候補の年度・学期<select value={term} onChange={event => setTerm(event.target.value)}><option value="">すべて</option>{terms.map(value => <option key={value}>{value}</option>)}</select></label>
      <label>候補の曜日<select value={weekday} onChange={event => setWeekday(event.target.value)}><option value="">すべて</option>{weekdays.map((value, index) => <option key={value} value={index + 1}>{value}曜日</option>)}<option value="unknown">曜日・時限未確認</option></select></label>
      <label>候補の授業枠<select value={period} onChange={event => setPeriod(event.target.value)}><option value="">すべて</option>{slots.map((value, index) => <option key={value} value={index + 1}>{index + 1}枠 {value}</option>)}</select></label>
    </div>
    {selected.length > 0 && <p>絞り込みで隠れた選択 {selected.filter(id => !filtered.some(record => record.id === id)).length}件も保持しています。登録前のプレビューに全選択を表示します。</p>}
    {!records.length && <p>下のJSON取り込みで「授業カタログ・Inboxに保存」を選んで候補を追加してください。</p>}
    {records.length > 0 && !filtered.length && <p>この条件の候補はありません。未取得の科目が存在しないことを意味しません。</p>}
    <div className="catalog-options">{filtered.map(record => {
      if (record.item.type !== 'course') return null;
      const data = record.item.data;
      const registered = courses.some(course => !course.deletedAt && !course.archivedAt && normalizeImportTerm(course.term) === normalizeImportTerm(data.term ?? record.item.term ?? '') && (data.code ? course.code === data.code : course.title === record.item.title));
      return <article className="inbox-item" key={record.id}>
        <h3>{record.item.title}</h3>
        <p>{data.term ?? record.item.term ?? '学期未確認'} · {data.weekday && data.period ? `${weekdays[data.weekday - 1]}曜 ${data.period}枠 ${slots[data.period - 1]}` : '曜日・時限未確認'}</p>
        <p>{data.instructor ?? '教員未確認'} · {data.credits == null ? '単位未確認' : `${data.credits}単位`} · {data.room ?? '教室未確認'} · {data.code ?? 'コード未確認'}{registered ? ' · 講義登録済み' : ''}</p>
        <label className="inbox-check"><input type="checkbox" checked={selected.includes(record.id)} disabled={disabled} onChange={event => choose(record.id, event.target.checked)} />この授業を選ぶ</label>
        <details><summary>候補の内容・出典・未確認事項</summary>{record.item.summary && <p>{record.item.summary}</p>}<p>情報集合: {record.collection}</p><p>出典: {record.item.source.title} {record.item.source.locator}</p>{record.item.source.url && <a href={record.item.source.url} target="_blank" rel="noopener noreferrer">公式資料を確認</a>}{record.item.source.excerpt && <blockquote>{record.item.source.excerpt}</blockquote>}{record.item.needs_review && <p>AIが要確認としている情報です。</p>}{record.item.uncertainties?.map(value => <p key={value}>{value}</p>)}</details>
      </article>;
    })}</div>
    <div className="inbox-actions"><button type="button" disabled={disabled || !selected.length} onClick={preview}>選んだ授業の登録内容を確認</button><button type="button" disabled={!selected.length} onClick={() => { setSelected([]); setPreviewIds(null); }}>選択をすべて解除</button></div>
    {stale && <p role="alert">確認後に候補または講義が変わりました。もう一度登録内容を確認してください。</p>}
    {previewIds && !stale && <>
      <InboxCoursePreview rows={rows} terms={targetTerms} selected={approved} disabled={disabled} onTerm={(key, value) => { setTargetTerms(current => ({ ...current, [key]: value })); setApproved(current => current.filter(value => value !== key)); setReviewed(false); }} onSelect={(key, checked) => { setApproved(current => checked ? Array.from(new Set([...current, key])) : current.filter(value => value !== key)); setReviewed(false); }} />
      {applying.some(row => row.warnings.length) && <label className="inbox-check"><input type="checkbox" checked={reviewed} disabled={disabled} onChange={event => setReviewed(event.target.checked)} />選んだ授業の未確認事項・重複・反映先を確認しました</label>}
      <button type="button" disabled={disabled || invalid || !applying.length} onClick={confirm}>選択した授業{applying.length}件を時間割・ノートに登録</button>
    </>}
  </section>;
}
