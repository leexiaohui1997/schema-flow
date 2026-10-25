import { Prisma } from '@prisma/client'
import { Router, Request, Response, NextFunction } from 'express'

import { prisma } from '../prisma.js'
import { createTableSchema, updateTableSchema } from '../schemas.js'
import { audit } from '../utils/audit.js'
import { ok, created, fail } from '../utils/respond.js'

const router = Router({ mergeParams: true })

async function loadProject(req: Request, res: Response) {
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
  return project
}

// GET /api/projects/:projectId/tables
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const project = await loadProject(req, res)
    if (!project) return
    const list = await prisma.table.findMany({
      where: { projectId: project.projectId },
      orderBy: { createdAt: 'desc' },
    })
    return ok(res, list)
  } catch (e) {
    next(e)
  }
})

// POST /api/projects/:projectId/tables
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const project = await loadProject(req, res)
    if (!project) return
    const body = createTableSchema.parse(req.body)
    const table = await prisma.table.create({
      data: {
        projectId: project.projectId,
        tableName: body.tableName,
        displayName: body.displayName,
        description: body.description,
        securityConfig: (body.securityConfig ?? {}) as Prisma.InputJsonObject,
        viewConfig: (body.viewConfig ?? {}) as Prisma.InputJsonObject,
      },
    })
    audit({
      action: 'table.create',
      projectId: project.projectId,
      tableName: body.tableName,
      operator: (req as any).operator,
      after: table,
    })
    return created(res, table)
  } catch (e: any) {
    if (e.code === 'P2002') {
      return fail(res, 409, `table "${req.body.tableName}" already exists in this project`)
    }
    next(e)
  }
})

// GET /api/projects/:projectId/tables/:tableName
router.get('/:tableName', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const project = await loadProject(req, res)
    if (!project) return
    const table = await prisma.table.findUnique({
      where: {
        projectId_tableName: {
          projectId: project.projectId,
          tableName: req.params.tableName as string,
        },
      },
      include: { fields: { orderBy: { sortOrder: 'asc' } } },
    })
    if (!table) return fail(res, 404, 'table not found')
    return ok(res, table)
  } catch (e) {
    next(e)
  }
})

// PUT /api/projects/:projectId/tables/:tableName
router.put('/:tableName', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const project = await loadProject(req, res)
    if (!project) return
    const body = updateTableSchema.parse(req.body)
    const existing = await prisma.table.findUnique({
      where: {
        projectId_tableName: {
          projectId: project.projectId,
          tableName: req.params.tableName as string,
        },
      },
    })
    if (!existing) return fail(res, 404, 'table not found')

    const data: any = {
      displayName: body.displayName ?? existing.displayName,
    }
    if (body.description !== undefined) data.description = body.description
    if (body.securityConfig !== undefined)
      data.securityConfig = body.securityConfig as Prisma.InputJsonObject
    if (body.viewConfig !== undefined) data.viewConfig = body.viewConfig as Prisma.InputJsonObject

    const updated = await prisma.table.update({
      where: { id: existing.id },
      data,
    })
    audit({
      action: 'table.update',
      projectId: project.projectId,
      tableName: req.params.tableName as string,
      operator: (req as any).operator,
      before: existing,
      after: updated,
    })
    return ok(res, updated)
  } catch (e) {
    next(e)
  }
})

// DELETE /api/projects/:projectId/tables/:tableName —— 级联删 fields
router.delete('/:tableName', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const project = await loadProject(req, res)
    if (!project) return
    const existing = await prisma.table.findUnique({
      where: {
        projectId_tableName: {
          projectId: project.projectId,
          tableName: req.params.tableName as string,
        },
      },
      include: { _count: { select: { fields: true } } },
    })
    if (!existing) return fail(res, 404, 'table not found')
    await prisma.table.delete({ where: { id: existing.id } }) // onDelete: Cascade 自动删 fields
    audit({
      action: 'table.delete',
      projectId: project.projectId,
      tableName: req.params.tableName as string,
      operator: (req as any).operator,
      cascadedFields: existing._count.fields,
      before: existing,
    })
    return ok(res, {
      tableName: req.params.tableName as string,
      deletedFields: existing._count.fields,
    })
  } catch (e) {
    next(e)
  }
})

export default router
