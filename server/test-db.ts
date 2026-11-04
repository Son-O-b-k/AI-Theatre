// A fresh database for each test: in-memory SQLite by default, or Postgres when
// TEST_DATABASE_URL=postgres://... is set (its public schema is wiped first).

import { openDb, type Db } from './db'

export async function freshDb(): Promise<Db> {
  const url = process.env.TEST_DATABASE_URL
  if (!url) return openDb(':memory:')
  const pg = await import('pg')
  const pool = new pg.default.Pool({ connectionString: url })
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public')
  await pool.end()
  return openDb(url)
}
