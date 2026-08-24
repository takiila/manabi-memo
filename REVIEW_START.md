# CMTRをローカルでレビューする

## 一番簡単な方法

1. このフォルダの `START_REVIEW_WINDOWS.cmd` をダブルクリックする。
2. 初回はパッケージ導入が終わるまで待つ。
3. 黒い画面に起動メッセージが出たら、ブラウザで <http://localhost:3000> を開く。
4. 画面の「大学生活」または「Campus Muster」を押す。
5. 終了するときは黒い画面を選び、`Ctrl+C` を押す。

この起動方法ではFirebaseや招待コードがなくても、CMTRの個人用画面をレビューできます。データはレビューに使ったブラウザ内へ保存されます。

共有カレンダー、Firebaseログイン、別端末同期、他ユーザーとの共有は動きません。それらは認証済みの受入環境で確認します。

## 手動で起動する場合

このフォルダでPowerShellを開き、次を実行します。

```powershell
$env:NEXT_PUBLIC_CAMPUS_LOCAL_PREVIEW = "true"
npm install
npm run dev
```

その後、<http://localhost:3000> を開きます。PowerShellを閉じるとプレビュー用環境変数も消えます。
