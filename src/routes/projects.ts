import { Router, Request, Response, NextFunction } from 'express'
import { nanoid } from 'nanoid'

import { prisma } from '../prisma.js'
import { createProjectSchema, updateProjectSchema } from '../schemas.js'
import { serializeDbConfig, deserializeDbConfig } from '../services/dbConfig.js'
import { closeDbClient } from '../services/dbConnection.js'
import { audit, maskDbConfig } from '../utils/audit.js'
import { ok, created, fail } from '../utils/respond.js'

const router = Router()

// GET /api/projects
router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const list = await prisma.project.findMany({
      orderBy: { createdAt: 'desc' },
    })
    // 返回时把 dbConfig 解密（阶段一就是原样）
    const data = list.map((p) => ({
      ...p,
      dbConfig: deserializeDbConfig(p.dbConfig),
    }))
    return ok(res, data)
  } catch (e) {
    next(e)
  }
})

// POST /api/projects
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = createProjectSchema.parse(req.body)
    const projectId = `proj_${nanoid(16)}`
    const project = await prisma.project.create({
      data: {
        projectId,
        name: body.name,
        dbType: body.dbType,
        dbConfig: serializeDbConfig(body.dbConfig),
      },
    })
    audit({
      action: 'project.create',
      projectId,
      operator: (req as any).operator,
      after: maskDbConfig(project),
    })
    return created(res, { ...project, dbConfig: deserializeDbConfig(project.dbConfig) })
  } catch (e) {
    next(e)
  }
})

// GET /api/projects/:projectId
router.get('/:projectId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const p = await prisma.project.findUnique({
      where: { projectId: req.params.projectId as string },
    })
    if (!p) return fail(res, 404, 'project not found')
    return ok(res, { ...p, dbConfig: deserializeDbConfig(p.dbConfig) })
  } catch (e) {
    next(e)
  }
})

// PUT /api/projects/:projectId
router.put('/:projectId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = updateProjectSchema.parse(req.body)
    const existing = await prisma.project.findUnique({
      where: { projectId: req.params.projectId as string },
    })
    if (!existing) return fail(res, 404, 'project not found')

    // dbType 创建后只读，不能改
    if (body.dbType !== undefined && body.dbType !== existing.dbType) {
      return fail(res, 400, 'dbType is read-only after project creation')
    }
    // dbConfig 里的 dbType 也不能改
    if (body.dbConfig !== undefined) {
      const oldDbConfig = deserializeDbConfig(existing.dbConfig) as { dbType?: string }
      const newDbConfig = body.dbConfig as { dbType?: string }
      if (oldDbConfig.dbType !== newDbConfig.dbType) {
        return fail(res, 400, 'dbConfig.dbType is read-only after project creation')
      }
    }

    const data: any = {}
    if (body.name !== undefined) data.name = body.name
    if (body.dbConfig !== undefined) data.dbConfig = serializeDbConfig(body.dbConfig)
    if (body.status !== undefined) data.status = body.status

    const updated = await prisma.project.update({
      where: { projectId: req.params.projectId as string },
      data,
    })

    // dbConfig 变了就关掉旧连接池，下次请求重建
    if (body.dbConfig !== undefined) {
      await closeDbClient(req.params.projectId as string)
    }

    audit({
      action: 'project.update',
      projectId: req.params.projectId as string,
      operator: (req as any).operator,
      before: maskDbConfig(existing),
      after: maskDbConfig(updated),
    })
    return ok(res, { ...updated, dbConfig: deserializeDbConfig(updated.dbConfig) })
  } catch (e) {
    next(e)
  }
})

// DELETE /api/projects/:projectId —— 软删（status=false）
router.delete('/:projectId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const existing = await prisma.project.findUnique({
      where: { projectId: req.params.projectId as string },
    })
    if (!existing) return fail(res, 404, 'project not found')
    const updated = await prisma.project.update({
      where: { projectId: req.params.projectId as string },
      data: { status: false },
    })
    audit({
      action: 'project.delete',
      projectId: req.params.projectId as string,
      operator: (req as any).operator,
      before: existing,
    })
    return ok(res, { projectId: updated.projectId, status: updated.status })
  } catch (e) {
    next(e)
  }
})

export default router
