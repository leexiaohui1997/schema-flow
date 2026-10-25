import { Pool } from 'pg'

import { prisma } from '../prisma.js'

import { deserializeDbConfig } from './dbConfig.js'

// projectId -> Pool
const poolCache = new Map<string, Pool>()

/**
 * 根据 projectId 建立（或复用）业务库连接。
 * 同一个项目复用同一个 Pool；项目配置变更时调 closeDbClient 重建。
 */
export async function getDbClient(projectId: string): Promise<Pool> {
  const cached = poolCache.get(projectId)
  if (cached) return cached

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

  poolCache.set(projectId, pool)
  return pool
}

/**
 * 关闭并移除某个项目的连接。项目 dbConfig 变更时调用。
 */
export async function closeDbClient(projectId: string): Promise<void> {
  const pool = poolCache.get(projectId)
  if (pool) {
    await pool.end()
    poolCache.delete(projectId)
  }
}
