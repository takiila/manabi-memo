'use client';
import { useState } from 'react';
export function TagInput({ tags, disabled, onChange }: { tags: string[]; disabled: boolean; onChange: (tags: string[]) => void }) {
  const [draft, setDraft] = useState(tags.join(', '));
  const [baseline, setBaseline] = useState(tags.join(', '));
  const canonical = tags.join(', ');
  if (canonical !== baseline) { setBaseline(canonical); setDraft(canonical); }
  return <input value={draft} disabled={disabled} onChange={e => { const value = e.target.value; setDraft(value); const parsed = [...new Set(value.split(',').map(v => v.trim()).filter(Boolean))]; setBaseline(parsed.join(', ')); onChange(parsed); }} />;
}
