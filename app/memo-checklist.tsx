'use client';
import { useState } from 'react';
import { normalizeChecklist, patchChecklist, type ChecklistItem } from './planner-model';
import { isTrashExpired } from './data-safety-model';

export function TaskDates({ item, onChange, disabled = false, allowWork = true }: { item: Pick<ChecklistItem, 'due' | 'priority' | 'workAt'>; onChange: (patch: Partial<ChecklistItem>) => void; disabled?: boolean; allowWork?: boolean }) {
  const [error, setError] = useState('');
  function changeDue(day: string, time: string) { onChange({ due: day ? day + (time ? `T${time}` : '') : '' }); }
  // Existing zoned values stay intact until the user edits them.
  const localDue = item.due && /(Z|[+-]\d{2}:\d{2})$/.test(item.due) ? localDateTime(item.due) : item.due;
  return <fieldset className="planner-dates" disabled={disabled}><legend>期限と作業予定</legend>
    <label>期限の日付<input type="date" value={localDue.slice(0, 10)} onChange={e => changeDue(e.target.value, localDue.slice(11, 16))} /></label>
    <label>期限の時刻（任意）<input type="time" disabled={!item.due} value={localDue.slice(11, 16)} onChange={e => changeDue(localDue.slice(0, 10), e.target.value)} /></label>
    {allowWork && <label>作業する日時（任意）<input type="datetime-local" value={item.workAt ? localDateTime(item.workAt) : ''} onChange={e => { setError(''); onChange({ workAt: e.target.value }); }} /></label>}
    <label className="planner-checkbox"><input type="checkbox" checked={item.priority} onChange={e => onChange({ priority: e.target.checked })} />ホームに優先表示</label>
    <small>日付だけの期限は、時刻未設定として表示します。</small>{error && <p role="alert">{error}</p>}
  </fieldset>;
}
function localDateTime(value: string) {
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(value)) return value.slice(0, 16);
  const date = new Date(value); const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000); return local.toISOString().slice(0, 16);
}
export function MemoChecklist({ memoId, items = [], onChange, disabled = false }: { memoId: string; items?: ChecklistItem[]; onChange: (items: ChecklistItem[]) => void; disabled?: boolean }) {
  const [text, setText] = useState(''); const [open, setOpen] = useState<string | null>(null);
  const live = items.filter(item => !item.deletedAt); const trash = items.filter(item => item.deletedAt && !isTrashExpired(item));
  const patch = (id: string, value: Partial<ChecklistItem>) => onChange(patchChecklist(items, id, value));
  return <div className="memo-checklist"><h4>チェック項目 <small>{live.filter(v => v.done).length} / {live.length} 完了</small></h4>
    <p>全体ToDoに載せたい項目だけ、登録を選べます。</p>
    {live.map(item => <div className={`checklist-row${item.done ? ' is-done' : ''}`} key={item.id}>
      <div className="checklist-main"><input aria-label={`${item.text}を完了`} type="checkbox" disabled={disabled} checked={item.done} onChange={e => patch(item.id, { done: e.target.checked })} />
        <input aria-label="チェック項目の内容" disabled={disabled} value={item.text} onChange={e => patch(item.id, { text: e.target.value })} />
      </div><div className="planner-actions"><label><input type="checkbox" disabled={disabled} checked={item.registered} onChange={e => patch(item.id, { registered: e.target.checked })} />全体ToDoに登録</label>
        <button type="button" onClick={() => setOpen(open === item.id ? null : item.id)} aria-expanded={open === item.id}>期限・詳細</button>
        <button type="button" disabled={disabled} onClick={() => patch(item.id, { deletedAt: new Date().toISOString() })}>ごみ箱へ</button></div>
      {open === item.id && <TaskDates item={item} disabled={disabled} onChange={value => patch(item.id, value)} />}
    </div>)}
    <form className="planner-add" onSubmit={e => { e.preventDefault(); if (!text.trim() || disabled) return; onChange(normalizeChecklist([...items, { id: `check-${crypto.randomUUID()}`, text: text.trim(), done: false, registered: false, due: '', priority: false, workAt: '', deletedAt: null }])); setText(''); }}>
      <input id={`check-add-${memoId}`} aria-label="新しいチェック項目" placeholder="例：教科書の例題を解く" value={text} onChange={e => setText(e.target.value)} disabled={disabled} /><button type="submit" disabled={disabled || !text.trim()}>追加</button>
    </form>
    {trash.length > 0 && <details><summary>チェック項目のごみ箱（30日間）</summary>{trash.map(item => <div key={item.id}>{item.text}<button type="button" disabled={disabled} onClick={() => patch(item.id, { deletedAt: null })}>復元</button></div>)}</details>}
  </div>;
}
