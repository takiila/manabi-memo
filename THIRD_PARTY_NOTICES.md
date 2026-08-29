# Third-party notices

このリポジトリは、`package.json` / `package-lock.json` に記載したopen-source packagesを利用しています。各packageは、それぞれの配布元ライセンスに従います。

## PDF.js / pdfjs-dist

`public/pdf.worker.min.mjs` はMozilla PDF.jsの配布物です。

- Project: https://github.com/mozilla/pdf.js
- Package: `pdfjs-dist`
- License: Apache License 2.0
- License text: https://www.apache.org/licenses/LICENSE-2.0

worker file内にも配布元のlicense noticeが含まれています。このファイルはアプリ独自コードの `LICENSE` ではなく、Apache License 2.0の条件に従います。

## Lucide

画面内のiconは `lucide-react` を利用しています。

- Project: https://lucide.dev/
- License: ISC License（Feather由来iconはMIT License）

そのほかのframework、library、development dependencyのversionと配布情報は `package-lock.json` を参照してください。
