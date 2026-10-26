/**
 * DDL 生成器统一接口
 */

export interface FieldLike {
  fieldKey: string
  fieldType: string
  isPrimary?: boolean
  primaryKeyStrategy?: string | null
  isRequired?: boolean
  isUnique?: boolean
  lengthLimit?: number | null
  defaultValue?: string | null
}

export interface DdlGenerator {
  generateCreateTableSql(tableName: string, fields: FieldLike[]): string
  generateAddColumnSql(tableName: string, field: FieldLike): string
  generateAddPkColumnSql(tableName: string, field: FieldLike): string[]
  generateDropColumnSql(tableName: string, field: FieldLike): string[]
  generateSetNotNullSql(tableName: string, field: FieldLike): string
  generateDropNotNullSql(tableName: string, field: FieldLike): string
  generateCreateUniqueIndexSql(tableName: string, field: FieldLike): string
  generateDropUniqueIndexSql(tableName: string, field: FieldLike): string
  generateAlterColumnTypeSql(tableName: string, field: FieldLike): string
  generateMtimeTriggerSql(tableName: string): string[]
}
