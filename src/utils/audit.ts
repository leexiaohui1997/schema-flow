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

export function audit(entry: AuditEntry) {
  const line = {
    timestamp: new Date().toISOString(),
    ...entry,
  }
  // 写到 stdout，单行 JSON，便于 grep / docker logs
  process.stdout.write(JSON.stringify(line) + '\n')
}
