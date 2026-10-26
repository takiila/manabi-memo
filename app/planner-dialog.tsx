'use client';
import { useEffect, useRef, type ReactNode } from 'react';
export function PlannerDialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => dialog?.close(); }, []);
  return <dialog ref={ref} className="planner-dialog" aria-label={title} onCancel={onClose} onClick={e => { if (e.target === ref.current) { const rect = ref.current.getBoundingClientRect(); if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) onClose(); } }}><header className="planner-heading"><h2>{title}</h2><button type="button" autoFocus onClick={onClose}>閉じる</button></header>{children}</dialog>;
}
