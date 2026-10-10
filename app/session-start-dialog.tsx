"use client";
import { useEffect, useState } from 'react';
import { AlertTriangle, BookOpen, Check, ChevronRight, FileText, LoaderCircle, Paperclip, StickyNote, Upload, X } from 'lucide-react';
import { MAX_PDF_FILE_SIZE_BYTES, pdfFileWarning, pdfSizeLabel } from './pdf-local';
import { isValidSessionNumber, normalizeSessionNumber } from './session-number-model';

export function SessionStartDialog({
  disabled,
  schedule,
  course,
  sessionNumber,
  setSessionNumber,
  draftPdf,
  setDraftPdf,
  starting,
  progress,
  error,
  existing,
  onClose,
  onStart,
}: {
  disabled: boolean;
  schedule: string;
  course: { title: string; room: string; instructor: string; term: string };
  sessionNumber: string;
  setSessionNumber: (value: string) => void;
  draftPdf: File | null;
  setDraftPdf: (value: File | null) => void;
  starting: boolean;
  progress: { message: string; progress: number };
  error: string;
  existing?: { scheduledOn?: string };
  onClose: () => void;
  onStart: (day: string) => void;
}) {
  const [draftDays, setDraftDays] = useState<Record<string, string>>({});
  const scheduledOn = draftDays[sessionNumber] ?? existing?.scheduledOn ?? "";
  const draftPdfWarning = draftPdf ? pdfFileWarning(draftPdf) : "";
  const draftPdfTooLarge = Boolean(draftPdf && draftPdf.size > MAX_PDF_FILE_SIZE_BYTES);

  useEffect(() => {
    function closeWithEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !starting) onClose();
    }
    window.addEventListener("keydown", closeWithEscape);
    return () => window.removeEventListener("keydown", closeWithEscape);
  }, [onClose, starting]);

  return (
    <div className="modal-backdrop session-backdrop" role="presentation" onMouseDown={() => { if (!starting) onClose(); }}>
      <section className="course-dialog session-dialog" role="dialog" aria-modal="true" aria-labelledby="session-dialog-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="session-dialog-top">
          <div className="session-course-icon"><BookOpen size={20} /></div>
          <div>
            <p>{schedule}{course.room ? "・" + course.room : ""}</p>
            <h2 id="session-dialog-title">{course.title}</h2>
            <span>{course.instructor || course.term}</span>
          </div>
          <button type="button" aria-label="閉じる" onClick={onClose} disabled={starting}><X size={19} /></button>
        </div>

        <div className="session-quick-row">
          <div>
            <strong>何回目の授業ですか？</strong>
            <small>次の回を自動で入れています</small>
          </div>
          <div className="session-stepper">
            <button type="button" aria-label="授業回を一つ戻す" onClick={() => setSessionNumber(String(Math.max(1, Number(normalizeSessionNumber(sessionNumber)) - 1)))} disabled={starting}>−</button>
            <label><span>第</span><input aria-label="授業回" inputMode="numeric" maxLength={3} value={sessionNumber} onChange={(event) => setSessionNumber(event.target.value.replace(/\D/g, ""))} disabled={starting} /><span>回</span></label>
            <button type="button" aria-label="授業回を一つ進める" onClick={() => setSessionNumber(String(Number(normalizeSessionNumber(sessionNumber)) + 1))} disabled={starting}>＋</button>
          </div>
        </div>
        <label className="session-date-field">授業日（任意）<input type="date" value={scheduledOn} onChange={event => setDraftDays(current => ({ ...current, [sessionNumber]: event.target.value }))} disabled={starting || disabled} /><small>指定すると統合カレンダーに表示されます。あとから変更・解除できます。</small></label>
        {existing && <p className="existing-hint session-existing"><Check size={15} /> この回のノートがあります。続きから開きます。</p>}

        <div className="optional-pdf dialog-pdf">
          <div><Paperclip size={18} /><span><strong>この回の講義資料</strong><small>PDFなしでも始められます</small></span></div>
          {draftPdf ? (
            <div className="selected-file">
              <FileText size={18} />
              <span>{draftPdf.name}<small>{pdfSizeLabel(draftPdf.size)}</small></span>
              <button type="button" aria-label="PDFを外す" onClick={() => setDraftPdf(null)} disabled={starting}><X size={16} /></button>
            </div>
          ) : (
            <label className="pdf-pick-button">
              <Upload size={16} /> PDFを選ぶ
              <input type="file" accept="application/pdf,.pdf" onChange={(event) => setDraftPdf(event.target.files?.[0] ?? null)} disabled={starting} />
            </label>
          )}
        </div>
        <p className="pdf-rights-note">個人学習で利用できる講義資料を選んでください。PDFはこの端末内で処理されます。</p>
        {draftPdfTooLarge && <p className="pdf-limit-warning" role="alert"><AlertTriangle size={16} /> PDFが大きすぎます（上限 {pdfSizeLabel(MAX_PDF_FILE_SIZE_BYTES)}）。ページを分けて追加してください。</p>}
        {!draftPdfTooLarge && draftPdfWarning && <p className="pdf-limit-warning"><AlertTriangle size={16} /> {draftPdfWarning}</p>}

        {starting && draftPdf && (
          <div className="start-progress">
            <div><LoaderCircle size={18} className="spin" /><span>{progress.message || "PDFを準備しています"}</span><b>{progress.progress}%</b></div>
            <i><span style={{ width: progress.progress + "%" }} /></i>
          </div>
        )}
        {error && <p className="form-error"><AlertTriangle size={17} /> {error}</p>}

        <button className="start-button session-start-button" onClick={() => onStart(scheduledOn)} disabled={!isValidSessionNumber(sessionNumber) || starting || disabled || draftPdfTooLarge}>
          {starting ? <LoaderCircle size={19} className="spin" /> : <StickyNote size={19} />}
          {starting ? "準備しています" : existing && !draftPdf ? "この授業のノートを続ける" : "この授業のノートを始める"}
          {!starting && <ChevronRight size={19} />}
        </button>
      </section>
    </div>
  );
}

