import { getDbClient } from './dbConnection.js'

/**
 * DDL 执行器：在业务库执行 DDL 语句。
 * 复用 getDbClient 的适配器。
 */
export async function executeDdl(projectId: string, sqlStmts: string[]): Promise<void> {
  if (sqlStmts.length === 0) return
  const adapter = await getDbClient(projectId)
  for (const sql of sqlStmts) {
    await adapter.query(sql, [])
  }
}

/** 判断表是否配置了 skipPhysicalDdl */
export function shouldSkipDdl(securityConfig: unknown): boolean {
  if (!securityConfig || typeof securityConfig !== 'object') return false
  return (securityConfig as { skipPhysicalDdl?: boolean }).skipPhysicalDdl === true
}
