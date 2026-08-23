# 個人運営向けVercel公開手順

## 採用構成

- アプリ: Vercel Hobby（個人・非商用）
- DB: Neon Free PostgreSQL
- PDF: Private Vercel Blob
- 認証: 既存Firebase Authentication
- オフライン: IndexedDB + ビルド版付きService Worker

無料枠を超えた場合、HobbyのVercel Blobは追加請求ではなく利用停止になります。端末内データは残りますが、クラウド同期が止まるため、Blobの使用量を定期的に確認してください。

## 1. GitHub

1. このリポジトリ用のprivate repositoryを作る。
2. `main`をpushする。
3. `.env.local`、`.data`、`.next`、`node_modules`、`public/sw.js`が追跡されていないことを確認する。

## 2. Vercel

1. GitHub repositoryをVercelへImportする。
2. Framework PresetはNext.js、Build Commandは `npm run build` を使う。
3. Hobbyプランを個人・非商用用途で使用する。
4. StorageからPrivate Blob Storeを作り、Production・Previewへ接続する。
5. 接続によって `BLOB_READ_WRITE_TOKEN` が追加されたことを確認する。OIDC接続を使う場合は `BLOB_STORE_ID` もVercel側で管理する。

PrivateではなくPublic Blob Storeを選ぶとPDFの認可を保てないため使用しません。

## 3. Neon

1. Neon FreeでPostgreSQL projectを作る。
2. Vercelとの距離が近いregionを選ぶ。
3. pooled connection stringをVercelの `DATABASE_URL` に設定する。
4. `DATABASE_SSL=true`、`DATABASE_POOL_SIZE=1` を設定する。

## 4. Firebase

Vercelへ次のFirebase Web App公開設定を追加します。値はGitへ保存しません。

```dotenv
FIREBASE_API_KEY=
FIREBASE_AUTH_DOMAIN=
FIREBASE_PROJECT_ID=
FIREBASE_APP_ID=
```

初回デプロイ後、Firebase AuthenticationのAuthorized domainsへ生成された `*.vercel.app` ドメインを追加します。GoogleログインとEmail/Passwordを有効にし、メール確認済み利用者だけが同期できることを確認します。

## 5. その他の本番環境変数

```dotenv
DATABASE_URL=
DATABASE_SSL=true
DATABASE_POOL_SIZE=1
CAMPUS_BETA_CODE=
FEEDBACK_ADMIN_EMAIL=
TRUST_CHATGPT_AUTH_HEADERS=false
```

通常のVercel公開で `TRUST_CHATGPT_AUTH_HEADERS=true` にしません。S3環境変数と `LOCAL_FILE_STORE` はPrivate Vercel Blobを使う本番では設定しません。

## 6. 公開後の確認

1. `/api/health` が `ok: true`、`database: postgresql`、`pdfStorage: vercel-blob-private`、`directPdfTransfer: true` を返す。加えてVercel管理画面でBlob StoreがPrivateであることを確認する。
2. PCでGoogle / Emailログインし、同期を明示的に開始する。
3. 5 MB超と75 MB付近のPDFを同期し、Functionの4.5 MB上限を回避できることを確認する。
4. スマートフォンで同じアカウントへログインし、クラウド側を採用してPDFを含め復元する。
5. スマートフォンをオフラインにし、既存ノート・PDFの表示と編集保存を確認する。
6. オンライン復帰後、revision競合を自動上書きせず選択画面で扱えることを確認する。
7. `main`へ更新をpushし、PC・スマートフォンに更新通知が出て新しい版へ切り替わることを確認する。
8. 発行から5分を過ぎた署名URLと、署名を外したBlob URLがPDFを返さないことを確認する。

## 公式資料

- [Vercel Hobby](https://vercel.com/docs/plans/hobby)
- [Vercel Functionsの4.5 MB制限](https://vercel.com/docs/functions/limitations)
- [Vercel Blob署名URL](https://vercel.com/changelog/vercel-private-blob-is-now-generally-available)
- [Vercel Blob使用量と料金](https://vercel.com/docs/vercel-blob/usage-and-pricing)
- [Neon料金](https://neon.com/pricing)
- [Firebase AuthenticationのAuthorized domains](https://firebase.google.com/docs/auth/faq-and-troubleshooting)
