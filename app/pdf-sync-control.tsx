import type { ChangeEvent } from 'react';
import type { PdfSyncMode } from './pdf-sync-model';

export default function PdfSyncControl({ mode, available, disabled, onChange, onSelect }: {
  mode: PdfSyncMode;
  available: boolean;
  disabled: boolean;
  onChange: (mode: PdfSyncMode) => void;
  onSelect: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  return <div className="pdf-sync-control">
    <label>PDF本体の保存
      <select aria-label="PDF本体の保存" value={mode} disabled={disabled || !available}
        onChange={event => onChange(event.target.value as PdfSyncMode)}>
        <option value="local-only">追加した端末だけ</option>
        <option value="cloud">全端末に同期</option>
      </select>
    </label>
    <small>ノート・課題・資料名・ページ参照は同期します。</small>
    {!available && <label className="attach-button">この端末でPDFを開くために追加
      <input type="file" accept="application/pdf,.pdf" onChange={onSelect} disabled={disabled} />
    </label>}
  </div>;
}
