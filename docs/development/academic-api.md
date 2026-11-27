# 学業連携API（開発中）

既定無効。MANABI_ACADEMIC_API_ENABLED=true を本番と分離したPreviewに設定し、許可済みFirebaseアカウントの正規認証を使用する。短寿命のFirebase ID tokenをチャット本文へ貼らない。ChatGPTの正式な認証接続は未実装。MCPのOAuth連携を別途設計・検証する。

GET /api/academic は同期版、最終同期日時、履修科目・課題・試験・出席・学習結果のみを返す。大学側最新情報の取得を意味しない。個人ノート、PDF、認証情報は返さない。

POST /api/academic は expectedRevision と command を受け取る。command.confirmed は本人の明示確認時のみ true。courseId はGETで取得した完全一致ID。操作:
- assignment_submitted: assignmentId, expectedStatus (todo/doing)
- attendance: day (YYYY-MM-DD), status (present/late/absent), expectedStatus (現在の記録値、未記録なら null)
- study: recordId (再送で同じ値), day, topic, outcome (planned/explanation/hinted/independent/retained), minutes

LMSへの提出・出席操作ではなく本人の記録のみ。同期競合、PDF実体、未完了同期は拒否。新旧クライアントの形式の逆戻りを拒否する。初回受入は架空データと隔離DBで行い、認証なし・他アカウント・競合・PDFあり・冪等性・復元を確認する。本番有効化は利用者承認後。

- assignment_create / exam_create: recordId, title, at (明示された日付/日時), source (根拠の名称). 同じIDの再送は冪等。同名の異なるIDは要確認。未知の締切や試験日時は作成せず確認する。

## OAuth連携の追加実装（未有効化）
固定登録クライアント、厳格なリダイレクト先、S256 PKCE、resource、scope、Firebase本人確認・同意画面、ハッシュ化された短寿命コードとアクセストークン、更新トークンの回転と再利用検知、解除を実装した。設定がない限り無効。MCPツールルートと実際のOAuth受入は別途検証する。対象はChatGPTの登録済み固定クライアント。動的登録・CIMDは実装しない。公開設定・秘密情報をGitにコミットしない。

## MCP endpoint

`POST /mcp` に従来の学業用6ツール（概要取得、出席記録、学習結果記録、提出済み記録、課題追加、試験追加）を実装。現在の2026-07-28形式と旧initialize形式の限定的なStreamable HTTP実装で、認証・実クライアントの互換確認を要する。読み取り・書き込みは別scope、書き込みは直前のrevision・確定済みID・明示確認を要求する。件数を制限して省略件数を返す。公開前にMCP Inspector・ChatGPT実接続・隔離DB・OAuth再送/失効/他アカウント・PDF競合・実機の検証が必須。

環境変数（初期未設定）: MANABI_MCP_ENABLED, MANABI_MCP_ORIGIN, MANABI_MCP_CLIENT_ID, MANABI_MCP_REDIRECT_URI, MANABI_MCP_CLIENT_SECRET（固定クライアントがsecretを使用する場合のみ）。Firebaseと許可アカウント一覧も必須。OAuthメタデータを提供し、/connect/manabi から権限を確認・解除できる。OpenAIの公式認証仕様 https://developers.openai.com/plugins/build/auth およびMCP Streamable HTTP仕様 https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http を参照。秘密や実メールはGitへ含めない。

## 大学情報の取得状況

[群馬大学との連携](gunma-university-integration.md)に情報源と確認範囲を整理した。OAuth/MCPが返す収集状況は現時点で未確認。まなびメモの端末で読んだICSファイルの記録を、大学側の網羅性や最新情報と解釈しない。


## 科目別の学業記録

`get_course_academic_detail` は同期した科目IDを受け取り、Inboxの根拠と通常の課題・試験・出席を参照する。明示科目コードを優先し、コードを持たない既存科目は同一学期・一意の科目名で照合する。旧巡回のLMS課題と提出履歴は活動IDで束ね、元のInboxを保持する。詳細は20件ずつ `nextOffset` で取得する。未照合の情報や表示の矛盾は根拠とともに保持する。

提出状態は公開待ち、未提出、提出済み、期限超過、未確認。論理設計の既存レポートは公開予定前を公開待ちとし、公開予定以降も締切の矛盾が残る間は未確認。通常課題や小テストから正式出席を推定しない。出席用と確認できた課題だけ、遅延提出3件を欠席1回相当として暫定集計する。教員基準が確認された場合は教員基準を表示して暫定換算を停止する。

`record_academic_correction` は本人確認と同期revisionを要求し、出席・提出の訂正を履歴に追加する。巡回由来の根拠は保持し、本人訂正を表示で優先する。すべての操作は本人のまなびメモに限る。
