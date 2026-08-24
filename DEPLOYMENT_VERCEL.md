# 2〜3人の個人運営向けVercel公開手順

## 採用構成

- アプリ: Vercel Hobby（個人・非商用）
- DB: Neon Free PostgreSQL
- PDF: Cloudflare R2 Standard（Private bucket、S3署名URL）
- 認証: 既存Firebase Authentication
- オフライン: IndexedDB + ビルド版付きService Worker

この構成では、3人を別々のFirebaseアカウントとして扱います。同じ人のPCとスマートフォンでは全データを同期し、別アカウント同士の状態とPDFは混ぜません。共同編集・他人へのノート共有は対象外です。

R2 Standardには月10 GBのストレージ無料枠と無料のインターネット向け転送があります。75 MBのPDFなら単純計算で約130冊分ですが、無料枠は無制限ではありません。R2の利用開始にはCloudflareでcheckoutと支払い方法登録が必要で、超過分は従量課金されるため、使用量通知を設定してください。支払い方法を登録しない運用を優先する場合はPrivate Vercel Blobへ切り替えられますが、Hobbyは合計1 GBで、2〜3人のPDF運用には余裕が少なくなります。

## 1. GitHub

1. このリポジトリ用のprivate repositoryを作る。
2. `main`をpushする。
3. `.env.local`、`.data`、`.next`、`node_modules`、`public/sw.js`が追跡されていないことを確認する。

## 2. Vercel

1. GitHub repositoryをVercelへImportする。
2. Framework PresetはNext.js、Build Commandは `npm run build` を使う。
3. Hobbyプランを個人・非商用用途で使用する。
4. PDFには次節のCloudflare R2を使用する。Vercel StorageのBlobは接続しない。

## 3. Cloudflare R2

1. CloudflareでR2を有効化し、Standard storage classのprivate bucketを1つ作る。
2. Object Read & Write権限をそのbucketだけに付与したAPI tokenを作る。
3. VercelのProduction・Previewへ次を設定する。値はGitへ保存しない。

```dotenv
S3_BUCKET=作成したbucket名
S3_REGION=auto
S3_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
S3_FORCE_PATH_STYLE=false
```

4. R2 bucketのCORSへ、実際の本番URLを指定する。署名URLは認証情報の代わりであり、CORS設定自体はアクセス制御ではない。

```json
[
  {
    "AllowedOrigins": ["https://実際の本番ドメイン"],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["Content-Type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 300
  }
]
```

5. Object lifecycle ruleを追加し、prefixが `staging/` のオブジェクトを2日後に削除する。同期APIも24時間を過ぎた未確定トランザクションを掃除しますが、ブラウザが完了通知前に閉じた場合もR2側のルールで一時PDFを必ず回収できます。`accounts/` にはこの削除ルールを適用しません。

R2を使う本番では `BLOB_READ_WRITE_TOKEN` と `BLOB_STORE_ID` を設定しません。PDFは5分だけ有効な署名URLでブラウザとR2間を直接転送し、完了時にサーバーが所有者・サイズ・SHA-256・状態revision・ノート版を照合します。確定したPDFだけを `accounts/` へサーバー側コピーし、一時保存の `staging/` と分離します。ダウンロード署名の発行前と端末への保存前の両方でSHA-256を検証します。

## 4. Neon

1. Neon FreeでPostgreSQL projectを作る。
2. Vercelとの距離が近いregionを選ぶ。
3. pooled connection stringをVercelの `DATABASE_URL` に設定する。
4. `DATABASE_SSL=true`、`DATABASE_POOL_SIZE=1` を設定する。

## 5. Firebase

Vercelへ次のFirebase Web App公開設定を追加します。値はGitへ保存しません。

```dotenv
FIREBASE_API_KEY=
FIREBASE_AUTH_DOMAIN=
FIREBASE_PROJECT_ID=
FIREBASE_APP_ID=
ALLOWED_ACCOUNT_EMAILS=user1@example.com,user2@example.com,user3@example.com
```

初回デプロイ後、Firebase AuthenticationのAuthorized domainsへ生成された `*.vercel.app` ドメインを追加します。GoogleログインとEmail/Passwordを有効にし、メール確認済み利用者だけが同期できることを確認します。

`ALLOWED_ACCOUNT_EMAILS` には利用する2〜3人だけをカンマ区切りで指定します。許可リスト外のFirebaseユーザーは同期API、Campus、共有カレンダーへ403で拒否されます。共有カレンダーは2人以上を設定した場合だけ有効です。各自が自分のアカウントをPC・スマートフォンの両方で使います。

## 6. その他の本番環境変数

```dotenv
DATABASE_URL=
DATABASE_SSL=true
DATABASE_POOL_SIZE=1
CAMPUS_ACCESS_MODE=authenticated
FEEDBACK_ADMIN_EMAIL=
TRUST_CHATGPT_AUTH_HEADERS=false
```

`CAMPUS_ACCESS_MODE=authenticated` により、認証できた3人全員が招待コードなしでCampus Muster・CMTR・GPA・卒業要件を利用できます。通常のVercel公開で `TRUST_CHATGPT_AUTH_HEADERS=true` にしません。`LOCAL_FILE_STORE` は本番では設定しません。

## 7. 公開後の合格確認

1. `/api/health` が `ok: true`、`database: postgresql`、`pdfStorage: cloudflare-r2-private`、`directPdfTransfer: true`、`campusAccess: authenticated` を返す。許可リスト外のテストアカウントでは同期が403になることも確認する。
2. 3つのFirebaseアカウントそれぞれで、PCから時間割・ノート・Campus提出物・GPA・卒業要件を別内容で登録して明示同期する。
3. 各アカウントをスマートフォンで開き、同じアカウントの内容だけが復元され、他2人の内容が表示されないことを確認する。
4. スマートフォン側で卒業要件の取得単位とノートを変更して同期し、同じ人のPCへ反映されることを確認する。
5. 1人が共有課題・確認事項・遊び候補を登録し、残り2人のPC・スマートフォンへ同じ内容と共有メモが表示されることを確認する。各自が自分の完了・参加可否だけを変更でき、未完了/未回答者、全員参加OK、科目別進捗が全端末で一致することを確認する。端末内の個人予定が自動共有されないことも確認する。
6. 共有予定を2端末から同時編集し、古い画面の保存が競合として拒否されること、ごみ箱へ移した項目を30日以内に復元できることを確認する。
7. 5 MB超と75 MB付近のPDFを同期し、Functionの4.5 MB上限を回避できることを確認する。
8. スマートフォンをオフラインにし、既存ノート・PDFの表示と編集保存、共有カレンダーの最終取得内容の表示を確認する。共有カレンダーはオンライン復帰後に変更し、個人データは明示同期する。
9. 同一アカウントでPC・スマートフォンを別々に編集し、revision競合を自動上書きせず選択画面で扱えることを確認する。
10. `main`へ更新をpushし、PC・スマートフォンに更新通知が出て新しい版へ切り替わることを確認する。
11. 発行から5分を過ぎた署名URLと、署名を外したR2 URLがPDFを返さないことを確認する。

## 公式資料

- [Vercel Hobby](https://vercel.com/docs/plans/hobby)
- [Vercel Functionsの4.5 MB制限](https://vercel.com/docs/functions/limitations)
- [Cloudflare R2料金](https://developers.cloudflare.com/r2/pricing/)
- [Cloudflare R2署名URL](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)
- [Cloudflare R2 CORS](https://developers.cloudflare.com/r2/buckets/cors/)
- [Cloudflare R2 Object lifecycle](https://developers.cloudflare.com/r2/buckets/object-lifecycles/)
- [Cloudflare R2利用開始](https://developers.cloudflare.com/r2/get-started/)
- [Vercel Blob使用量と料金](https://vercel.com/docs/vercel-blob/usage-and-pricing)
- [Neon料金](https://neon.com/pricing)
- [Firebase AuthenticationのAuthorized domains](https://firebase.google.com/docs/auth/faq-and-troubleshooting)
