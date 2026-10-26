import { Prisma } from '@prisma/client'
import { Router, Request, Response, NextFunction } from 'express'

import { prisma } from '../prisma.js'
import { createFieldSchema, updateFieldSchema } from '../schemas.js'
import { deserializeDbConfig } from '../services/dbConfig.js'
import { executeDdl, shouldSkipDdl } from '../services/ddlExecutor.js'
import { MysqlDdlGenerator } from '../services/mysqlDdlGenerator.js'
import { PgDdlGenerator } from '../services/pgDdlGenerator.js'
import { audit } from '../utils/audit.js'
import { ok, created, fail } from '../utils/respond.js'

import type { DdlGenerator } from '../services/ddlGenerator.js'

const router = Router({ mergeParams: true })

/** 根据项目的 dbConfig 选 DDL 生成器 */
function getDdlGenerator(dbConfig: any): DdlGenerator {
  const cfg = deserializeDbConfig(dbConfig) as { dbType?: string }
  const dbType = cfg.dbType ?? 'postgres'
  return dbType === 'mysql' ? new MysqlDdlGenerator() : new PgDdlGenerator()
}

async function loadTable(req: Request, res: Response) {
  const project = await prisma.project.findUnique({
    where: { projectId: req.params.projectId as string },
  })
  if (!project) {
    fail(res, 404, 'project not found')
    return null
  }
  if (!project.status) {
    fail(res, 403, 'project is disabled')
    return null
  }
  const table = await prisma.table.findUnique({
    where: {
      projectId_tableName: {
        projectId: project.projectId,
        tableName: req.params.tableName as string,
      },
    },
  })
  if (!table) {
    fail(res, 404, 'table not found')
    return null
  }
  return { project, table }
}

// 把 DB 错误转成友好提示
function handleDbError(e: any, res: Response): boolean {
  // PG: 23505 unique violation, MySQL: 1062 ER_DUP_ENTRY
  if (e.code === '23505' || e.errno === 1062 || e.code === 'ER_DUP_ENTRY') {
    fail(res, 409, '现有数据有重复，无法加唯一约束')
    return true
  }
  // PG: 22001 string_data_length_mismatch
  if (e.code === '22001') {
    fail(res, 400, '现有数据超过新长度限制，无法缩窄')
    return true
  }
  return false
}

// GET /api/projects/:projectId/tables/:tableName/fields
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await loadTable(req, res)
    if (!result) return
    const { table } = result
    const list = await prisma.field.findMany({
      where: { tableId: table.id },
      orderBy: { sortOrder: 'asc' },
    })
    return ok(res, list)
  } catch (e) {
    next(e)
  }
})

// POST /api/projects/:projectId/tables/:tableName/fields
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await loadTable(req, res)
    if (!result) return
    const { project, table } = result
    const body = createFieldSchema.parse(req.body)

    // 主键一致性校验
    if (body.isPrimary && !body.primaryKeyStrategy) {
      return fail(res, 400, 'primary key field must specify primaryKeyStrategy')
    }
    if (!body.isPrimary && body.primaryKeyStrategy) {
      return fail(res, 400, 'non-primary field must not set primaryKeyStrategy')
    }
    // 一表一主键：设为主键前检查表是否已有主键
    if (body.isPrimary) {
      const existingPk = await prisma.field.findFirst({
        where: { tableId: table.id, isPrimary: true },
      })
      if (existingPk) {
        return fail(res, 400, `table already has primary key "${existingPk.fieldKey}"`)
      }
    }

    // 查这张表是不是第一个字段
    const fieldCount = await prisma.field.count({ where: { tableId: table.id } })
    const skipDdl = shouldSkipDdl(table.securityConfig)
    const ddlGen = getDdlGenerator(project.dbConfig)
    const ddlStmts: string[] = []

    if (!skipDdl) {
      if (fieldCount === 0) {
        // 第一个字段：建表
        const createSql = ddlGen.generateCreateTableSql(table.tableName, [body])
        ddlStmts.push(createSql)
        ddlStmts.push(...ddlGen.generateMtimeTriggerSql(table.tableName))
      } else {
        // 已有字段：ADD COLUMN
        // NOT NULL 字段必须有 defaultValue（PG 不允许 ADD COLUMN NOT NULL 不给默认值）
        if (body.isRequired && body.defaultValue == null) {
          return fail(res, 400, 'NOT NULL 字段必须提供 defaultValue，或允许 NULL')
        }
        if (body.isPrimary) {
          // 主键字段：按策略生成 SERIAL/UUID/custom 列 + PK 约束
          ddlStmts.push(...ddlGen.generateAddPkColumnSql(table.tableName, body))
        } else {
          ddlStmts.push(ddlGen.generateAddColumnSql(table.tableName, body))
          // isUnique=true 加唯一索引
          if (body.isUnique) {
            ddlStmts.push(ddlGen.generateCreateUniqueIndexSql(table.tableName, body))
          }
        }
      }
    }

    // 先执行 DDL，成功后再写元数据
    try {
      await executeDdl(req.params.projectId as string, ddlStmts)
    } catch (e: any) {
      if (handleDbError(e, res)) return
      throw e
    }

    const field = await prisma.field.create({
      data: {
        tableId: table.id,
        fieldKey: body.fieldKey,
        displayName: body.displayName,
        fieldType: body.fieldType,
        isPrimary: body.isPrimary,
        primaryKeyStrategy: body.primaryKeyStrategy ?? null,
        isRequired: body.isRequired,
        isUnique: body.isUnique,
        isReadonly: body.isReadonly,
        lengthLimit: body.lengthLimit,
        regex: body.regex,
        defaultValue: body.defaultValue,
        options: (body.options ?? undefined) as Prisma.InputJsonValue | undefined,
        sortOrder: body.sortOrder,
        extraConfig: {} as Prisma.InputJsonObject,
      },
    })
    audit({
      action: 'field.create',
      projectId: req.params.projectId as string,
      tableName: req.params.tableName as string,
      fieldKey: body.fieldKey,
      operator: (req as any).operator,
      after: field,
    })
    return created(res, field)
  } catch (e: any) {
    if (e.code === 'P2002') {
      return fail(res, 409, `field "${req.body.fieldKey}" already exists in this table`)
    }
    next(e)
  }
})

// PUT /api/projects/:projectId/tables/:tableName/fields/:fieldKey
router.put('/:fieldKey', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await loadTable(req, res)
    if (!result) return
    const { project, table } = result
    const body = updateFieldSchema.parse(req.body)
    const existing = await prisma.field.findUnique({
      where: { tableId_fieldKey: { tableId: table.id, fieldKey: req.params.fieldKey as string } },
    })
    if (!existing) return fail(res, 404, 'field not found')

    // 主键一致性校验
    const nextIsPrimary = body.isPrimary ?? existing.isPrimary
    const nextStrategy =
      body.primaryKeyStrategy !== undefined ? body.primaryKeyStrategy : existing.primaryKeyStrategy
    if (nextIsPrimary && !nextStrategy) {
      return fail(res, 400, 'primary key field must specify primaryKeyStrategy')
    }
    if (!nextIsPrimary && nextStrategy) {
      return fail(res, 400, 'non-primary field must not set primaryKeyStrategy')
    }
    // 一表一主键：改成主键前检查是否已有其他主键
    if (nextIsPrimary && !existing.isPrimary) {
      const existingPk = await prisma.field.findFirst({
        where: { tableId: table.id, isPrimary: true, NOT: { id: existing.id } },
      })
      if (existingPk) {
        return fail(res, 400, `table already has primary key "${existingPk.fieldKey}"`)
      }
    }

    // 对比新旧值，收集 DDL 语句
    const skipDdl = shouldSkipDdl(table.securityConfig)
    const ddlGen = getDdlGenerator(project.dbConfig)
    const ddlStmts: string[] = []

    if (!skipDdl) {
      const nextIsRequired = body.isRequired ?? existing.isRequired
      const nextIsUnique = body.isUnique ?? existing.isUnique
      const nextLengthLimit =
        body.lengthLimit !== undefined ? body.lengthLimit : existing.lengthLimit

      // isRequired 变更
      if (nextIsRequired !== existing.isRequired) {
        if (nextIsRequired) {
          ddlStmts.push(ddlGen.generateSetNotNullSql(table.tableName, existing))
        } else {
          ddlStmts.push(ddlGen.generateDropNotNullSql(table.tableName, existing))
        }
      }

      // isUnique 变更
      if (nextIsUnique !== existing.isUnique) {
        if (nextIsUnique) {
          ddlStmts.push(ddlGen.generateCreateUniqueIndexSql(table.tableName, existing))
        } else {
          ddlStmts.push(ddlGen.generateDropUniqueIndexSql(table.tableName, existing))
        }
      }

      // lengthLimit 变更
      if (nextLengthLimit !== existing.lengthLimit) {
        ddlStmts.push(
          ddlGen.generateAlterColumnTypeSql(table.tableName, {
            ...existing,
            lengthLimit: nextLengthLimit,
          }),
        )
      }
    }

    // 先执行 DDL，成功后再更新元数据
    try {
      await executeDdl(req.params.projectId as string, ddlStmts)
    } catch (e: any) {
      if (handleDbError(e, res)) return
      throw e
    }

    const data: any = {
      displayName: body.displayName ?? existing.displayName,
      isPrimary: nextIsPrimary,
      primaryKeyStrategy: nextStrategy,
      isRequired: body.isRequired ?? existing.isRequired,
      isUnique: body.isUnique ?? existing.isUnique,
      isReadonly: body.isReadonly ?? existing.isReadonly,
      sortOrder: body.sortOrder ?? existing.sortOrder,
    }
    if (body.lengthLimit !== undefined) data.lengthLimit = body.lengthLimit
    if (body.regex !== undefined) data.regex = body.regex
    if (body.defaultValue !== undefined) data.defaultValue = body.defaultValue
    if (body.options !== undefined) data.options = body.options as Prisma.InputJsonValue
    if (body.extraConfig !== undefined)
      data.extraConfig = body.extraConfig as Prisma.InputJsonObject

    const updated = await prisma.field.update({
      where: { id: existing.id },
      data,
    })
    audit({
      action: 'field.update',
      projectId: req.params.projectId as string,
      tableName: req.params.tableName as string,
      fieldKey: req.params.fieldKey as string,
      operator: (req as any).operator,
      before: existing,
      after: updated,
    })
    return ok(res, updated)
  } catch (e) {
    next(e)
  }
})

// DELETE /api/projects/:projectId/tables/:tableName/fields/:fieldKey
router.delete('/:fieldKey', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await loadTable(req, res)
    if (!result) return
    const { project, table } = result
    const existing = await prisma.field.findUnique({
      where: { tableId_fieldKey: { tableId: table.id, fieldKey: req.params.fieldKey as string } },
    })
    if (!existing) return fail(res, 404, 'field not found')

    // 先执行 DDL，成功后再删元数据
    const skipDdl = shouldSkipDdl(table.securityConfig)
    if (!skipDdl) {
      const ddlGen = getDdlGenerator(project.dbConfig)
      const ddlStmts = ddlGen.generateDropColumnSql(table.tableName, existing)
      try {
        await executeDdl(req.params.projectId as string, ddlStmts)
      } catch (e: any) {
        if (handleDbError(e, res)) return
        throw e
      }
    }

    await prisma.field.delete({ where: { id: existing.id } })
    audit({
      action: 'field.delete',
      projectId: req.params.projectId as string,
      tableName: req.params.tableName as string,
      fieldKey: req.params.fieldKey as string,
      operator: (req as any).operator,
      before: existing,
    })
    return ok(res, { fieldKey: req.params.fieldKey as string })
  } catch (e) {
    next(e)
  }
})

export default router
