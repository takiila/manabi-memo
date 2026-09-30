'use client';

import type { InboxCourseRow } from './inbox-course-model';

export function InboxCoursePreview({ rows, terms, selected, disabled, onTerm, onSelect }: {
  rows: InboxCourseRow[]; terms: Record<string, string>; selected: string[]; disabled: boolean;
  onTerm: (key: string, term: string) => void; onSelect: (key: string, checked: boolean) => void;
}) {
  if (!rows.length) return null;
  return <section className="inbox-card" aria-label="時間割・ノートへの反映プレビュー">
    <h3>時間割・ノートにも登録</h3>
    <p>選んだ講義を登録し、授業ノートがなければ第1回の空ノートを用意します。既存の本文・PDF・付箋は残します。既存講義の更新はチェックしたものだけです。</p>
    <p>曜日・時限が不明なら「時間割に未配置」へ登録します。修得済み・候補の科目は、登録対象から外してください。</p>
    {rows.map(row => <article className="inbox-item" key={row.key}>
      <h4>{row.course.title}</h4>
      <p>{{ add: '講義を新規登録', update: '既存講義の更新候補', same: '登録済み・変更なし', blocked: '要修正・反映不可' }[row.kind]} · {row.course.weekday ? `${['月', '火', '水', '木', '金', '土'][row.course.weekday - 1]}曜 ${row.course.period}枠` : '曜日・時限未設定'}</p>
      <label>対象年度・学期<input value={terms[row.key] ?? row.course.term} disabled={disabled} placeholder="2026年度 後期" onChange={event => onTerm(row.key, event.target.value)} /></label>
      {row.warnings.length > 0 && <ul className="inbox-warning">{row.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>}
      <label className="inbox-check"><input type="checkbox" disabled={disabled} checked={selected.includes(row.key)} onChange={event => onSelect(row.key, event.target.checked)} />{row.kind === 'same' ? '登録済み講義を確認し、ノートがなければ作成する' : row.kind === 'update' ? '変更内容を確認して既存講義を更新する' : 'この講義を時間割・ノートに登録する'}</label>
      <details><summary>反映する講義情報{row.existing ? 'と現在の情報' : ''}</summary>{row.existing && <><h4>現在</h4><pre>{JSON.stringify(row.existing, null, 2)}</pre></>}<h4>反映後</h4><pre>{JSON.stringify(row.course, null, 2)}</pre></details>
    </article>)}
  </section>;
}
