'use client';

import { useState, type FormEvent } from 'react';
import { buildQuickEntry, type QuickEntryDraft } from './planner-quick-entry-model';
import type { PersonalEvent, PersonalTodo } from './planner-model';

const EMPTY: QuickEntryDraft = {
  kind: 'event', title: '', day: '', time: '', endTime: '',
  due: '', workDay: '', workTime: '', note: '', priority: false, tags: [],
};

export function PlannerQuickEntry({ disabled, onAddEvent, onAddTodo }: {
  disabled: boolean;
  onAddEvent: (event: PersonalEvent) => void;
  onAddTodo: (todo: PersonalTodo) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<QuickEntryDraft>(EMPTY);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const edit = <K extends keyof QuickEntryDraft>(key: K, value: QuickEntryDraft[K]) => setDraft(previous => ({ ...previous, [key]: value }));
  function selectTemplate(kind: 'event' | 'todo', title = '', tags: string[] = []) {
    setDraft({ ...EMPTY, kind, title, tags });
    setOpen(true);
    setError('');
    setMessage('');
  }
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (disabled) return;
    try {
      const result = buildQuickEntry(draft, crypto.randomUUID());
      if (result.kind === 'event') onAddEvent(result.record);
      else onAddTodo(result.record);
      setMessage(`「${draft.title.trim()}」を一覧に追加しました。保存・同期の状態を確認してください。`);
      setOpen(false);
      setError('');
      setDraft(EMPTY);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '登録内容を確認してください。');
    }
  }
  return <details className="planner-quick-entry planner-home-card">
    <summary>＋ 予定・ToDoをすぐ登録（ゼミ・通院・資格勉強）</summary>
    <div className="planner-quick-shortcuts">
      <button type="button" disabled={disabled} onClick={() => selectTemplate('event', 'ゼミガイダンス')}>＋ ゼミガイダンス</button>
      <button type="button" disabled={disabled} onClick={() => selectTemplate('event', '通院')}>＋ 通院</button>
      <button type="button" disabled={disabled} onClick={() => selectTemplate('todo', '資格勉強', ['資格勉強'])}>＋ 資格勉強</button>
      <button type="button" disabled={disabled} onClick={() => selectTemplate('event')}>＋ その他の予定</button>
      <button type="button" disabled={disabled} onClick={() => selectTemplate('todo')}>＋ その他のToDo</button>
    </div>
    {message && <p role="status" className="planner-quick-status">{message}</p>}
    {open && <form className="planner-quick-form" onSubmit={submit}>
      <div className="planner-quick-form-head"><strong>{draft.kind === 'event' ? '予定を追加' : 'やることを追加'}</strong><button type="button" onClick={() => setOpen(false)}>閉じる</button></div>
      <label>タイトル<input required maxLength={10000} value={draft.title} disabled={disabled} onChange={e => edit('title', e.target.value)} placeholder={draft.kind === 'event' ? '例：研究室のゼミガイダンス' : '例：AWS SAA の問題集を進める'} /></label>
      {draft.kind === 'event'
        ? <>
          <div className="planner-quick-fields"><label>予定の日付<input aria-label="予定の日付" required type="date" value={draft.day} disabled={disabled} onChange={e => edit('day', e.target.value)} /></label>
          <label>開始時刻（任意）<input type="time" value={draft.time} disabled={disabled} onChange={e => edit('time', e.target.value)} /></label>
          <label>終了時刻（任意）<input type="time" value={draft.endTime} disabled={disabled} onChange={e => edit('endTime', e.target.value)} /></label></div>
          <label>メモ（任意）<input value={draft.note} maxLength={10000} disabled={disabled} onChange={e => edit('note', e.target.value)} placeholder="場所や持ち物など" /></label>
        </>
        : <>
          <div className="planner-quick-fields"><label>作業予定日（任意）<input aria-label="作業予定日" type="date" value={draft.workDay} disabled={disabled} onChange={e => edit('workDay', e.target.value)} /></label>
          <label>作業する時刻（任意）<input type="time" value={draft.workTime} disabled={disabled} onChange={e => edit('workTime', e.target.value)} /></label>
          <label>期限（任意）<input aria-label="期限" type="date" value={draft.due} disabled={disabled} onChange={e => edit('due', e.target.value)} /></label></div>
          <label>タグ（カンマ区切り）<input value={draft.tags.join(', ')} disabled={disabled} onChange={e => edit('tags', [...new Set(e.target.value.split(/[,、]/).map(t => t.trim()).filter(Boolean))])} placeholder="例：資格勉強, AWS" /></label>
          <label className="planner-quick-priority"><input type="checkbox" checked={draft.priority} disabled={disabled} onChange={e => edit('priority', e.target.checked)} />期限がなくてもホームに優先表示</label>
          <p className="planner-hint">「作業予定」は勉強する日、「期限」は提出・達成の締切です。時刻未設定なら推測しません。</p>
        </>}
      {error && <p role="alert">{error}</p>}
      <button type="submit" disabled={disabled || !draft.title.trim() || (draft.kind === 'event' && !draft.day)}>追加する</button>
    </form>}
  </details>;
}
