import { Prisma } from '@prisma/client'
import { Router, Request, Response, NextFunction } from 'express'

import { prisma } from '../prisma.js'
import { createFieldSchema, updateFieldSchema } from '../schemas.js'
import { audit } from '../utils/audit.js'
import { ok, created, fail } from '../utils/respond.js'

const router = Router({ mergeParams: true })

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
  return table
}

// GET /api/projects/:projectId/tables/:tableName/fields
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const table = await loadTable(req, res)
    if (!table) return
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
    const table = await loadTable(req, res)
    if (!table) return
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
    const table = await loadTable(req, res)
    if (!table) return
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
    const table = await loadTable(req, res)
    if (!table) return
    const existing = await prisma.field.findUnique({
      where: { tableId_fieldKey: { tableId: table.id, fieldKey: req.params.fieldKey as string } },
    })
    if (!existing) return fail(res, 404, 'field not found')
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
