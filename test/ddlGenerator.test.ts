import { describe, it, expect } from 'vitest'

import { mapFieldTypeToPgColumn, PgDdlGenerator } from '../src/services/pgDdlGenerator.js'

const gen = new PgDdlGenerator()

describe('mapFieldTypeToPgColumn', () => {
  it('text 有 lengthLimit → VARCHAR(n)', () => {
    expect(mapFieldTypeToPgColumn('text', 100)).toBe('VARCHAR(100)')
  })
  it('text 没 lengthLimit → TEXT', () => {
    expect(mapFieldTypeToPgColumn('text')).toBe('TEXT')
  })
  it('number → INTEGER', () => {
    expect(mapFieldTypeToPgColumn('number')).toBe('INTEGER')
  })
  it('boolean → BOOLEAN', () => {
    expect(mapFieldTypeToPgColumn('boolean')).toBe('BOOLEAN')
  })
  it('datetime → TIMESTAMPTZ', () => {
    expect(mapFieldTypeToPgColumn('datetime')).toBe('TIMESTAMPTZ')
  })
  it('json → JSONB', () => {
    expect(mapFieldTypeToPgColumn('json')).toBe('JSONB')
  })
  it('url → VARCHAR(500)', () => {
    expect(mapFieldTypeToPgColumn('url')).toBe('VARCHAR(500)')
  })
})

describe('generateCreateTableSql', () => {
  it('主键 auto_increment → SERIAL PRIMARY KEY', () => {
    const sql = gen.generateCreateTableSql('album', [
      {
        fieldKey: 'id',
        fieldType: 'number',
        isPrimary: true,
        primaryKeyStrategy: 'auto_increment',
      },
    ])
    expect(sql).toContain('"id" SERIAL PRIMARY KEY')
    expect(sql).toContain('"_ctime" TIMESTAMPTZ NOT NULL DEFAULT NOW()')
    expect(sql).toContain('"_mtime" TIMESTAMPTZ NOT NULL DEFAULT NOW()')
  })

  it('主键 uuid → UUID PRIMARY KEY DEFAULT gen_random_uuid()', () => {
    const sql = gen.generateCreateTableSql('users', [
      { fieldKey: 'uid', fieldType: 'uuid', isPrimary: true, primaryKeyStrategy: 'uuid' },
    ])
    expect(sql).toContain('"uid" UUID PRIMARY KEY DEFAULT gen_random_uuid()')
  })

  it('普通列 NOT NULL', () => {
    const sql = gen.generateCreateTableSql('album', [
      {
        fieldKey: 'id',
        fieldType: 'number',
        isPrimary: true,
        primaryKeyStrategy: 'auto_increment',
      },
      { fieldKey: 'name', fieldType: 'text', isRequired: true, lengthLimit: 100 },
    ])
    expect(sql).toContain('"name" VARCHAR(100) NOT NULL')
  })

  it('没主键时也建表', () => {
    const sql = gen.generateCreateTableSql('album', [{ fieldKey: 'name', fieldType: 'text' }])
    expect(sql).toContain('CREATE TABLE "album"')
    expect(sql).not.toContain('PRIMARY KEY')
  })

  it('custom 策略作为首字段，CREATE TABLE 带 PRIMARY KEY', () => {
    const sql = gen.generateCreateTableSql('users', [
      {
        fieldKey: 'uid',
        fieldType: 'text',
        isPrimary: true,
        primaryKeyStrategy: 'custom',
        lengthLimit: 64,
      },
    ])
    expect(sql).toContain('"uid" VARCHAR(64) PRIMARY KEY')
  })
})

describe('generateAddColumnSql', () => {
  it('ADD COLUMN', () => {
    const sql = gen.generateAddColumnSql('album', { fieldKey: 'genre', fieldType: 'text' })
    expect(sql).toBe('ALTER TABLE "album" ADD COLUMN "genre" TEXT')
  })
})

describe('generateDropColumnSql', () => {
  it('普通字段 DROP COLUMN', () => {
    const stmts = gen.generateDropColumnSql('album', { fieldKey: 'genre', fieldType: 'text' })
    expect(stmts).toEqual(['ALTER TABLE "album" DROP COLUMN "genre"'])
  })
  it('主键字段先 DROP CONSTRAINT', () => {
    const stmts = gen.generateDropColumnSql('album', {
      fieldKey: 'id',
      fieldType: 'number',
      isPrimary: true,
    })
    expect(stmts).toEqual([
      'ALTER TABLE "album" DROP CONSTRAINT "album_pkey"',
      'ALTER TABLE "album" DROP COLUMN "id"',
    ])
  })
})

describe('unique index', () => {
  it('CREATE UNIQUE INDEX', () => {
    const sql = gen.generateCreateUniqueIndexSql('users', { fieldKey: 'email', fieldType: 'email' })
    expect(sql).toBe('CREATE UNIQUE INDEX "users_email_key" ON "users" ("email")')
  })
  it('DROP INDEX', () => {
    const sql = gen.generateDropUniqueIndexSql('users', { fieldKey: 'email', fieldType: 'email' })
    expect(sql).toBe('DROP INDEX IF EXISTS "users_email_key"')
  })
})

describe('not null', () => {
  it('SET NOT NULL', () => {
    expect(gen.generateSetNotNullSql('album', { fieldKey: 'name', fieldType: 'text' })).toBe(
      'ALTER TABLE "album" ALTER COLUMN "name" SET NOT NULL',
    )
  })
  it('DROP NOT NULL', () => {
    expect(gen.generateDropNotNullSql('album', { fieldKey: 'name', fieldType: 'text' })).toBe(
      'ALTER TABLE "album" ALTER COLUMN "name" DROP NOT NULL',
    )
  })
})

describe('generateAddPkColumnSql', () => {
  it('auto_increment 策略：ADD COLUMN SERIAL + ADD PK', () => {
    const stmts = gen.generateAddPkColumnSql('album', {
      fieldKey: 'id',
      fieldType: 'number',
      isPrimary: true,
      primaryKeyStrategy: 'auto_increment',
    })
    expect(stmts).toEqual([
      'ALTER TABLE "album" ADD COLUMN "id" SERIAL',
      'ALTER TABLE "album" ADD PRIMARY KEY ("id")',
    ])
  })
  it('uuid 策略：ADD COLUMN UUID DEFAULT + ADD PK', () => {
    const stmts = gen.generateAddPkColumnSql('users', {
      fieldKey: 'uid',
      fieldType: 'uuid',
      isPrimary: true,
      primaryKeyStrategy: 'uuid',
    })
    expect(stmts).toEqual([
      'ALTER TABLE "users" ADD COLUMN "uid" UUID DEFAULT gen_random_uuid()',
      'ALTER TABLE "users" ADD PRIMARY KEY ("uid")',
    ])
  })
  it('custom 策略：ADD COLUMN 普通类型 + ADD PK', () => {
    const stmts = gen.generateAddPkColumnSql('users', {
      fieldKey: 'uid',
      fieldType: 'text',
      isPrimary: true,
      primaryKeyStrategy: 'custom',
      lengthLimit: 64,
    })
    expect(stmts).toEqual([
      'ALTER TABLE "users" ADD COLUMN "uid" VARCHAR(64)',
      'ALTER TABLE "users" ADD PRIMARY KEY ("uid")',
    ])
  })
})

describe('generateMtimeTriggerSql', () => {
  it('生成 trigger 函数和 trigger', () => {
    const stmts = gen.generateMtimeTriggerSql('album')
    expect(stmts.length).toBe(2)
    expect(stmts[0]).toContain('CREATE OR REPLACE FUNCTION "update_album_mtime"()')
    expect(stmts[1]).toContain('CREATE TRIGGER "album_update_mtime"')
  })
})
