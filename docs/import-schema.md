# Manabi Import Schema v1

大学から届くPDF・メール・Webページ・スクリーンショットを、利用者が普段使うAIで共通JSONに変換して取り込むための外部契約です。まなびメモにはAI APIを内蔵していません。AIへの資料送信は利用者自身が行い、アプリは端末内で解析・検証します。

## 使い方

1. メニューの「大学情報Inbox」を開き、「AI向け依頼文をコピー」を押します。
2. ChatGPT、Claude、Gemini、ローカルLLM等に依頼文と資料を渡します。コピーされる依頼文には完全なJSON Schemaが含まれます。
3. AIが返したJSONを貼り付けるか、JSONファイルを選びます。
4. 「JSONを解析して確認」を押します。ここでは保存されません。
5. 出典、日程、重複、更新前後、不明点を確認し、取り込む項目を個別に選びます。要確認の項目は別の確認チェックも必要です。
6. 「確認したN件を取り込む」を押します。上部の端末保存状態を確認してください。

JSONの説明文やMarkdownコードブロックは取り除いてください。最大1MB・200件です。サンプルの大学、教員、研究室、日程はすべて架空です。

## 正式な仕様

- [JSON Schema](../schema/manabi-memo.schema.json): draft 2020-12。アプリもこのファイルをAjvで検証します。`$id`は契約の識別子で、ホスト済みエンドポイントを意味しません。
- [TypeScript型](../app/manabi-import-types.ts): 種別によるdiscriminated union。
- [ゼミ配属の例](../examples/manabi-import-seminar.json)
- [全11種の例](../examples/manabi-import-all-types.json)
- [ファイルで渡すAI依頼文](ai-import-prompt.md)

```json
{
  "schema_version": "1.0",
  "collection": "example-university-seminar-2026",
  "items": [{
    "id": "guidance-2026",
    "type": "event",
    "title": "ゼミ配属ガイダンス（架空）",
    "source": {"kind": "pdf", "title": "ゼミ配属案内（架空）", "locator": "1ページ"},
    "data": {"starts_at": "2026-11-06T14:20:00+09:00", "location": "講堂"}
  }]
}
```

## 共通フィールド

| フィールド | 必須 | 意味 |
|---|---|---|
| schema_version | はい | 文字列 `"1.0"`。未対応版は拒否 |
| collection | はい | 大学・学部・年度等の情報集合の安定した識別子（1〜160文字） |
| generated_at | いいえ | タイムゾーン付き生成日時。重複判定には使わない |
| items | はい | 1〜200件の情報 |
| item.id | はい | collection内で安定した外部ID。1〜120文字、先頭英数字、以後英数字・`.`・`_`・`:`・`-` |
| item.type | はい | 下表の種別 |
| item.title | はい | 空白だけでないタイトル、最大300文字 |
| item.source | はい | 出典。kindとtitle必須 |
| item.data | はい | 種別別データ。未確認なら `{}` でも可（要確認になる） |
| item.summary / term | いいえ | 要約 / 学期。空文字でなく省略かnull |
| item.tags / related_ids | いいえ | タグ / 同じcollectionの外部ID参照。最大50件 |
| item.needs_review / uncertainties | いいえ | 確認フラグ / 未確認事項・矛盾。取り込み後も残す |
| item.extensions | いいえ | `x-`で始まるキー。値は文字列・数値・真偽値・null、最大20項目 |

source.kindは `pdf/email/web/screenshot/message/syllabus/memo/other`。source.titleは必須。任意でurl、locator（ページ・見出し等）、excerpt（短い原文）、published_atを残せます。通常の文字列は最大10,000文字、タグ・参照は300文字です。上限の詳細はSchemaを参照してください。

未知のプロパティは拒否します。別種別のdata項目も拒否します。暗黙の型変換、未知項目の自動削除、HTMLの実行は行いません。URLは認証情報を含まないhttp/httpsに限定します。

## 日付・不明情報

- 日付のみ: `2026-11-20`。時刻は未確認のまま保持し、勝手に23:59や00:00にしません。
- 日時: `2026-11-20T17:00:00+09:00` または `2026-11-20T08:00:00Z`。タイムゾーン必須です。
- 不明: フィールド省略またはnull。不明点をuncertaintiesへ記載します。
- 実在しない日付、同じ精度で開始より前の終了は拒否します。日付のみと時刻付きの混在は要確認として表示します。
- AIの確認チェックを通しても、原資料の正しさを保証するものではありません。画面の出典と不明点を確認してください。

## 種別別data

dataの各フィールドは任意で、文字列・日時・数値は不明ならnullにできます。配列は省略または空配列です。

| type | dataフィールド |
|---|---|
| event | starts_at, ends_at, location, url |
| deadline | due_at, submission_url, instructions |
| assignment | due_at, course_code, instructions, submission_url |
| announcement | published_at, url |
| seminar | academic_year, guidance_at, application_start, application_end, selection_method, result_at, capacity |
| laboratory | teacher_ids, research_fields, themes, capacity, selection_method, guidance_at, website |
| teacher | name, affiliation, research_fields, email, website |
| course | code, term, instructor, credits, weekday, period, room, syllabus_url |
| exam | starts_at, ends_at, course_code, location, scope |
| registration | opens_at, closes_at, procedure, submission_url |
| document | url, filename |

academic_yearは2000〜2200、capacityは整数0〜10000、creditsは0〜30。weekdayは月1〜土6、periodは既存の90分授業枠1〜5です。曜日と授業枠は両方指定するか両方不明にします。research_fields/themes/teacher_idsは文字列配列。teacher_idsは同じcollectionのteacherのidを使います。

ゼミ配属ではseminarを全体のタイムラインとし、eventでガイダンス、registrationで希望受付、deadlineで提出期限を表します。teacher/laboratoryをrelated_idsで関連付けます。未確認の選抜方法や結果発表日は要確認として表示されます。

## 重複と変更

同一性は `collection + type + id` で判定します。日付が変わっても同じidを使います。バッチ内のid重複は拒否します。生成日時やJSONキー順だけの違いで再追加しません。

- 同じIDで同じ内容: 重複表示、再保存なし。
- 同じIDで異なる内容: 更新候補。比較画面を確認して選んだ項目だけ置き換えます。省略されたフィールドも取り込み後の内容から外れます。
- 同タイトルで別ID: 自動統合せず、重複の可能性を要確認として表示。
- 不明な関連ID・教員でないteacher_ids: 要確認表示。まだ取り込まれていない関連も外部IDとして保持。
- 取り込み後は未読。変更前のitemと置換時刻はhistoryへ保存し、既存の内部IDを保持。

JSON編集後や確認中にInboxが変更されたときは再解析が必要です。確定関数でも再検証とbaseline確認を行います。プレビューにない項目や、要確認未承認の項目は確定できません。

## 保存・同期・バックアップ

外部のImport Schema版1.0と、内部state版13は独立です。内部のinboxは `{version:1,records:[...]}` で、内部UUID、collection、検証済みitem、既読状態、取り込み・更新時刻、履歴を持ちます。Import JSONに内部UUIDや既読状態を含めません。

既存IndexedDBのstate bundleへ保存するため、ノート・PDFと同じバックアップ、復元、初回同期の選択、revision競合保護を使います。ログインだけではクラウド送信しません。Inboxだけの端末にもデータありと判定し、クラウドに別内容があるときは選択を求めます。同期state上限は従来の4,500,000bytesです。履歴も容量へ含まれます。

旧state・旧バックアップにInboxがなければ空Inboxへ移行します。不正な保存Inboxは読み込みを停止し、空状態へ自動上書きしません。バックアップの「追加」は同一内容のInboxを重複追加せず、変更のある同IDは別内部UUIDで両方保持します。この場合、次の同ID更新は適用不可と表示します。内容を一方に絞る必要があるときは、確認したバックアップを使う「置き換え」復元を選んでください。

course/assignment/exam等はこの段階では出典付きInbox情報として保存します。既存の時間割やCampusデータへ自動作成・自動上書きせず、Inboxの配属日程・予定・締切一覧へ整理します。共有カレンダーには自動共有しません。Campusの招待設定とは独立して利用できます。資料原本や添付PDF本体はこのImport JSONに含めません。

## 拡張とMCP

新種別はSchema、ImportDataMap、表示名・要確認項目、テスト、文書を一緒に更新します。未対応種別を黙って捨てません。互換性を変える場合はschema_versionを進めます。

将来のMCPや他サービスはこの外部契約を生成・受け渡すアダプターとして追加できます。内部stateやDB形式をMCPの引数仕様へ固定せず、同じ検証・プレビュー・確定境界を使います。v1にMCPサーバーや特定AIのSDKはありません。
