# アーキテクチャ

## 画面

| URL / 表示 | 主な実装 | 内容 |
|---|---|---|
| `/` 時間割・講義・作業・見返し・設定 | `app/page.tsx` | まなびメモ本体、端末保存、検索、バックアップ |
| `/` Campus Muster | `app/campus-module.tsx` | 任意表示の大学生活管理 |
| `/` アカウント・同期 | `app/account-sync.tsx` | Firebase、初回同期、競合、PDF同期 |
| `/terms` | `app/terms/page.tsx` | 利用規約 |
| `/privacy` | `app/privacy/page.tsx` | プライバシーポリシー |
| `/feedback-admin` | `app/feedback-admin/page.tsx` | Firebase管理者の受信一覧 |

## 主要データ

| データ | 主な参照 | 保存 |
|---|---|---|
| Course | `id`, `term`, 曜日、時限、教室 | IndexedDB、同期state |
| SessionRecord | `courseId`, 本文、PDF情報、抽出本文 | IndexedDB、同期state |
| Memo | `sessionId`, `courseId`, タグ、位置、ピン、復習 | IndexedDB、同期state |
| CampusState | 授業、提出物、試験、出席、学習タスク、GPA等 | IndexedDB、同期state |
| PDF本体 | Session ID、SHA-256、ノート版 | IndexedDB、Private Vercel Blob / ローカルファイル / S3 |
| 同期メタデータ | Account ID、revision、fingerprint、device ID | localStorage、サーバーDB |

## 保存と同期

1. 画面操作はまず端末のIndexedDBへ保存する。
2. Firebaseログインだけではクラウド同期を開始しない。
3. 利用者が同期開始を選ぶと、端末とクラウドの有無・fingerprint・revisionを比較する。
4. 両方に異なる内容がある場合は自動上書きせず、残す側を選ぶ。
5. 状態保存後、対応するノート版のPDFだけをSHA-256付きで保存する。Vercel Blobでは短時間の署名URLでブラウザから直接転送し、確定前にサーバーが再検証する。
6. オフライン中は端末保存を続け、復帰後にrevisionを再確認する。

現在のクラウドstateは互換性を優先したbundle単位です。将来entity単位へ移す場合も、schemaVersionと参照IDを保つ移行処理が必要です。

## 実行環境

| 環境 | DB | PDF |
|---|---|---|
| ローカル、環境変数なし | Node.js SQLite | `.data/objects` |
| ローカル、外部サービス確認 | PostgreSQL | S3互換 |
| Vercel（推奨） | Neon PostgreSQL | Private Vercel Blob（署名URL直送） |
| その他のNode.jsホスト | 外部PostgreSQL必須 | S3互換必須 |

`lib/server/database.ts` と `lib/server/object-store.ts` が環境差を吸収します。APIルートは保存先固有のSDKを直接扱わないでください。
