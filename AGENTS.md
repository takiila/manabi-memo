# まなびメモ 開発ガイド

## プロジェクト

講義、授業回、本文ノート、PDF、付箋、検索、復習と、任意のCampus Musterを扱うoffline-firstのNext.jsアプリです。端末内データを先に保存し、Firebaseログイン後も利用者が有効化するまでクラウドへ送信しません。

## 変更してはいけない仕様

- 講義、授業回、ノート、PDF、付箋、検索、バックアップ、共通ごみ箱を削除・簡略化しない。
- 削除データは30日間復元でき、自動削除よりarchived / trashを優先する。
- 別アカウントの端末データを確認なしにクラウドへ送信しない。
- メールアドレスだけでFirebase、Google、旧ChatGPTの利用者を自動統合しない。
- PDF同期は状態リビジョン、ノート版、SHA-256の検証を外さない。
- PDF本体を自動的に軽量化・削除しない。軽量参照へ変えるときは利用者の明示確認を通し、元ファイル・ページ参照・SHA-256を残す。
- Campus Musterは任意表示とし、初期状態で主画面へ強制表示しない。
- 共有カレンダーは `ALLOWED_ACCOUNT_EMAILS` の2〜3人だけに開き、各メンバーの完了・遊び候補への参加可否は認証中の本人だけが変更できるようにする。
- 共有カレンダーには利用者が明示登録した予定だけを送り、端末内の個人予定を自動共有しない。
- 共有カレンダーと個人のノート・PDF・GPA・卒業要件の保存領域を混同しない。
- `courseId`、`termId`、`sourceType`、`sourceId`などの参照IDを移行時に壊さない。
- IndexedDBと旧localStorage保存形式の後方互換を維持する。
- 初期の端末データ読込は有限時間で成功・失敗を確定し、失敗時も既存state・ノート・PDFを自動削除または空状態で上書きしない。
- 公開中のChatGPT Siteを、このリポジトリから自動更新・削除しない。

## 保存境界

- ブラウザ: IndexedDBの状態・PDF、localStorageの端末同期メタデータ
- サーバーDB: ローカルSQLite、公開時PostgreSQL
- PDFオブジェクト: ローカルファイル、公開時S3互換ストレージ
- 認証: Firebase ID tokenをサーバーで検証

サーバー実装からブラウザ保存を正規データとして直接読み取らないでください。クラウド復元中の状態と端末状態を自動マージせず、既存の選択画面を通します。

## コマンド

- `npm install`
- `npm run dev`
- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run build`
- `npm run test:all`

## 変更時の確認

保存形式を変更するときは、正規化、バックアップ復元、スキーマ版、旧データ読み込みを同時に更新します。同期を変更するときは、local-only、cloud-only、両方あり、競合、所有者不一致、削除済みクラウド、PDF版不一致を確認します。UI変更はPC幅とスマートフォン幅の両方で確認します。

初期hydrationを変更するときは、IndexedDB接続だけでなくstate request全体のdeadline、期限時のtransaction中断、遅延接続のclose、再試行、正常な既存データの非破壊を確認します。

大きな `app/page.tsx` は挙動の互換性を優先して移植しています。新しい機能を追加するときは同ファイルへ積み増さず、ドメイン単位のコンポーネント、hook、modelへ分けてください。既存画面の分割は、保存・検索・ドラッグ・PDF操作の回帰テストを追加しながら段階的に行います。

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
