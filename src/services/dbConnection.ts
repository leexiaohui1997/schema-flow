import { Pool } from 'pg'

import { prisma } from '../prisma.js'

import { deserializeDbConfig } from './dbConfig.js'

// projectId -> Pool 创建 Promise（缓存 Promise 而非 Pool 实例，避免并发 miss 泄漏）
const poolPromiseCache = new Map<string, Promise<Pool>>()

async function createPool(projectId: string): Promise<Pool> {
  const project = await prisma.project.findUnique({ where: { projectId } })
  if (!project) throw new Error(`project ${projectId} not found`)

  const cfg = deserializeDbConfig(project.dbConfig) as {
    host: string
    port: number
    user: string
    password: string
    database: string
  }

  const pool = new Pool({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
    max: 5,
    idleTimeoutMillis: 30_000,
  })

  // idle client 没 error handler 会直接 throw 崩进程
  pool.on('error', (err) => {
    console.error('[pg-pool] unexpected error on idle client', err)
  })

  return pool
}

/**
 * 根据 projectId 建立（或复用）业务库连接。
 * 缓存 Promise 避免并发 miss 泄漏 Pool。
 */
export function getDbClient(projectId: string): Promise<Pool> {
  const cached = poolPromiseCache.get(projectId)
  if (cached) return cached

  const p = createPool(projectId).catch((e) => {
    poolPromiseCache.delete(projectId)
    throw e
  })
  poolPromiseCache.set(projectId, p)
  return p
}

/**
 * 关闭并移除某个项目的连接。项目 dbConfig 变更时调用。
 */
export async function closeDbClient(projectId: string): Promise<void> {
  const p = poolPromiseCache.get(projectId)
  if (p) {
    try {
      const pool = await p
      await pool.end()
    } catch {
      // 创建失败时忽略
    }
    poolPromiseCache.delete(projectId)
  }
}
