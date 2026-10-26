// 查询 DSL 解析器
// 把 query string 里的 where/sort/page/size 转成结构化条件
// where 格式（JSON）：?where={"name":{"op":"like","value":"周"},"age":{"op":"gt","value":18}}
// sort 格式：?sort=name:asc,created_at:desc

import type { Field } from '@prisma/client'

const ALLOWED_OPS = new Set(['=', '!=', '>', '<', '>=', '<=', 'like'])

export interface WhereCond {
  field: string
  op: string
  value: unknown
}

export interface SortCond {
  field: string
  order: 'asc' | 'desc'
}

export interface ParsedQuery {
  where: WhereCond[]
  sort: SortCond[]
  page: number
  size: number
}

/**
 * 校验字段名在元数据白名单内，防止 SQL 注入。
 */
function assertFieldAllowed(fieldKey: string, allowedFields: Set<string>) {
  if (!allowedFields.has(fieldKey)) {
    throw new Error(`field "${fieldKey}" is not registered in table metadata`)
  }
}

export function parseQuery(
  query: Record<string, unknown>,
  metaFields: Pick<Field, 'fieldKey'>[],
): ParsedQuery {
  const allowed = new Set(metaFields.map((f) => f.fieldKey))

  // where
  const where: WhereCond[] = []
  if (typeof query.where === 'string' && query.where) {
    let parsed: Record<string, { op: string; value: unknown }>
    try {
      parsed = JSON.parse(query.where)
    } catch {
      throw new Error('where must be a valid JSON object')
    }
    for (const [fieldKey, cond] of Object.entries(parsed)) {
      assertFieldAllowed(fieldKey, allowed)
      if (!cond || typeof cond !== 'object' || !ALLOWED_OPS.has(cond.op)) {
        throw new Error(`invalid where condition for field "${fieldKey}"`)
      }
      where.push({ field: fieldKey, op: cond.op, value: cond.value })
    }
  }

  // sort
  const sort: SortCond[] = []
  if (typeof query.sort === 'string' && query.sort) {
    for (const part of query.sort.split(',')) {
      const [fieldKey, order] = part.trim().split(':')
      if (!fieldKey || (order !== 'asc' && order !== 'desc')) {
        throw new Error(`invalid sort clause: "${part}"`)
      }
      assertFieldAllowed(fieldKey, allowed)
      sort.push({ field: fieldKey, order })
    }
  }

  // page / size
  const page = Math.max(1, Number(query.page) || 1)
  const size = Math.min(100, Math.max(1, Number(query.size) || 20))

  return { where, sort, page, size }
}

/**
 * 按 fieldType 决定参数的 PG cast。
 * 历史背景：阶段二开发时遇 PG 42P18 参数类型推断失败，
 * 曾临时对所有列和参数做 ::text cast，导致数字/日期区间查询
 * 退化为字符串字典序比较。现按 fieldType 精确 cast。
 */
function paramCast(fieldType: string): string {
  switch (fieldType) {
    case 'number':
      return '::numeric'
    case 'date':
    case 'datetime':
      return '::timestamptz'
    default:
      // text / select / multiselect / richtext / password / email / url
      return '::text'
  }
}

/**
 * escape like pattern 里的 % _ \ 通配符
 */
function escapeLikePattern(value: string): string {
  return value.replace(/[%_\\]/g, '\\$&')
}

/**
 * 把 where 条件转成 SQL 片段和参数数组。
 * 需要 metaFields 来按 fieldType 决定 cast。
 */
export function buildWhereSql(
  where: WhereCond[],
  metaFields: Pick<Field, 'fieldKey' | 'fieldType'>[],
  startParamIndex = 1,
): {
  sql: string
  params: unknown[]
  nextIndex: number
} {
  if (where.length === 0) return { sql: '', params: [], nextIndex: startParamIndex }

  const fieldTypeMap = new Map(metaFields.map((f) => [f.fieldKey, f.fieldType]))
  const clauses: string[] = []
  const params: unknown[] = []
  let i = startParamIndex

  for (const cond of where) {
    const safeField = `"${cond.field}"`
    const cast = paramCast(fieldTypeMap.get(cond.field) ?? 'text')
    switch (cond.op) {
      case '=':
        clauses.push(`${safeField} = $${i++}${cast}`)
        params.push(String(cond.value))
        break
      case '!=':
        clauses.push(`${safeField} != $${i++}${cast}`)
        params.push(String(cond.value))
        break
      case '>':
        clauses.push(`${safeField} > $${i++}${cast}`)
        params.push(String(cond.value))
        break
      case '<':
        clauses.push(`${safeField} < $${i++}${cast}`)
        params.push(String(cond.value))
        break
      case '>=':
        clauses.push(`${safeField} >= $${i++}${cast}`)
        params.push(String(cond.value))
        break
      case '<=':
        clauses.push(`${safeField} <= $${i++}${cast}`)
        params.push(String(cond.value))
        break
      case 'like':
        clauses.push(`${safeField} LIKE $${i++}${cast} ESCAPE '\\'`)
        params.push(`%${escapeLikePattern(String(cond.value))}%`)
        break
    }
  }

  return { sql: clauses.join(' AND '), params, nextIndex: i }
}

/**
 * 把 sort 转成 ORDER BY SQL。
 */
export function buildOrderBySql(sort: SortCond[]): string {
  if (sort.length === 0) return ''
  return (
    'ORDER BY ' + sort.map((s) => `"${s.field}" ${s.order === 'desc' ? 'DESC' : 'ASC'}`).join(', ')
  )
}
