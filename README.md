# まなびメモ

講義ごとに授業回、本文ノート、PDF、付箋をまとめ、検索・見返し・復習と、任意の大学生活プランによる「遊びも学びも整える」管理を行うWebアプリです。ChatGPT Site版 v21の画面・端末内データ・主要操作を保ったまま、標準Next.jsプロジェクトへ移行しています。

## 主な機能

- 学期、時間割、講義、授業回
- 本文ノート、自動保存、ノート表示設定
- PDFの端末内保存、表示、本文抽出、検索と、参照情報だけを残す軽量化
- 付箋、タグ、ピン留め、復習、振り返り、元位置への復帰
- ノート・PDF・付箋の横断検索と、一覧・時間割表示
- 共通ごみ箱と30日間の復元
- PDFを含むバックアップ、復元、旧保存形式の移行
- 任意表示の大学生活プラン / Campus Muster（提出物、試験、出席、学習タスク、GPA、卒業要件）
- 許可された2〜3人の共有カレンダー（課題・確認事項・遊び候補、本人別の完了・参加可否、科目別進捗、メンバー色分け）
- Firebase Authenticationと、利用者が明示的に有効化する端末間同期
- PWA用Manifest、Service Worker、レスポンシブUI

### PDFの端末処理上限

ブラウザのメモリとクラウド同期の整合性を守るため、PDFは1ファイル75 MB・500ページまでです。25 MB以上または200ページ以上では処理前に警告し、本文抽出は合計200万文字までに制限します。画像中心のPDFは表示できますが、本文検索・見出し整理とOCRは利用できません。大きな資料はページを分け、必要な範囲だけ追加してください。

授業回で「容量を軽くする」を選ぶと、PDF本体・抽出本文・見出しを端末と同期対象から外し、ファイル名、総ページ数、最後に見たページ、メモのページ参照、照合用SHA-256だけを残せます。検索とオフラインPDF表示が必要な資料は完全保存のまま使い、軽量化した資料は元PDFを再追加すると表示と検索を復元できます。PDFを自動削除することはありません。

## 使用技術

- Next.js 16 / React 19 / TypeScript
- IndexedDB、localStorage（端末内データと後方互換）
- Node.js SQLite（設定不要のローカル開発）
- PostgreSQL（Vercel等の本番データベース）
- ローカルファイル保存、またはS3互換オブジェクトストレージ（同期PDF）
- Firebase Authentication
- pdfjs-dist / Lucide React / Tailwind CSS PostCSS

ChatGPT Sites用のVinext、Cloudflare Worker入口、D1/R2ランタイムバインディングには依存しません。

## セットアップ

Node.js 22.13以上を使用してください。

Windowsでは、ZIPを展開した後に `START_WINDOWS.cmd` をダブルクリックすると、初回のパッケージ導入から開発サーバーの起動まで進められます。詳しくは [WINDOWS_SETUP.md](WINDOWS_SETUP.md) を参照してください。

CMTRをFirebaseなしで画面レビューするときは、[`START_REVIEW_WINDOWS.cmd`](START_REVIEW_WINDOWS.cmd) をダブルクリックしてください。ローカル開発時だけCMTRを有効にし、`http://localhost:3000` で確認できます。本番buildではこのプレビューフラグは必ず無効になります。共有カレンダー、ログイン、端末間同期はプレビュー対象外です。

```bash
npm install
npm run dev
```

ブラウザで `http://localhost:3000` を開きます。環境変数がなくても、時間割、ノート、PDF、付箋、検索、バックアップは端末内で利用できます。Campus Musterのアカウント利用は既定では招待コード制で、2〜3人運営では `CAMPUS_ACCESS_MODE=authenticated` により認証済み利用者全員へ開放できます。Firebase未設定時も端末内の基本機能は利用可能です。フィードバックなどのサーバーデータは `.data/manabi-memo.sqlite`、同期PDFは `.data/objects` に保存されます。どちらもGit対象外です。

端末データの初期読込が8秒以内に完了しない場合は、既存ノートやPDFを変更せず通常画面へ進み、読込エラーと「端末データの読込を再試行」を表示します。この場合、ブラウザのサイトデータは削除せず、まず再試行またはバックアップ・復旧相談を利用してください。

## 環境変数

`.env.example` を `.env.local` へコピーし、必要な機能だけ設定します。

### Firebase Authentication

```dotenv
FIREBASE_API_KEY=
FIREBASE_AUTH_DOMAIN=
FIREBASE_PROJECT_ID=
FIREBASE_APP_ID=
ALLOWED_ACCOUNT_EMAILS=user1@example.com,user2@example.com,user3@example.com
```

Googleログインまたはメール認証を利用するときに必要です。Firebase Authenticationの承認済みドメインへ `localhost` と本番ドメインを追加してください。Firebaseの4項目はWeb Appの公開設定値です。サービスアカウント秘密鍵は保存しません。本番の `ALLOWED_ACCOUNT_EMAILS` には利用する2〜3人だけを指定し、第三者のログインと同期を拒否します。空欄は全認証ユーザーを許可するため、公開運営では使いません。

未設定のままでも端末内の基本機能は使えますが、アカウント同期と共有カレンダーは利用できません。Campusの個人データもまず端末内へ保存され、同期を明示的に有効化した場合だけ同じアカウントのPC・スマートフォン間で共有されます。別アカウントの個人データはサーバーDBとPDF保存先の両方で分離されます。共有カレンダーだけは `ALLOWED_ACCOUNT_EMAILS` に明示した2人以上の全員へ表示され、各メンバーは学びの完了状態または遊び候補の参加可否を自分の分だけ変更できます。個人予定は自動共有しません。オフライン時は最後の取得内容を表示し、変更はオンライン復帰後に行います。

### データベース

未設定時はローカルSQLiteを自動作成します。保存場所を変える場合は相対または絶対パスを指定できます。

```dotenv
DATABASE_URL=sqlite:.data/manabi-memo.sqlite
```

Vercelなど、実行時ファイルが永続化されない環境では外部PostgreSQLを設定します。

```dotenv
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DATABASE
DATABASE_SSL=true
DATABASE_POOL_SIZE=1
```

VercelではNeonのpooled connection stringを使い、アプリ側プールは `1` にします。必要なテーブルと索引は初回接続時に `db/schema.ts` から作成されます。

### 同期PDF

2〜3人のVercel本番では、無料枠10 GBのCloudflare R2 private bucketを推奨します。ブラウザは5分だけ有効なS3署名URLを受け取り、PDFをR2へ直接送受信します。これによりVercel Functionの4.5 MB上限を通さず、最大75 MBのPDFを扱えます。確定前、ダウンロード署名発行前、端末保存前にSHA-256を検証します。一時PDFは `staging/`、確定PDFは `accounts/` へ分け、24時間のAPI掃除とR2 lifecycleで中断時の一時ファイルも回収します。

```dotenv
S3_BUCKET=
S3_REGION=auto
S3_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
S3_FORCE_PATH_STYLE=false
LOCAL_FILE_STORE=.data/objects
```

Private Vercel Blobも同じ直接転送方式で利用できますが、Hobbyの保存枠は1 GBです。R2とVercel Blobを同時設定するとVercel Blobが優先されます。設定なしのローカル開発では `LOCAL_FILE_STORE` を使います。詳しい公開手順とR2 CORSは [DEPLOYMENT_VERCEL.md](DEPLOYMENT_VERCEL.md) を参照してください。

### 任意機能

```dotenv
CAMPUS_ACCESS_MODE=authenticated
CAMPUS_BETA_CODE=
FEEDBACK_ADMIN_EMAIL=
TRUST_CHATGPT_AUTH_HEADERS=false
```

`CAMPUS_ACCESS_MODE=authenticated` は認証済み利用者全員へCampusを開きます。既定の `invite` では `CAMPUS_BETA_CODE` が必要です。`TRUST_CHATGPT_AUTH_HEADERS` は、認証ヘッダーを外部から偽装できない信頼済みプロキシ配下で旧ChatGPTアカウント移行を行う場合だけ有効にします。通常のVercel公開では `false` のままにしてください。

## コマンド

```bash
npm run dev        # 開発サーバー
npm run typecheck  # TypeScript
npm run lint       # ESLint
npm test           # 保存・同期・安全性などのテスト
npm run build      # 本番ビルド
npm run start      # ビルド済みアプリの起動
npm run test:sync-api # 本番サーバーで同期HTTP APIを統合確認
npm run test:sync-live # PostgreSQL / S3実接続（SYNC_LIVE_TEST=true時）
npm run test:all   # 上記の一括確認
```

## ディレクトリ

```text
app/                 画面、機能モジュール、App Router API
app/api/             認証、同期、PDF、Campus、フィードバック
db/schema.ts         SQLite / PostgreSQL共通スキーマ
lib/server/          DB、ファイル保存、同一オリジン検証
public/              PWA、Service Workerテンプレート、PDF Worker、アイコン
scripts/             デプロイごとのService Worker生成
tests/               バックアップ、同期、安全性、Campus、復習
.github/workflows/   GitHub Actions
AGENTS.md            Codex向け開発ルール
ARCHITECTURE.md      画面・データ・保存境界
MIGRATION_REPORT.md  調査結果と移行制約
FEATURE_CHECKLIST.md 公開版との比較
```

## 公開版データの移行

公開中のChatGPT Siteとlocalhostは別オリジンなので、ブラウザのIndexedDBは自動では移りません。

1. 公開版の設定から、PDFを含む完全バックアップを書き出す
2. ローカル版の設定からバックアップを読み込む
3. 件数、ノート、PDF、付箋、Campus Musterを確認する
4. Firebaseと同期先を設定した後、内容を確認してクラウド同期を有効化する

旧SiteのD1/R2データや秘密情報は自動複製しません。別利用者のデータや残留データを誤って取り込まないためです。

## Vercelへデプロイ

2〜3人の個人・非商用運営では、Vercel Hobby、Neon Free PostgreSQL、Cloudflare R2、既存Firebase Authenticationを使います。詳しい作成・設定・確認順は [`DEPLOYMENT_VERCEL.md`](DEPLOYMENT_VERCEL.md) を参照してください。

GitHubのprivate repositoryをVercelへ接続すると、`main`へのpushごとにビルド・公開されます。デプロイごとにService Workerのキャッシュ版が変わり、利用中の端末には「今すぐ更新」が表示されます。Vercelのローカルファイルは永続化されないため、本番でSQLiteや `.data/objects` を正規保存先にしないでください。

## GitHubへ登録

このフォルダはGitリポジトリとして初期化済みです。

```bash
git add .
git commit -m "Describe the change"
git remote add origin https://github.com/USER/REPOSITORY.git
git push -u origin main
```

`.env.local`、`.data`、依存関係、ビルド成果物、旧Sites/Wrangler成果物は `.gitignore` で除外されます。

## セキュリティ

- データベースURL、S3秘密鍵、サービスアカウント鍵をGitへ追加しないでください。
- 同期はログインだけで開始せず、利用者の明示操作を必要とします。
- 別アカウントの同期メタデータが残る場合は自動送信を停止します。
- メールアドレスだけで異なる認証を統合しません。
- 共有カレンダーは許可リストが2人以上のときだけ有効になり、完了・参加可否は認証中の本人分だけ更新します。個人予定は自動共有しません。
- PDFは状態リビジョン、ノート版、SHA-256が一致した場合だけ同期します。
- デプロイ先では、実Firebase・Neon PostgreSQL・Cloudflare R2を接続してから、3人のGoogle / Emailログイン、共有カレンダーと本人別完了、75 MB PDF、PC・スマートフォン間の双方向同期と個人データの相互分離を受入確認してください。
