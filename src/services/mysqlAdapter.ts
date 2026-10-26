import { createPool, Pool as MysqlPool } from 'mysql2/promise'

import type { DbAdapter } from './dbAdapter.js'

export class MysqlAdapter implements DbAdapter {
  private pool: MysqlPool

  constructor(pool: MysqlPool) {
    this.pool = pool
  }

  async query(sql: string, params: unknown[]): Promise<{ rows: any[]; rowCount: number }> {
    const [rows] = await this.pool.query(sql, params)
    // SELECT 返回数组，INSERT/UPDATE 返回 ResultSetHeader
    const rowCount = Array.isArray(rows) ? rows.length : ((rows as any).affectedRows ?? 0)
    return {
      rows: Array.isArray(rows) ? rows : [],
      rowCount,
    }
  }

  async end(): Promise<void> {
    await this.pool.end()
  }
}

export function createMysqlPool(config: {
  host: string
  port: number
  user: string
  password: string
  database: string
}): MysqlPool {
  return createPool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    connectionLimit: 5,
    idleTimeout: 30_000,
  })
}
