import type { DdlGenerator, FieldLike } from './ddlGenerator.js'

/**
 * PostgreSQL DDL 生成器
 */

/**
 * fieldType → PG 列类型映射
 * text/select/password/email：有 lengthLimit → VARCHAR(n)，没有 → TEXT
 * url/file：固定 VARCHAR(500)
 */
export function mapFieldTypeToPgColumn(fieldType: string, lengthLimit?: number | null): string {
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
      return 'INTEGER'
    case 'boolean':
      return 'BOOLEAN'
    case 'date':
      return 'DATE'
    case 'datetime':
      return 'TIMESTAMPTZ'
    case 'multiselect':
    case 'json':
      return 'JSONB'
    case 'richtext':
      return 'TEXT'
    default:
      return 'TEXT'
  }
}

/** 主键列定义 */
function primaryKeyColumnDef(field: FieldLike): string {
  const col = `"${field.fieldKey}"`
  if (field.primaryKeyStrategy === 'auto_increment') {
    return `${col} SERIAL PRIMARY KEY`
  }
  if (field.primaryKeyStrategy === 'uuid') {
    return `${col} UUID PRIMARY KEY DEFAULT gen_random_uuid()`
  }
  // custom：普通列 + PRIMARY KEY
  const type = mapFieldTypeToPgColumn(field.fieldType, field.lengthLimit)
  return `${col} ${type} PRIMARY KEY`
}

/** 普通列定义 */
function normalColumnDef(field: FieldLike): string {
  const type = mapFieldTypeToPgColumn(field.fieldType, field.lengthLimit)
  let def = `"${field.fieldKey}" ${type}`
  if (field.isRequired) def += ' NOT NULL'
  return def
}

export class PgDdlGenerator implements DdlGenerator {
  generateCreateTableSql(tableName: string, fields: FieldLike[]): string {
    const cols: string[] = []

    const pk = fields.find((f) => f.isPrimary)
    if (pk) cols.push(primaryKeyColumnDef(pk))

    for (const f of fields) {
      if (f.isPrimary) continue
      cols.push(normalColumnDef(f))
    }

    cols.push('"_ctime" TIMESTAMPTZ NOT NULL DEFAULT NOW()')
    cols.push('"_mtime" TIMESTAMPTZ NOT NULL DEFAULT NOW()')

    return `CREATE TABLE "${tableName}" (\n  ${cols.join(',\n  ')}\n)`
  }

  generateAddColumnSql(tableName: string, field: FieldLike): string {
    return `ALTER TABLE "${tableName}" ADD COLUMN ${normalColumnDef(field)}`
  }

  generateAddPkColumnSql(tableName: string, field: FieldLike): string[] {
    const stmts: string[] = []
    const col = `"${field.fieldKey}"`
    if (field.primaryKeyStrategy === 'auto_increment') {
      stmts.push(`ALTER TABLE "${tableName}" ADD COLUMN ${col} SERIAL`)
    } else if (field.primaryKeyStrategy === 'uuid') {
      stmts.push(`ALTER TABLE "${tableName}" ADD COLUMN ${col} UUID DEFAULT gen_random_uuid()`)
    } else {
      const type = mapFieldTypeToPgColumn(field.fieldType, field.lengthLimit)
      stmts.push(`ALTER TABLE "${tableName}" ADD COLUMN ${col} ${type}`)
    }
    stmts.push(this.generateAddPkConstraintSql(tableName, field))
    return stmts
  }

  private generateAddPkConstraintSql(tableName: string, field: FieldLike): string {
    return `ALTER TABLE "${tableName}" ADD PRIMARY KEY ("${field.fieldKey}")`
  }

  generateDropColumnSql(tableName: string, field: FieldLike): string[] {
    const stmts: string[] = []
    if (field.isPrimary) {
      stmts.push(`ALTER TABLE "${tableName}" DROP CONSTRAINT "${tableName}_pkey"`)
    }
    stmts.push(`ALTER TABLE "${tableName}" DROP COLUMN "${field.fieldKey}"`)
    return stmts
  }

  generateSetNotNullSql(tableName: string, field: FieldLike): string {
    return `ALTER TABLE "${tableName}" ALTER COLUMN "${field.fieldKey}" SET NOT NULL`
  }

  generateDropNotNullSql(tableName: string, field: FieldLike): string {
    return `ALTER TABLE "${tableName}" ALTER COLUMN "${field.fieldKey}" DROP NOT NULL`
  }

  generateCreateUniqueIndexSql(tableName: string, field: FieldLike): string {
    return `CREATE UNIQUE INDEX "${tableName}_${field.fieldKey}_key" ON "${tableName}" ("${field.fieldKey}")`
  }

  generateDropUniqueIndexSql(tableName: string, field: FieldLike): string {
    return `DROP INDEX IF EXISTS "${tableName}_${field.fieldKey}_key"`
  }

  generateAlterColumnTypeSql(tableName: string, field: FieldLike): string {
    const type = mapFieldTypeToPgColumn(field.fieldType, field.lengthLimit)
    return `ALTER TABLE "${tableName}" ALTER COLUMN "${field.fieldKey}" TYPE ${type} USING "${field.fieldKey}"::${type}`
  }

  generateMtimeTriggerSql(tableName: string): string[] {
    const funcName = `update_${tableName}_mtime`
    return [
      `CREATE OR REPLACE FUNCTION "${funcName}"() RETURNS TRIGGER AS $$
BEGIN
  NEW._mtime = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql`,
      `CREATE TRIGGER "${tableName}_update_mtime" BEFORE UPDATE ON "${tableName}"
FOR EACH ROW EXECUTE FUNCTION "${funcName}"()`,
    ]
  }
}
