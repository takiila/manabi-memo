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
