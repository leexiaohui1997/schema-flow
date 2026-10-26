import type { DdlGenerator, FieldLike } from './ddlGenerator.js'

/**
 * MySQL DDL 生成器
 */

/**
 * fieldType → MySQL 列类型映射
 */
export function mapFieldTypeToMysqlColumn(fieldType: string, lengthLimit?: number | null): string {
  switch (fieldType) {
    case 'text':
    case 'select':
    case 'password':
    case 'email':
      return lengthLimit ? `VARCHAR(${lengthLimit})` : 'TEXT'
    case 'url':
    case 'file':
      return 'VARCHAR(500)'
    case 'number':
      return 'INT'
    case 'boolean':
      return 'TINYINT(1)'
    case 'date':
      return 'DATE'
    case 'datetime':
      return 'DATETIME'
    case 'multiselect':
    case 'json':
      return 'JSON'
    case 'richtext':
      return 'TEXT'
    default:
      return 'TEXT'
  }
}

/** 主键列定义 */
function primaryKeyColumnDef(field: FieldLike): string {
  const col = '`' + field.fieldKey + '`'
  if (field.primaryKeyStrategy === 'auto_increment') {
    return `${col} INT AUTO_INCREMENT PRIMARY KEY`
  }
  if (field.primaryKeyStrategy === 'uuid') {
    return `${col} CHAR(36) PRIMARY KEY DEFAULT (UUID())`
  }
  // custom：普通列 + PRIMARY KEY
  const type = mapFieldTypeToMysqlColumn(field.fieldType, field.lengthLimit)
  return `${col} ${type} PRIMARY KEY`
}

/** 普通列定义 */
function normalColumnDef(field: FieldLike): string {
  const type = mapFieldTypeToMysqlColumn(field.fieldType, field.lengthLimit)
  let def = '`' + field.fieldKey + '`' + ` ${type}`
  if (field.isRequired) def += ' NOT NULL'
  return def
}

export class MysqlDdlGenerator implements DdlGenerator {
  generateCreateTableSql(tableName: string, fields: FieldLike[]): string {
    const cols: string[] = []

    const pk = fields.find((f) => f.isPrimary)
    if (pk) cols.push(primaryKeyColumnDef(pk))

    for (const f of fields) {
      if (f.isPrimary) continue
      cols.push(normalColumnDef(f))
    }

    // MySQL 自动时间戳，不需要 trigger
    cols.push('`_ctime` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP')
    cols.push('`_mtime` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP')

    return `CREATE TABLE \`${tableName}\` (\n  ${cols.join(',\n  ')}\n)`
  }

  generateAddColumnSql(tableName: string, field: FieldLike): string {
    return `ALTER TABLE \`${tableName}\` ADD COLUMN ${normalColumnDef(field)}`
  }

  generateAddPkColumnSql(tableName: string, field: FieldLike): string[] {
    const stmts: string[] = []
    const col = '`' + field.fieldKey + '`'
    if (field.primaryKeyStrategy === 'auto_increment') {
      stmts.push(`ALTER TABLE \`${tableName}\` ADD COLUMN ${col} INT AUTO_INCREMENT`)
    } else if (field.primaryKeyStrategy === 'uuid') {
      stmts.push(`ALTER TABLE \`${tableName}\` ADD COLUMN ${col} CHAR(36) DEFAULT (UUID())`)
    } else {
      const type = mapFieldTypeToMysqlColumn(field.fieldType, field.lengthLimit)
      stmts.push(`ALTER TABLE \`${tableName}\` ADD COLUMN ${col} ${type}`)
    }
    stmts.push(this.generateAddPkConstraintSql(tableName, field))
    return stmts
  }

  private generateAddPkConstraintSql(tableName: string, field: FieldLike): string {
    return `ALTER TABLE \`${tableName}\` ADD PRIMARY KEY (\`${field.fieldKey}\`)`
  }

  generateDropColumnSql(tableName: string, field: FieldLike): string[] {
    const stmts: string[] = []
    // MySQL 删主键列需要先 DROP PRIMARY KEY
    if (field.isPrimary) {
      stmts.push(`ALTER TABLE \`${tableName}\` DROP PRIMARY KEY`)
    }
    stmts.push(`ALTER TABLE \`${tableName}\` DROP COLUMN \`${field.fieldKey}\``)
    return stmts
  }

  generateSetNotNullSql(tableName: string, field: FieldLike): string {
    const type = mapFieldTypeToMysqlColumn(field.fieldType, field.lengthLimit)
    return `ALTER TABLE \`${tableName}\` MODIFY COLUMN \`${field.fieldKey}\` ${type} NOT NULL`
  }

  generateDropNotNullSql(tableName: string, field: FieldLike): string {
    const type = mapFieldTypeToMysqlColumn(field.fieldType, field.lengthLimit)
    return `ALTER TABLE \`${tableName}\` MODIFY COLUMN \`${field.fieldKey}\` ${type} NULL`
  }

  generateCreateUniqueIndexSql(tableName: string, field: FieldLike): string {
    return `CREATE UNIQUE INDEX \`${tableName}_${field.fieldKey}_key\` ON \`${tableName}\` (\`${field.fieldKey}\`)`
  }

  generateDropUniqueIndexSql(tableName: string, field: FieldLike): string {
    return `DROP INDEX \`${tableName}_${field.fieldKey}_key\` ON \`${tableName}\``
  }

  generateAlterColumnTypeSql(tableName: string, field: FieldLike): string {
    const type = mapFieldTypeToMysqlColumn(field.fieldType, field.lengthLimit)
    return `ALTER TABLE \`${tableName}\` MODIFY COLUMN \`${field.fieldKey}\` ${type}`
  }

  generateMtimeTriggerSql(): string[] {
    // MySQL 用 ON UPDATE CURRENT_TIMESTAMP，不需要 trigger
    return []
  }
}
