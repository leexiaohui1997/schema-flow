import { prisma } from '../prisma.js'

import { deserializeDbConfig } from './dbConfig.js'
import { createMysqlPool, MysqlAdapter } from './mysqlAdapter.js'
import { PgAdapter } from './pgAdapter.js'

import type { DbAdapter } from './dbAdapter.js'

// projectId -> DbAdapter 创建 Promise（缓存 Promise 而非实例，避免并发 miss 泄漏）
const adapterPromiseCache = new Map<string, Promise<DbAdapter>>()

async function createAdapter(projectId: string): Promise<DbAdapter> {
  const project = await prisma.project.findUnique({ where: { projectId } })
  if (!project) throw new Error(`project ${projectId} not found`)

  const cfg = deserializeDbConfig(project.dbConfig) as {
    host: string
    port: number
    user: string
    password: string
    database: string
    dbType?: string
  }

  const dbType = cfg.dbType ?? 'postgres'

  if (dbType === 'mysql') {
    const pool = createMysqlPool(cfg)
    return new MysqlAdapter(pool)
  }

  // 默认 postgres
  const { Pool } = await import('pg')
  const pool = new Pool({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
    max: 5,
    idleTimeoutMillis: 30_000,
  })
  pool.on('error', (err) => {
    console.error('[pg-pool] unexpected error on idle client', err)
  })
  return new PgAdapter(pool)
}

/**
 * 根据 projectId 建立（或复用）DB 适配器。
 * 缓存 Promise 避免并发 miss 泄漏。
 */
export function getDbClient(projectId: string): Promise<DbAdapter> {
  const cached = adapterPromiseCache.get(projectId)
  if (cached) return cached

  const p = createAdapter(projectId).catch((e) => {
    adapterPromiseCache.delete(projectId)
    throw e
  })
  adapterPromiseCache.set(projectId, p)
  return p
}

/**
 * 关闭并移除某个项目的连接。项目 dbConfig 变更时调用。
 */
export async function closeDbClient(projectId: string): Promise<void> {
  const p = adapterPromiseCache.get(projectId)
  if (p) {
    try {
      const adapter = await p
      await adapter.end()
    } catch {
      // 创建失败时忽略
    }
    adapterPromiseCache.delete(projectId)
  }
}
