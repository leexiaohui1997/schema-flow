// 结构化 stdout 审计 log
// 阶段一只打 stdout，阶段六再落库 audit_logs 表

export interface AuditEntry {
  action: string // e.g. "project.delete" / "field.create"
  operator: string
  projectId?: string
  tableName?: string
  fieldKey?: string
  before?: unknown
  after?: unknown
  [k: string]: unknown
}

/**
 * 脱敏 dbConfig：把 password 替换成 ***
 */
export function maskDbConfig(obj: Record<string, any>): Record<string, any> {
  if (!obj || typeof obj !== 'object') return obj
  const { dbConfig, ...rest } = obj
  return {
    ...rest,
    dbConfig: dbConfig ? { ...dbConfig, password: '***' } : dbConfig,
  }
}

/**
 * 脱敏业务行数据：把 fieldType=password 的列值替换成 ***
 */
export function maskRow(
  row: Record<string, any>,
  passwordFields: Set<string>,
): Record<string, any> {
  if (!row || typeof row !== 'object') return row
  const out: Record<string, any> = { ...row }
  for (const k of Object.keys(out)) {
    if (passwordFields.has(k)) out[k] = '***'
  }
  return out
}

export function audit(entry: AuditEntry) {
  const line = {
    timestamp: new Date().toISOString(),
    ...entry,
  }
  // 写到 stdout，单行 JSON，便于 grep / docker logs
  process.stdout.write(JSON.stringify(line) + '\n')
}
