# アーキテクチャ

## 画面

| URL / 表示 | 主な実装 | 内容 |
|---|---|---|
| `/` 時間割・講義・作業・見返し・設定 | `app/page.tsx` | まなびメモ本体、端末保存、検索、バックアップ |
| `/` 大学生活プラン / Campus Muster | `app/campus-module.tsx` | 任意表示の学業・遊びの統合管理 |
| `/` 共有カレンダー | `app/shared-campus-calendar.tsx` | 許可メンバーの課題・確認事項・遊び候補と本人別の完了・参加可否 |
| `/` アカウント・同期 | `app/account-sync.tsx` | Firebase、初回同期、競合、PDF同期 |
| `/terms` | `app/terms/page.tsx` | 利用規約 |
| `/privacy` | `app/privacy/page.tsx` | プライバシーポリシー |
| `/feedback-admin` | `app/feedback-admin/page.tsx` | Firebase管理者の受信一覧 |

## 主要データ

| データ | 主な参照 | 保存 |
|---|---|---|
| Course | `id`, `term`, 曜日、時限、教室 | IndexedDB、同期state |
| SessionRecord | `courseId`, 本文、PDF情報、抽出本文、任意の軽量参照情報 | IndexedDB、同期state |
| Memo | `sessionId`, `courseId`, タグ、位置、ピン、復習 | IndexedDB、同期state |
| CampusState | 授業、提出物、試験、出席、学習タスク、GPA等 | IndexedDB、同期state |
| SharedCalendar | 種類、学期、科目/場所、期限、共有メモ、メンバー別の完了/参加可否 | サーバーDB、利用者別localStorageキャッシュ |
| PDF本体 | Session ID、SHA-256、ノート版 | IndexedDB、Cloudflare R2 / Private Vercel Blob / ローカルファイル |
| 同期メタデータ | Account ID、revision、fingerprint、device ID | localStorage、サーバーDB |

## 保存と同期

1. 起動時はIndexedDB接続からstate取得までを有限時間で確定する。期限超過時は読出しtransactionを中断してDBを閉じ、既存stateを変更せずに通常画面のエラーと再試行へ進む。遅れて接続が成功した場合もその接続を閉じる。
2. 画面操作はまず端末のIndexedDBへ保存する。
3. Firebaseログインだけではクラウド同期を開始しない。
4. 利用者が同期開始を選ぶと、端末とクラウドの有無・fingerprint・revisionを比較する。
5. 両方に異なる内容がある場合は自動上書きせず、残す側を選ぶ。
6. 状態保存後、対応するノート版のPDFだけをSHA-256付きで `staging/` へ保存する。R2 / S3 / Vercel Blobでは短時間の署名URLでブラウザから直接転送し、確定前にサーバーが再検証して `accounts/` へコピーする。未確定の一時PDFはAPI掃除とR2 lifecycleの二重で回収する。
7. オフライン中は端末保存を続け、復帰後にrevisionを再確認する。

PDF軽量参照は利用者の明示操作でだけ作成します。PDF本体と抽出内容を原子的に削除し、ファイル名、総ページ数、最後に見たページ、メモのページ参照、SHA-256をstateへ残します。軽量参照は検索・オフラインPDF表示の対象外で、元PDFの再追加により完全保存へ戻せます。

共有カレンダーは個人の同期stateとは別領域です。`ALLOWED_ACCOUNT_EMAILS` の2人以上だけが同じ予定を読み書きでき、回答行はFirebaseで認証した本人のメールに固定します。課題・確認事項では完了、遊び候補では参加可否として同じ安全な回答行を使います。共有画面へ明示登録していない個人予定は送信しません。予定の更新は `updatedAt` を使った楽観的ロックで競合を止め、削除は30日間のごみ箱を経て完全削除します。端末キャッシュはオフライン表示専用で、オフライン変更は受け付けません。

現在のクラウドstateは互換性を優先したbundle単位です。将来entity単位へ移す場合も、schemaVersionと参照IDを保つ移行処理が必要です。

## 実行環境

| 環境 | DB | PDF |
|---|---|---|
| ローカル、環境変数なし | Node.js SQLite | `.data/objects` |
| ローカル、外部サービス確認 | PostgreSQL | S3互換 |
| Vercel（2〜3人推奨） | Neon PostgreSQL | Cloudflare R2 private bucket（署名URL直送） |
| その他のNode.jsホスト | 外部PostgreSQL必須 | S3互換必須 |

`lib/server/database.ts` と `lib/server/object-store.ts` が環境差を吸収します。APIルートは保存先固有のSDKを直接扱わないでください。
