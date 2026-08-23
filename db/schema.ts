export const sqliteSchema = [
  `CREATE TABLE IF NOT EXISTS feedback (
    id TEXT PRIMARY KEY,
    category TEXT NOT NULL,
    message TEXT NOT NULL,
    reply_email TEXT,
    source_view TEXT NOT NULL DEFAULT 'unknown',
    device_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'new',
    created_at INTEGER NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS feedback_created_at_idx ON feedback (created_at)",
  "CREATE INDEX IF NOT EXISTS feedback_device_id_idx ON feedback (device_id)",
  `CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    provider_key TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS auth_identities (
    issuer TEXT NOT NULL,
    subject TEXT NOT NULL,
    provider TEXT NOT NULL,
    account_id TEXT NOT NULL,
    verified_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    PRIMARY KEY (issuer, subject)
  )`,
  "CREATE INDEX IF NOT EXISTS auth_identities_account_idx ON auth_identities (account_id)",
  `CREATE TABLE IF NOT EXISTS synced_app_state (
    user_id TEXT PRIMARY KEY,
    revision INTEGER NOT NULL,
    schema_version INTEGER NOT NULL,
    payload TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    updated_by TEXT NOT NULL,
    deleted_at INTEGER,
    pdf_manifest TEXT NOT NULL DEFAULT '[]',
    sync_complete INTEGER NOT NULL DEFAULT 1
  )`,
  `CREATE TABLE IF NOT EXISTS synced_pdf (
    user_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    object_key TEXT NOT NULL,
    size INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    state_revision INTEGER NOT NULL DEFAULT 0,
    note_version TEXT NOT NULL DEFAULT '',
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, session_id)
  )`,
  "CREATE INDEX IF NOT EXISTS synced_pdf_user_updated_idx ON synced_pdf (user_id, updated_at)",
  `CREATE TABLE IF NOT EXISTS sync_transactions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    base_revision INTEGER NOT NULL,
    target_revision INTEGER NOT NULL,
    schema_version INTEGER NOT NULL,
    payload TEXT NOT NULL,
    device_id TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    committed_at INTEGER
  )`,
  "CREATE INDEX IF NOT EXISTS sync_transactions_user_status_idx ON sync_transactions (user_id, status, updated_at)",
  `CREATE TABLE IF NOT EXISTS sync_transaction_pdfs (
    transaction_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    object_key TEXT NOT NULL,
    size INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    state_revision INTEGER NOT NULL,
    note_version TEXT NOT NULL,
    uploaded_at INTEGER NOT NULL,
    PRIMARY KEY (transaction_id, session_id)
  )`,
  "CREATE INDEX IF NOT EXISTS sync_transaction_pdfs_user_idx ON sync_transaction_pdfs (user_id, transaction_id)",
  `CREATE TABLE IF NOT EXISTS campus_memberships (
    user_id TEXT PRIMARY KEY,
    activated_at INTEGER NOT NULL,
    revoked_at INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS campus_invite_attempts (
    user_id TEXT PRIMARY KEY,
    attempts INTEGER NOT NULL,
    window_started_at INTEGER NOT NULL
  )`,
] as const;

export const postgresSchema = sqliteSchema.map((statement) =>
  statement.replaceAll(" INTEGER", " BIGINT"),
);
