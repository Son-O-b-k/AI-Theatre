// Postgres through node-postgres (pg), loaded only when DATABASE_URL points at Postgres.
// Queries are written with `?` placeholders, as in SQLite, and numbered here ($1, $2...).

import pg from 'pg'
import type { Db } from '.'

const numbered = (sql: string) => {
  let n = 0
  return sql.replace(/\?/g, () => `$${++n}`)
}

export async function openPostgres(connectionString: string): Promise<Db> {
  const pool = new pg.Pool({ connectionString })
  await pool.query('SELECT 1') // fail at startup, not on the first request

  const wrap = (client: pg.Pool | pg.PoolClient): Db => {
    const db: Db = {
      dialect: 'postgres',
      all: async (sql, ...params) => (await client.query(numbered(sql), params)).rows,
      get: async (sql, ...params) => (await client.query(numbered(sql), params)).rows[0],
      run: async (sql, ...params) => (await client.query(numbered(sql), params)).rowCount ?? 0,
      exec: async (sql) => {
        await client.query(sql)
      },
      transaction: async (work) => {
        if (client !== pool) return work(db)
        const connection = await pool.connect()
        try {
          await connection.query('BEGIN')
          const result = await work(wrap(connection))
          await connection.query('COMMIT')
          return result
        } catch (error) {
          await connection.query('ROLLBACK')
          throw error
        } finally {
          connection.release()
        }
      },
      close: () => pool.end(),
    }
    return db
  }
  return wrap(pool)
}
