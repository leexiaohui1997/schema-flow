/**
 * DDL 生成器：根据元数据字段定义生成 PG DDL 语句。
 * 纯函数，不连数据库，方便单测。
 */

interface FieldLike {
  fieldKey: string
  fieldType: string
  isPrimary?: boolean
  primaryKeyStrategy?: string | null
  isRequired?: boolean
  isUnique?: boolean
  lengthLimit?: number | null
  defaultValue?: string | null
}

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

/** 生成 CREATE TABLE SQL（含 _ctime/_mtime 平台字段） */
export function generateCreateTableSql(tableName: string, fields: FieldLike[]): string {
  const cols: string[] = []

  // 主键列
  const pk = fields.find((f) => f.isPrimary)
  if (pk) {
    cols.push(primaryKeyColumnDef(pk))
  }

  // 普通列
  for (const f of fields) {
    if (f.isPrimary) continue
    cols.push(normalColumnDef(f))
  }

  // 平台字段
  cols.push('"_ctime" TIMESTAMPTZ NOT NULL DEFAULT NOW()')
  cols.push('"_mtime" TIMESTAMPTZ NOT NULL DEFAULT NOW()')

  return `CREATE TABLE "${tableName}" (\n  ${cols.join(',\n  ')}\n)`
}

/** 生成 ALTER TABLE ADD COLUMN SQL */
export function generateAddColumnSql(tableName: string, field: FieldLike): string {
  // 加 NOT NULL 字段到有数据的表，PG 不允许，这里不处理（路由层校验）
  return `ALTER TABLE "${tableName}" ADD COLUMN ${normalColumnDef(field)}`
}

/** 生成加主键列的 SQL（表已存在，后续加主键） */
export function generateAddPkColumnSql(tableName: string, field: FieldLike): string[] {
  const stmts: string[] = []
  const col = `"${field.fieldKey}"`
  if (field.primaryKeyStrategy === 'auto_increment') {
    stmts.push(`ALTER TABLE "${tableName}" ADD COLUMN ${col} SERIAL`)
  } else if (field.primaryKeyStrategy === 'uuid') {
    stmts.push(`ALTER TABLE "${tableName}" ADD COLUMN ${col} UUID DEFAULT gen_random_uuid()`)
  } else {
    // custom
    const type = mapFieldTypeToPgColumn(field.fieldType, field.lengthLimit)
    stmts.push(`ALTER TABLE "${tableName}" ADD COLUMN ${col} ${type}`)
  }
  stmts.push(generateAddPkConstraintSql(tableName, field))
  return stmts
}

/** 生成删主键约束的 SQL */
export function generateDropPkConstraintSql(tableName: string): string {
  return `ALTER TABLE "${tableName}" DROP CONSTRAINT "${tableName}_pkey"`
}

/** 生成 DROP COLUMN SQL（主键列先 DROP CONSTRAINT） */
export function generateDropColumnSql(tableName: string, field: FieldLike): string[] {
  const stmts: string[] = []
  if (field.isPrimary) {
    stmts.push(generateDropPkConstraintSql(tableName))
  }
  stmts.push(`ALTER TABLE "${tableName}" DROP COLUMN "${field.fieldKey}"`)
  return stmts
}

/** 生成加主键约束的 SQL */
export function generateAddPkConstraintSql(tableName: string, field: FieldLike): string {
  return `ALTER TABLE "${tableName}" ADD PRIMARY KEY ("${field.fieldKey}")`
}

/** 生成 SET NOT NULL SQL */
export function generateSetNotNullSql(tableName: string, field: FieldLike): string {
  return `ALTER TABLE "${tableName}" ALTER COLUMN "${field.fieldKey}" SET NOT NULL`
}

/** 生成 DROP NOT NULL SQL */
export function generateDropNotNullSql(tableName: string, field: FieldLike): string {
  return `ALTER TABLE "${tableName}" ALTER COLUMN "${field.fieldKey}" DROP NOT NULL`
}

/** 生成建唯一索引 SQL */
export function generateCreateUniqueIndexSql(tableName: string, field: FieldLike): string {
  return `CREATE UNIQUE INDEX "${tableName}_${field.fieldKey}_key" ON "${tableName}" ("${field.fieldKey}")`
}

/** 生成删唯一索引 SQL */
export function generateDropUniqueIndexSql(tableName: string, field: FieldLike): string {
  return `DROP INDEX IF EXISTS "${tableName}_${field.fieldKey}_key"`
}

/** 生成改列类型 SQL */
export function generateAlterColumnTypeSql(tableName: string, field: FieldLike): string {
  const type = mapFieldTypeToPgColumn(field.fieldType, field.lengthLimit)
  return `ALTER TABLE "${tableName}" ALTER COLUMN "${field.fieldKey}" TYPE ${type} USING "${field.fieldKey}"::${type}`
}

/** 生成 _mtime 自动更新 trigger 函数和 trigger */
export function generateMtimeTriggerSql(tableName: string): string[] {
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
