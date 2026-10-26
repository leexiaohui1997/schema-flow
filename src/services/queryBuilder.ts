/**
 * 查询构建器统一接口
 * 负责生成 DB 专用的 SQL 片段
 */
import type { Field } from '@prisma/client'

export interface WhereCond {
  field: string
  op: string
  value: unknown
}

export interface SortCond {
  field: string
  order: 'asc' | 'desc'
}

export interface QueryBuilder {
  /** 转义表名/列名 */
  quote(identifier: string): string

  /** 生成 where SQL */
  buildWhereSql(
    where: WhereCond[],
    metaFields: Pick<Field, 'fieldKey' | 'fieldType'>[],
    startParamIndex?: number,
  ): { sql: string; params: unknown[]; nextIndex: number }

  /** 生成 ORDER BY SQL */
  buildOrderBySql(sort: SortCond[]): string

  /** 生成 SELECT COUNT SQL */
  buildCountSql(tableName: string, whereSql: string): string

  /** 生成 INSERT SQL */
  buildInsertSql(tableName: string, columns: string[], placeholders: string[]): string

  /** 生成 UPDATE SQL */
  buildUpdateSql(tableName: string, pkField: string, setClause: string, pkParam: number): string

  /** 生成 DELETE SQL */
  buildDeleteSql(tableName: string, pkField: string): string

  /** 生成分页 LIMIT/OFFSET SQL */
  buildLimitOffsetSql(page: number, size: number): string
}
