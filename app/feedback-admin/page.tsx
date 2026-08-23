"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { authenticatedFetch, observeFirebaseUser, signInWithGoogle, signOutFirebase } from "../firebase-auth-client";

type FeedbackItem = { id: string; category: string; message: string; reply_email: string | null; source_view: string; created_at: number };

const categoryLabels: Record<string, string> = { bug: "不具合", usability: "使いにくい", request: "機能の希望", other: "その他" };

export default function FeedbackAdminPage() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [items, setItems] = useState<FeedbackItem[] | null>(null);
  const [message, setMessage] = useState("");

  const loadItems = useCallback(async () => {
    setMessage("");
    const response = await authenticatedFetch("/api/feedback/admin", { cache: "no-store" });
    const body = await response.json() as { items?: FeedbackItem[]; error?: string };
    if (!response.ok) { setItems(null); setMessage(body.error ?? "読み込めませんでした。"); return; }
    setItems(body.items ?? []);
  }, []);

  useEffect(() => {
    let cleanup: () => void = () => {};
    void observeFirebaseUser((user, available) => {
      setEnabled(available);
      setSignedIn(Boolean(user?.emailVerified));
      if (user?.emailVerified) void loadItems();
    }).then((next) => { cleanup = next; });
    return () => cleanup();
  }, [loadItems]);

  return <main className="admin-page">
    <header className="admin-heading">
      <div><p className="eyebrow">FEEDBACK INBOX</p><h1>届いたフィードバック</h1><p>Firebaseで確認した管理者だけが閲覧できます。送信から180日を超えた内容は削除されます。</p></div>
      <nav><Link href="/">アプリへ戻る</Link>{signedIn && <button type="button" onClick={() => void signOutFirebase()}>ログアウト</button>}</nav>
    </header>
    {enabled === false ? <section className="admin-empty"><h2>Firebase設定が必要です</h2><p>環境変数を設定してから開き直してください。</p></section>
      : !signedIn ? <section className="admin-empty"><h2>管理者としてログイン</h2><p>FEEDBACK_ADMIN_EMAILに設定したGoogleアカウントを使用してください。</p><button type="button" onClick={() => void signInWithGoogle()}>Googleでログイン</button></section>
      : message ? <section className="admin-empty"><h2>確認できませんでした</h2><p>{message}</p></section>
      : items === null ? <section className="admin-empty"><h2>読み込み中です</h2></section>
      : items.length ? <div className="admin-feedback-list">{items.map((item) => <article key={item.id}><header><span>{categoryLabels[item.category] ?? item.category}</span><time>{new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Tokyo" }).format(new Date(item.created_at))}</time></header><p>{item.message}</p><footer><small>送信画面：{item.source_view}</small>{item.reply_email && <a href={`mailto:${item.reply_email}`}>{item.reply_email}へ返信</a>}</footer></article>)}</div>
      : <section className="admin-empty"><h2>まだ届いていません</h2><p>利用者がアプリ内から送信すると、こちらに表示されます。</p></section>}
  </main>;
}
