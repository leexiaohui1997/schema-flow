import type { QueryBuilder, WhereCond, SortCond } from './queryBuilder.js'
import type { Field } from '@prisma/client'

/**
 * PostgreSQL 查询构建器
 */

function paramCast(fieldType: string): string {
  switch (fieldType) {
    case 'number':
      return '::numeric'
    case 'date':
    case 'datetime':
      return '::timestamptz'
    default:
      return '::text'
  }
}

function escapeLikePattern(value: string): string {
  return value.replace(/[%_\\]/g, '\\$&')
}

export class PgQueryBuilder implements QueryBuilder {
  quote(identifier: string): string {
    return `"${identifier}"`
  }

  buildWhereSql(
    where: WhereCond[],
    metaFields: Pick<Field, 'fieldKey' | 'fieldType'>[],
    startParamIndex = 1,
  ): { sql: string; params: unknown[]; nextIndex: number } {
    if (where.length === 0) return { sql: '', params: [], nextIndex: startParamIndex }

    const fieldTypeMap = new Map(metaFields.map((f) => [f.fieldKey, f.fieldType]))
    const clauses: string[] = []
    const params: unknown[] = []
    let i = startParamIndex

    for (const cond of where) {
      const safeField = this.quote(cond.field)
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

  buildOrderBySql(sort: SortCond[]): string {
    if (sort.length === 0) return ''
    return (
      'ORDER BY ' +
      sort.map((s) => `${this.quote(s.field)} ${s.order === 'desc' ? 'DESC' : 'ASC'}`).join(', ')
    )
  }

  buildCountSql(tableName: string, whereSql: string): string {
    const table = this.quote(tableName)
    return whereSql
      ? `SELECT COUNT(*)::int AS total FROM ${table} WHERE ${whereSql}`
      : `SELECT COUNT(*)::int AS total FROM ${table}`
  }

  buildInsertSql(tableName: string, columns: string[], placeholders: string[]): string {
    const table = this.quote(tableName)
    const cols = columns.map((c) => this.quote(c)).join(', ')
    return `INSERT INTO ${table} (${cols}) VALUES (${placeholders.join(', ')}) RETURNING *`
  }

  buildUpdateSql(tableName: string, pkField: string, setClause: string, pkParam: number): string {
    const table = this.quote(tableName)
    const pk = this.quote(pkField)
    return `UPDATE ${table} SET ${setClause} WHERE ${pk} = $${pkParam} RETURNING *`
  }

  buildDeleteSql(tableName: string, pkField: string): string {
    const table = this.quote(tableName)
    const pk = this.quote(pkField)
    return `DELETE FROM ${table} WHERE ${pk} = $1 RETURNING *`
  }

  buildLimitOffsetSql(page: number, size: number): string {
    const offset = (page - 1) * size
    return `LIMIT ${size} OFFSET ${offset}`
  }
}
