'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { TransferCourse } from './course-transfer';
import type { InformationInbox } from './manabi-import-types';
import type { CatalogImportHandler } from './course-catalog';
import { timetableCatalogCandidates, planTimetableCandidate } from './timetable-catalog-model';

export function TimetableCatalogDialog({ inbox, courses, term, weekday, period, disabled, onClose, onImport, renderManual }: {
  inbox: InformationInbox; courses: TransferCourse[]; term: string; weekday: number | null; period: number | null;
  disabled: boolean; onClose: () => void; onImport: CatalogImportHandler; renderManual: (onCatalog: () => void) => ReactNode;
}) {
  const [manual, setManual] = useState(false), [query, setQuery] = useState(''), [message, setMessage] = useState('');
  const [selection, setSelection] = useState<{ id: string; inbox: string; courses: string } | null>(null);
  const [approved, setApproved] = useState(false);
  const closeButton = useRef<HTMLButtonElement>(null);
  const candidates = timetableCatalogCandidates(inbox, term, weekday, period, query);
  const stale = Boolean(selection && (selection.inbox !== JSON.stringify(inbox) || selection.courses !== JSON.stringify(courses)));
  const row = selection && !stale ? planTimetableCandidate(courses, inbox, selection.id, term, weekday, period) : null;
  const requiresApproval = row && (row.kind === 'update' || row.warnings.length > 0);
  useEffect(() => {
    if (manual) return;
    const previous = document.activeElement as HTMLElement | null;
    closeButton.current?.focus();
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab') return;
      const elements = Array.from(closeButton.current?.closest('[role="dialog"]')?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), a[href]') ?? []);
      const first = elements[0], last = elements.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    window.addEventListener('keydown', handleKey);
    return () => { window.removeEventListener('keydown', handleKey); previous?.focus(); };
  }, [manual, onClose]);
  function confirm() {
    if (disabled || !selection || !row || stale || row.kind === 'blocked' || (requiresApproval && !approved)) return;
    try {
      const current = planTimetableCandidate(courses, inbox, selection.id, term, weekday, period);
      onImport(inbox, [current.entry], {}, [current.key], selection.courses);
      onClose();
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : '登録できませんでした。'); }
  }
  if (manual) return renderManual(() => setManual(false));
  return <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
    <section className="course-dialog timetable-catalog-dialog" role="dialog" aria-modal="true" aria-labelledby="timetable-catalog-title" onMouseDown={event => event.stopPropagation()}>
      <div className="dialog-heading"><div><h2 id="timetable-catalog-title">カタログから講義を選ぶ</h2><p>{term} · {weekday ? `${['月', '火', '水', '木', '金', '土'][weekday - 1]}曜日 ${period}限` : 'すべての授業枠'}</p></div><button ref={closeButton} type="button" className="dialog-close" aria-label="閉じる" onClick={onClose}>×</button></div>
      <div className="inbox-actions"><button type="button" disabled>カタログから選ぶ</button><button type="button" onClick={() => setManual(true)}>手入力で登録</button></div>
      <p>選択だけでは登録しません。教員・教室・単位などを確認して確定すると、講義と第1回の空ノートを用意します。</p>
      <label>候補の講義名・教員を検索<input type="search" value={query} onChange={event => setQuery(event.target.value)} /></label>
      {!candidates.length && <p>該当する候補はありません。大学情報Inboxで対象年度・学期のカタログを取り込むか、手入力してください。曜日・時限不明の候補はこの枠へ自動配置しません。</p>}
      <div className="catalog-options">{candidates.map(record => record.item.type === 'course' && <article className="inbox-item" key={record.id}>
        <h3>{record.item.title}</h3><p>{record.item.data.instructor ?? '教員未確認'} · {record.item.data.room ?? '教室未確認'} · {record.item.data.credits == null ? '単位未確認' : `${record.item.data.credits}単位`} · {record.item.data.code ?? 'コード未確認'}</p>
        <p>情報集合: {record.collection}</p>
        <button type="button" disabled={disabled} aria-pressed={selection?.id === record.id} onClick={() => { setSelection({ id: record.id, inbox: JSON.stringify(inbox), courses: JSON.stringify(courses) }); setApproved(false); setMessage(''); }}>{record.item.title}を選ぶ</button>
      </article>)}</div>
      {stale && <p role="alert">確認中に候補・講義が変わりました。もう一度候補を選んでください。</p>}
      {row && <section className="inbox-card" aria-label="選んだ講義の登録内容">
        <h3>{row.course.title}</h3><p>{{ add: '新規登録', update: '既存講義を更新', same: '登録済み・ノートがなければ作成', blocked: '登録不可' }[row.kind]}</p>
        <dl>{[['年度・学期', row.course.term], ['曜日・時限', row.course.weekday ? `${['月', '火', '水', '木', '金', '土'][row.course.weekday - 1]}曜日 ${row.course.period}限` : '未配置'], ['教員', row.course.instructor], ['教室', row.course.room], ['単位', row.course.credits], ['科目コード', row.course.code]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value ?? '未確認'}</dd></div>)}</dl>
        <p>{row.entry.item.summary}</p><p>出典: {row.entry.item.source.title} {row.entry.item.source.locator}</p>{row.entry.item.source.url && <a href={row.entry.item.source.url} target="_blank" rel="noopener noreferrer">出典を確認</a>}
        {row.kind === 'update' && <><h4>現在の講義</h4><p>{row.existing?.title} · {row.existing?.instructor} · {row.existing?.room} · {row.existing?.credits}単位 · {row.existing?.weekday}曜日 / {row.existing?.period}限</p></>}
        {row.warnings.length > 0 && <ul className="inbox-warning">{row.warnings.map(value => <li key={value}>{value}</li>)}</ul>}
        {requiresApproval && <label className="inbox-check"><input type="checkbox" checked={approved} disabled={disabled} onChange={event => setApproved(event.target.checked)} />更新内容・未確認事項・重複を確認しました。既存ノート・PDFは保持します</label>}
        <button type="button" disabled={disabled || row.kind === 'blocked' || Boolean(requiresApproval && !approved)} onClick={confirm}>確認して時間割・ノートに登録</button>
      </section>}
      <p role="status">{message}</p>
    </section>
  </div>;
}
