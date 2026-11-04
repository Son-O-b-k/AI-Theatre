// SQLite through Node's built-in driver. Its calls are synchronous; a queue keeps a transaction's
// statements from interleaving with other requests while it awaits.

import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { Db, Param } from '.'

export function openSqlite(file: string): Db {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true })
  const raw = new DatabaseSync(file)
  raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')
  let queue: Promise<unknown> = Promise.resolve()

  const wrap = (inTransaction: boolean): Db => {
    /** Outside a transaction, wait for any running one; inside, run straight away. */
    const turn = <T>(work: () => T | Promise<T>): Promise<T> => {
      if (inTransaction) return Promise.resolve().then(work)
      const next = queue.then(work)
      queue = next.catch(() => {})
      return next
    }
    const db: Db = {
      dialect: 'sqlite',
      all: (sql, ...params) => turn(() => raw.prepare(sql).all(...(params as Param[])) as never[]),
      get: (sql, ...params) => turn(() => raw.prepare(sql).get(...(params as Param[])) as never),
      run: (sql, ...params) => turn(() => Number(raw.prepare(sql).run(...(params as Param[])).changes)),
      exec: (sql) => turn(() => raw.exec(sql)),
      transaction: (work) =>
        inTransaction
          ? work(db)
          : turn(async () => {
              raw.exec('BEGIN')
              try {
                const result = await work(wrap(true))
                raw.exec('COMMIT')
                return result
              } catch (error) {
                raw.exec('ROLLBACK')
                throw error
              }
            }),
      close: async () => raw.close(),
    }
    return db
  }
  return wrap(false)
}
