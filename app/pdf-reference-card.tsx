"use client";

import { FileArchive, Paperclip, SearchX } from "lucide-react";
import type { ChangeEvent } from "react";

export default function PdfReferenceCard({ fileName, pageCount, lastPage, memoPages, releasedAt, onPageChange, onSelect, disabled }: {
  fileName: string;
  pageCount: number;
  lastPage: number;
  memoPages: number[];
  releasedAt: string | null;
  onPageChange: (page: number) => void;
  onSelect: (event: ChangeEvent<HTMLInputElement>) => void;
  disabled: boolean;
}) {
  const pages = [...new Set(memoPages.filter((page) => page >= 1 && page <= pageCount))].sort((left, right) => left - right);
  return (
    <section className="pdf-reference-card" aria-label="軽量PDF参照">
      <span className="pdf-reference-icon"><FileArchive size={22} /></span>
      <div className="pdf-reference-copy">
        <p>LIGHTWEIGHT REFERENCE</p>
        <h2>{fileName || "講義資料"}</h2>
        <div><span>全{pageCount}ページ</span><label>参照ページ <input type="number" min="1" max={pageCount} value={lastPage} onChange={(event) => onPageChange(Math.min(Math.max(1, Number(event.target.value) || 1), pageCount))} /></label>{releasedAt && <span>{formatDate(releasedAt)}に軽量化</span>}</div>
        <p className="pdf-reference-pages">{pages.length > 0 ? `付箋の参照ページ: ${pages.map((page) => `${page}p`).join("・")}` : "ページ参照は、PDFを再追加した後も同じ位置へ戻れます。"}</p>
        <small><SearchX size={13} /> PDF本体と抽出テキストは保存していません。表示・本文検索には元のPDFを再追加してください。</small>
      </div>
      <label className="pdf-reference-restore"><Paperclip size={16} /> 元のPDFを再追加<input type="file" accept="application/pdf,.pdf" onChange={onSelect} disabled={disabled} /></label>
    </section>
  );
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric" }).format(date) : "";
}
