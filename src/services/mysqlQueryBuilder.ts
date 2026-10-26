import type { QueryBuilder, WhereCond, SortCond } from './queryBuilder.js'
import type { Field } from '@prisma/client'

/**
 * MySQL 查询构建器
 */

function escapeLikePattern(value: string): string {
  return value.replace(/[%_\\]/g, '\\$&')
}

export class MysqlQueryBuilder implements QueryBuilder {
  quote(identifier: string): string {
    return '`' + identifier + '`'
  }

  buildWhereSql(
    where: WhereCond[],
    _metaFields: Pick<Field, 'fieldKey' | 'fieldType'>[],
    _startParamIndex = 1,
  ): { sql: string; params: unknown[]; nextIndex: number } {
    if (where.length === 0) return { sql: '', params: [], nextIndex: 1 }

    const clauses: string[] = []
    const params: unknown[] = []

    for (const cond of where) {
      const safeField = this.quote(cond.field)
      switch (cond.op) {
        case '=':
          clauses.push(`${safeField} = ?`)
          params.push(cond.value)
          break
        case '!=':
          clauses.push(`${safeField} != ?`)
          params.push(cond.value)
          break
        case '>':
          clauses.push(`${safeField} > ?`)
          params.push(cond.value)
          break
        case '<':
          clauses.push(`${safeField} < ?`)
          params.push(cond.value)
          break
        case '>=':
          clauses.push(`${safeField} >= ?`)
          params.push(cond.value)
          break
        case '<=':
          clauses.push(`${safeField} <= ?`)
          params.push(cond.value)
          break
        case 'like':
          clauses.push(`${safeField} LIKE ?`)
          params.push(`%${escapeLikePattern(String(cond.value))}%`)
          break
      }
    }

    return { sql: clauses.join(' AND '), params, nextIndex: params.length + 1 }
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
      ? `SELECT COUNT(*) AS total FROM ${table} WHERE ${whereSql}`
      : `SELECT COUNT(*) AS total FROM ${table}`
  }

  buildInsertSql(tableName: string, columns: string[], placeholders: string[]): string {
    const table = this.quote(tableName)
    const cols = columns.map((c) => this.quote(c)).join(', ')
    // MySQL 没有 RETURNING，插入后再 SELECT
    return `INSERT INTO ${table} (${cols}) VALUES (${placeholders.join(', ')})`
  }

  buildUpdateSql(tableName: string, pkField: string, setClause: string, _pkParam: number): string {
    const table = this.quote(tableName)
    const pk = this.quote(pkField)
    return `UPDATE ${table} SET ${setClause} WHERE ${pk} = ?`
  }

  buildDeleteSql(tableName: string, pkField: string): string {
    const table = this.quote(tableName)
    const pk = this.quote(pkField)
    return `DELETE FROM ${table} WHERE ${pk} = ?`
  }

  buildLimitOffsetSql(page: number, size: number): string {
    const offset = (page - 1) * size
    return `LIMIT ${size} OFFSET ${offset}`
  }
}
