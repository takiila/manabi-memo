import "server-only";

import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import postgres from "postgres";
import { postgresSchema, sqliteSchema } from "../../db/schema";

export type SqlValue = string | number | boolean | null | Uint8Array;
export type SqlRow = Record<string, unknown>;
type DatabaseDriver = {
  queryAll<T extends SqlRow>(statement: string, values?: SqlValue[]): Promise<T[]>;
  execute(statement: string, values?: SqlValue[]): Promise<{ changes: number }>;
  transaction<T>(callback: (transaction: DatabaseTransaction) => Promise<T>): Promise<T>;
};

export type DatabaseTransaction = {
  queryAll<T extends SqlRow>(statement: string, values?: SqlValue[]): Promise<T[]>;
  execute(statement: string, values?: SqlValue[]): Promise<{ changes: number }>;
};

let driverPromise: Promise<DatabaseDriver> | null = null;

export async function database() {
  driverPromise ??= createDriver();
  return driverPromise;
}

export async function queryOne<T extends SqlRow>(statement: string, values: SqlValue[] = []) {
  return (await (await database()).queryAll<T>(statement, values))[0] ?? null;
}

export async function queryAll<T extends SqlRow>(statement: string, values: SqlValue[] = []) {
  return (await database()).queryAll<T>(statement, values);
}

export async function execute(statement: string, values: SqlValue[] = []) {
  return (await database()).execute(statement, values);
}

export async function withTransaction<T>(callback: (transaction: DatabaseTransaction) => Promise<T>) {
  return (await database()).transaction(callback);
}

async function createDriver(): Promise<DatabaseDriver> {
  const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
  if (/^postgres(?:ql)?:\/\//i.test(databaseUrl)) return createPostgresDriver(databaseUrl);
  return createSqliteDriver(databaseUrl);
}

async function createSqliteDriver(configuredPath: string): Promise<DatabaseDriver> {
  const filename = resolveSqlitePath(configuredPath);
  mkdirSync(path.dirname(filename), { recursive: true });
  const sqlite = new DatabaseSync(filename, { timeout: 5000 });
  sqlite.exec("PRAGMA journal_mode = WAL");
  sqlite.exec("PRAGMA foreign_keys = ON");
  for (const statement of sqliteSchema) sqlite.prepare(statement).run();
  migrateSqliteSchema(sqlite);
  const transaction = createSqliteTransaction(sqlite);
  return {
    async queryAll<T extends SqlRow>(statement: string, values: SqlValue[] = []) {
      return sqlite.prepare(statement).all(...sqliteValues(values)) as T[];
    },
    async execute(statement: string, values: SqlValue[] = []) {
      return { changes: Number(sqlite.prepare(statement).run(...sqliteValues(values)).changes) };
    },
    transaction,
  };
}

async function createPostgresDriver(databaseUrl: string): Promise<DatabaseDriver> {
  const sql = postgres(databaseUrl, {
    max: Number(process.env.DATABASE_POOL_SIZE ?? 5),
    idle_timeout: 20,
    connect_timeout: 15,
    ssl: process.env.DATABASE_SSL === "false" ? false : "require",
    types: { bigint: postgres.BigInt },
  });
  for (const statement of postgresSchema) await sql.unsafe(statement);
  await sql.unsafe("ALTER TABLE synced_app_state ADD COLUMN IF NOT EXISTS pdf_manifest TEXT NOT NULL DEFAULT '[]'");
  await sql.unsafe("ALTER TABLE synced_app_state ADD COLUMN IF NOT EXISTS sync_complete BIGINT NOT NULL DEFAULT 1");
  return {
    async queryAll<T extends SqlRow>(statement: string, values: SqlValue[] = []) {
      const rows = await sql.unsafe(toPostgresPlaceholders(statement), values);
      return rows.map(normalizePostgresRow) as T[];
    },
    async execute(statement: string, values: SqlValue[] = []) {
      const result = await sql.unsafe(toPostgresPlaceholders(statement), values);
      return { changes: Number(result.count ?? 0) };
    },
    async transaction<T>(callback: (transaction: DatabaseTransaction) => Promise<T>) {
      return sql.begin(async (connection) => callback({
        async queryAll<R extends SqlRow>(statement: string, values: SqlValue[] = []) {
          const rows = await connection.unsafe(toPostgresPlaceholders(statement), values);
          return rows.map(normalizePostgresRow) as R[];
        },
        async execute(statement: string, values: SqlValue[] = []) {
          const result = await connection.unsafe(toPostgresPlaceholders(statement), values);
          return { changes: Number(result.count ?? 0) };
        },
      })) as Promise<T>;
    },
  };
}

function createSqliteTransaction(sqlite: DatabaseSync) {
  return async function transaction<T>(callback: (transaction: DatabaseTransaction) => Promise<T>) {
    sqlite.exec("BEGIN IMMEDIATE");
    try {
      const result = await callback({
        async queryAll<R extends SqlRow>(statement: string, values: SqlValue[] = []) {
          return sqlite.prepare(statement).all(...sqliteValues(values)) as R[];
        },
        async execute(statement: string, values: SqlValue[] = []) {
          return { changes: Number(sqlite.prepare(statement).run(...sqliteValues(values)).changes) };
        },
      });
      sqlite.exec("COMMIT");
      return result;
    } catch (cause) {
      try { sqlite.exec("ROLLBACK"); } catch { /* preserve the original error */ }
      throw cause;
    }
  };
}

function migrateSqliteSchema(sqlite: DatabaseSync) {
  const columns = sqlite.prepare("PRAGMA table_info(synced_app_state)").all() as Array<{ name?: unknown }>;
  const names = new Set(columns.map((column) => typeof column.name === "string" ? column.name : ""));
  if (!names.has("pdf_manifest")) sqlite.exec("ALTER TABLE synced_app_state ADD COLUMN pdf_manifest TEXT NOT NULL DEFAULT '[]'");
  if (!names.has("sync_complete")) sqlite.exec("ALTER TABLE synced_app_state ADD COLUMN sync_complete INTEGER NOT NULL DEFAULT 1");
}

function sqliteValues(values: SqlValue[]) {
  return values.map((value) => typeof value === "boolean" ? Number(value) : value);
}

function resolveSqlitePath(configuredPath: string) {
  const raw = configuredPath.replace(/^sqlite:/i, "").replace(/^file:/i, "").trim();
  const selected = raw || ".data/manabi-memo.sqlite";
  return path.isAbsolute(selected)
    ? selected
    : path.resolve(/* turbopackIgnore: true */ process.cwd(), selected);
}

function toPostgresPlaceholders(statement: string) {
  let index = 0;
  return statement.replace(/\?/g, () => `$${++index}`);
}

function normalizePostgresRow(row: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, typeof value === "bigint" ? Number(value) : value]));
}
