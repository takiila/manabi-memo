'use client';

import { useState } from 'react';
import { loadAllPdfs } from './local-files';

export default function DevicePdfRecovery() {
  const [entries, setEntries] = useState<Array<{ id: string; blob: Blob }>>([]);
  const [message, setMessage] = useState('');
  async function inspect() {
    try {
      const files = (await loadAllPdfs()).filter(entry => entry.id.startsWith('retained-pdf:'));
      setEntries(files);
      setMessage(files.length ? `${files.length}件のPDFをこの端末に保管しています。` : '保管された旧PDFはありません。');
    } catch { setMessage('端末のPDFを読み込めませんでした。もう一度お試しください。'); }
  }
  function download(entry: { id: string; blob: Blob }) {
    const url = URL.createObjectURL(entry.blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `retained-${entry.id.slice(-64, -52)}.pdf`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <div className="device-pdf-recovery">
    <button type="button" onClick={() => void inspect()}>この端末に残した旧PDFを確認</button>
    {message && <small role="status">{message}</small>}
    {entries.map((entry, index) => <button type="button" key={entry.id} onClick={() => download(entry)}>旧PDF {index + 1}を保存（{Math.ceil(entry.blob.size / 1024)} KB）</button>)}
  </div>;
}
