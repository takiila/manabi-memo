# 無料プランでのメモ・ページ参照同期

基本はブラウザーのIndexedDBへの端末内保存です。ログインしても、利用者が同期を開始するまで送信しません。

同期するものはノート、付箋、予定、大学情報Inbox、資料名、ページ数、参照ページ、PDF照合用SHA-256です。PDF本体、PDF全体の抽出本文、本文から生成したトピックは送信しません。利用者が付箋に保存した引用文はメモの一部として同期されます。

PDFがない端末ではメモと参照ページを読み、LMSで元PDFの同じページを開いて確認できます。元PDFをアプリへ追加することもできます。クラウド反映時に同じ資料のPDFが端末内にある場合は保持し、クラウドのメモを反映します。PDFが異なる場合は自動で結び付けません。端末のPDFファイルを同期操作で削除しません。

## 公開設定

- Vercel Hobby（個人・非商用利用）
- Neon Free
- Firebase Spark（Googleログイン）
- `SYNC_PDF_MODE=references` をVercelの本番環境に設定
- R2・Blob・S3を契約せず、関連の秘密鍵を設定しない
- 有料プランへ自動変更しない。無料枠超過や通信失敗時は同期エラーとして表示し、端末内保存を続ける

無料プランには保存容量・通信・利用回数などの上限があります。無制限の同期や将来の無料プランの存続を保証するものではありません。定期的に完全バックアップを端末外へ書き出してください。

## 互換性

既存の軽量PDF参照の保存形式を利用するため、端末の保存スキーマは変更しません。旧クライアントによるPDFアップロードは本番のreferences設定で拒否します。既存のPDF付きクラウドデータの読み取り・整合性検証は維持します。新しいクライアントからの保存は参照のみです。

公式資料: [Vercel Hobby](https://vercel.com/docs/plans/hobby)、[Neon plans](https://neon.com/docs/introduction/plans)、[Firebase pricing plans](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans)。
