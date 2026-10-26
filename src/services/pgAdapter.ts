import { Pool } from 'pg'

import type { DbAdapter } from './dbAdapter.js'

export class PgAdapter implements DbAdapter {
  private pool: Pool

  constructor(pool: Pool) {
    this.pool = pool
  }

  async query(sql: string, params: unknown[]): Promise<{ rows: any[]; rowCount: number }> {
    const result = await this.pool.query(sql, params)
    return {
      rows: result.rows,
      rowCount: result.rowCount ?? 0,
    }
  }

  async end(): Promise<void> {
    await this.pool.end()
  }
}
