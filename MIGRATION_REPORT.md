# ChatGPT Siteからローカル版への移行記録

## 調査した公開版

- Site: まなびメモ
- 公開版: v21相当
- 公開URL: `https://manabi-memo.taku180418.chatgpt.site/`
- 元構成: React 19、TypeScript、Next.js互換App Router、Vinext、Cloudflare Worker
- 端末保存: IndexedDB、localStorage互換移行
- 認証: Firebase Authentication、旧ChatGPT認証は移行用
- クラウド: D1にアカウント・state・PDFメタデータ、R2にPDF本体
- ファイル: pdfjs-distで表示・本文抽出・検索、PDF本体は端末IndexedDBにも保存
- PWA: Manifest、Service Worker

## 移行先

- 標準Next.js 16の `next dev` / `next build` / `next start`
- ローカルDBはNode.js SQLiteを自動作成
- 本番DBは通常のPostgreSQL URLへ接続
- ローカルPDFはプロジェクト内のGit対象外フォルダへ保存
- 本番PDFはPrivate Vercel Blobへ署名URLで直接送受信し、S3互換APIも代替として維持
- Firebase ID tokenは従来どおり公開鍵で検証
- 同一オリジン検証はVercel等のforwarded hostにも対応
- フィードバック管理はChatGPTヘッダーからFirebase管理者認証へ変更

## コード移行が完了した機能

- 学期、時間割、講義、授業回
- 本文ノート、自動保存、表示設定
- PDF追加、端末保存、ページ表示、本文抽出、検索
- 付箋、タグ、ピン、復習、振り返り、元位置
- ノート・PDF・付箋の検索、一覧・時間割表示
- バックアップ、復元、旧データ移行
- 共通ごみ箱、30日復元
- Campus Muster任意表示と既存データ構造
- Firebase Google / Email認証、メール確認、パスワード再設定
- 初回同期の選択、競合停止、所有者不一致停止、オフライン復帰
- PDFのrevision / noteVersion / SHA-256検証
- レスポンシブCSS、PWA資産、規約、プライバシー

## 置き換えた機能

| 公開Site | ローカル版 |
|---|---|
| SitesのD1バインディング | SQLite / PostgreSQLアダプター |
| SitesのR2バインディング | Private Vercel Blob / ローカルファイル / S3互換アダプター |
| Vinext / Vite / Worker入口 | 標準Next.js Node.js runtime |
| ChatGPT管理者ヘッダー | Firebase + `FEEDBACK_ADMIN_EMAIL` |
| Sites環境変数 | `.env.local` / ホスティング環境変数 |
| Sites公開履歴 | Git / GitHub / ホスティングのデプロイ履歴 |

## 直接移行できないもの

- ChatGPT Siteの公開履歴、専用URL、アクセス設定
- Site側D1/R2に保存済みのクラウドデータの自動複製
- Sites dispatcherが保証していたChatGPT認証ヘッダー

公開版の利用者データは、公開版でPDFを含むバックアップを書き出し、ローカル版へ読み込みます。旧クラウドデータを直接コピーしないことで、秘密情報や別利用者データの混入を避けます。

## 確認結果

- 標準Next.js本番ビルド成功
- TypeScript成功
- ESLint成功
- モデル・保存・バックアップ・旧CMTR移行・同期安全性テスト成功
- 本番サーバー起動、`/`、`/privacy`、`/terms`表示成功
- Firebase未設定時の設定API、未認証API、SQLiteフィードバック保存を確認
- 同期HTTP APIでprepare → PDF upload → commit、部分失敗からの再開、revision競合、所有者分離、欠損PDF、削除マーカーを確認
- PostgreSQL 18.4とMinIO S3互換サーバーを実プロセスで起動し、本番Next.jsからprepare → upload → commit、同一アカウント2端末相当、競合、誤SHA-256、同一トランザクション再開、所有者分離、PDFバイト一致、削除を確認
- 旧公開版の実Firebase Web設定を取得し、Identity Toolkit応答、`localhost`承認済みドメイン、ローカル本番ビルドでのFirebase SDK初期化とGoogle / Email認証UI表示を確認
- 文字検索可能PDF、画像のみPDF、220ページPDF、36 MB PDFを実際に選択し、本文抽出、OCR案内、ページ送り、容量・ページ数警告、canvas描画を確認
- 390 × 844 pxで時間割、講義、ノート、PDFを確認し、横スクロールなし・モバイルメニュー表示を確認
- 本番サーバーを停止した状態で、アプリ、端末データ、保存済み36 MB PDFを再読込し、オフライン編集を保存。サーバー復帰後もノートとPDFが残ることを確認
- 公開版ブラウザで、講義作成 → 授業回 → 本文ノート → 付箋 → タグ → ピン → ノート検索 → 付箋検索 → 時間割復帰を確認

公開版で初回hydrationのReact警告を1件確認したため、ローカル版では端末データ読込中に安定した初期画面を表示するよう変更しました。公開中のSite自体には変更していません。

## 今回クローズした未確認事項

- 旧CMTRの学期IDを現行の学期名へ変換し、講義・授業回・付箋・Campusデータの参照を保持する移行テストを追加
- バックアップ追加読込時のID衝突を再採番し、`courseId`、`sourceId`、授業回PDF IDまで追従させる統合テストを追加
- stateとPDFをprepare / upload / commitの一単位として扱い、全PDFのsize・SHA-256・revision・noteVersionが揃う前は新stateを公開しないよう変更
- 同一アカウントの2端末相当、別アカウント、途中失敗、再開、競合、PDF欠損を本番Next.jsのHTTP統合テストで確認
- 実PostgreSQL 18.4と実MinIOオブジェクトストレージでも同じ同期シナリオを通し、試験後にPDFオブジェクトと同期PDF行が0件へ戻ることを確認
- 5xx・通信障害時の同期再試行を独立した回帰テストで確認
- 大容量・多ページ・画像のみ・文字検索可能PDF、モバイル幅、完全オフライン再読込と復帰を実ブラウザで確認
- Private Vercel Blob向けに5分間だけ有効な直接転送URLを実装し、所有者・トランザクション・revision・noteVersion・size・SHA-256を確定前後で検証
- デプロイ単位のService Worker生成と更新通知を実装し、「今すぐ更新」による新キャッシュへの切替を実ブラウザで確認
- コードフォルダをGit管理し、秘密情報・生成物を除外した初期コミットを作成

以上により、旧版との差分として残っていたコード・データ移行・ローカル通常利用の未確認項目はクローズしました。外部サービスと物理端末を必要とする受入確認は、次節のとおり完了扱いにしていません。

## デプロイ先でのみ行える受入確認

PostgreSQL / S3アダプター自体はPostgreSQL 18.4とMinIOで実接続確認済みです。Neon Free / Private Vercel Blob、本人のFirebaseアカウント、物理スマートフォンは、この作業環境に資格情報や接続端末がないため、引き続き公開URLでの受入確認です。環境変数を設定した環境では `npm run test:sync-live` で同じプロバイダー統合試験を再実行できます。公開手順と合格条件は `DEPLOYMENT_VERCEL.md` に固定しました。

`app/page.tsx` は公開版の細かな挙動を保つため、移行時点では大きなオーケストレーターを維持しています。新規機能はここへ積み増さず、既存画面の分割はE2E回帰テストを加えながら段階的に進めます。
