// The database behind accounts, billing and usage. Chosen by the environment:
//   DATABASE_URL=postgres://user:pass@host:5432/name  -> Postgres
//   otherwise                                          -> SQLite in data/app.db (DATA_DIR)
// Both sit behind the same small async interface, so the rest of the code never knows which.

import { join, resolve } from 'node:path'
import { MIGRATIONS } from './migrations'

export type Dialect = 'sqlite' | 'postgres'
export type Param = string | number | null

export interface Db {
  readonly dialect: Dialect
  all<T>(sql: string, ...params: Param[]): Promise<T[]>
  get<T>(sql: string, ...params: Param[]): Promise<T | undefined>
  /** Runs a statement; resolves to the number of rows it changed. */
  run(sql: string, ...params: Param[]): Promise<number>
  /** Runs several statements without parameters (schema changes). */
  exec(sql: string): Promise<void>
  /** Runs `work` atomically; queries inside must go through `tx`. */
  transaction<T>(work: (tx: Db) => Promise<T>): Promise<T>
  close(): Promise<void>
}

export async function openDb(url = process.env.DATABASE_URL): Promise<Db> {
  const db = url?.startsWith('postgres')
    ? await (await import('./postgres')).openPostgres(url)
    : (await import('./sqlite')).openSqlite(url ?? join(resolve(process.env.DATA_DIR ?? 'data'), 'app.db'))
  await migrate(db)
  return db
}

/** Applies migrations not yet recorded in schema_migrations, each in its own transaction. */
async function migrate(db: Db): Promise<void> {
  await db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)')
  const applied = new Set((await db.all<{ version: number }>('SELECT version FROM schema_migrations')).map((row) => Number(row.version)))
  for (const [index, migration] of MIGRATIONS.entries()) {
    const version = index + 1
    if (applied.has(version)) continue
    await db.transaction(async (tx) => {
      await tx.exec(migration(db.dialect))
      await tx.run('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)', version, now())
    })
  }
}

export const now = () => new Date().toISOString()
export const newId = () => crypto.randomUUID().replaceAll('-', '').slice(0, 16)
