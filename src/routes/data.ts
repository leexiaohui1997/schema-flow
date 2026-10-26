import { Router as createRouter } from 'express'

import { prisma } from '../prisma.js'
import { getDbClient } from '../services/dbConnection.js'
import { parseQuery, buildWhereSql, buildOrderBySql } from '../services/queryParser.js'
import { validateData } from '../services/validator.js'
import { audit, maskRow } from '../utils/audit.js'
import { ok, created, fail } from '../utils/respond.js'

import type { Request, Response, NextFunction, Router } from 'express'

const router: Router = createRouter({ mergeParams: true })

// 加载项目 + 表元数据 + 字段元数据
async function loadContext(req: Request, res: Response) {
  const projectId = req.params.projectId as string
  const tableName = req.params.tableName as string

  const project = await prisma.project.findUnique({ where: { projectId } })
  if (!project) {
    fail(res, 404, 'project not found')
    return null
  }
  if (!project.status) {
    fail(res, 403, 'project is disabled')
    return null
  }

  const table = await prisma.table.findUnique({
    where: { projectId_tableName: { projectId, tableName } },
  })
  if (!table) {
    fail(res, 404, 'table not found')
    return null
  }

  const fields = await prisma.field.findMany({
    where: { tableId: table.id },
    orderBy: { sortOrder: 'asc' },
  })

  const pkField = fields.find((f) => f.isPrimary)
  if (!pkField) {
    fail(res, 400, `table "${tableName}" is not ready: missing primary key field`)
    return null
  }

  return { project, table, fields, pkField }
}

// GET /list
router.get('/list', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ctx = await loadContext(req, res)
    if (!ctx) return

    let parsed
    try {
      parsed = parseQuery(req.query as Record<string, unknown>, ctx.fields)
    } catch (e: any) {
      return fail(res, 400, e.message)
    }
    const { where, sort, page, size } = parsed

    const whereBuilt = buildWhereSql(where, ctx.fields)
    const orderSql = buildOrderBySql(sort)
    const offset = (page - 1) * size

    // COUNT
    const countSql = whereBuilt.sql
      ? `SELECT COUNT(*)::int AS total FROM "${ctx.table.tableName}" WHERE ${whereBuilt.sql}`
      : `SELECT COUNT(*)::int AS total FROM "${ctx.table.tableName}"`
    const countRes = await client_query(ctx, countSql, whereBuilt.params)
    const total = countRes.rows[0].total as number

    // SELECT
    const whereClause = whereBuilt.sql ? `WHERE ${whereBuilt.sql}` : ''
    const selectSql = `SELECT * FROM "${ctx.table.tableName}"
      ${whereClause}
      ${orderSql ? orderSql + ' ' : ''}
      LIMIT $${whereBuilt.nextIndex} OFFSET $${whereBuilt.nextIndex + 1}`
    const listRes = await client_query(ctx, selectSql, [...whereBuilt.params, size, offset])

    return ok(res, { list: listRes.rows, total, page, size })
  } catch (e) {
    next(e)
  }
})

// GET /:id
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ctx = await loadContext(req, res)
    if (!ctx) return

    const sql = `SELECT * FROM "${ctx.table.tableName}" WHERE "${ctx.pkField.fieldKey}" = $1 LIMIT 1`
    const r = await client_query(ctx, sql, [req.params.id])
    if (r.rows.length === 0) return fail(res, 404, 'record not found')
    return ok(res, r.rows[0])
  } catch (e) {
    next(e)
  }
})

// POST /create
router.post('/create', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ctx = await loadContext(req, res)
    if (!ctx) return

    const data = req.body as Record<string, unknown>
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return fail(res, 400, 'body must be a JSON object')
    }

    // 只允许写入元数据里注册过的字段
    const allowedKeys = new Set(ctx.fields.map((f) => f.fieldKey))
    const safeData: Record<string, unknown> = {}
    for (const k of Object.keys(data)) {
      if (allowedKeys.has(k)) safeData[k] = data[k]
    }

    // 只读字段不允许写入，传了就报错
    const readonlyFields = ctx.fields.filter((f) => f.isReadonly).map((f) => f.fieldKey)
    const attemptedReadonly = Object.keys(safeData).filter((k) => readonlyFields.includes(k))
    if (attemptedReadonly.length > 0) {
      return fail(res, 400, `cannot write to readonly field(s): ${attemptedReadonly.join(', ')}`)
    }

    // 注入 defaultValue（create 时用户没传的字段），按 fieldType 转类型
    for (const f of ctx.fields) {
      if (safeData[f.fieldKey] === undefined && f.defaultValue !== null) {
        safeData[f.fieldKey] = coerceValue(f.fieldType, f.defaultValue)
      }
    }

    // uuid 主键自动生成
    if (ctx.pkField.primaryKeyStrategy === 'uuid' && !safeData[ctx.pkField.fieldKey]) {
      safeData[ctx.pkField.fieldKey] = crypto.randomUUID()
    }

    const errors = validateData(ctx.fields, safeData, true)
    if (errors.length > 0) return fail(res, 400, 'validation failed', errors)

    const keys = Object.keys(safeData)
    if (keys.length === 0) return fail(res, 400, 'no fields to insert')

    const columns = keys.map((k) => `"${k}"`).join(', ')
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ')
    const values = keys.map((k) => safeData[k])

    const sql = `INSERT INTO "${ctx.table.tableName}" (${columns}) VALUES (${placeholders}) RETURNING *`
    const r = await client_query(ctx, sql, values)
    const passwordFields = new Set(
      ctx.fields.filter((f) => f.fieldType === 'password').map((f) => f.fieldKey),
    )
    audit({
      action: 'data.create',
      projectId: ctx.project.projectId,
      tableName: ctx.table.tableName,
      operator: (req as any).operator,
      after: maskRow(r.rows[0], passwordFields),
    })
    return created(res, r.rows[0])
  } catch (e: any) {
    if (e.code === '23505') {
      return fail(res, 409, `unique constraint violation: ${e.detail || e.message}`)
    }
    next(e)
  }
})

// PUT /:id
router.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ctx = await loadContext(req, res)
    if (!ctx) return

    const data = req.body as Record<string, unknown>
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return fail(res, 400, 'body must be a JSON object')
    }

    const allowedKeys = new Set(ctx.fields.map((f) => f.fieldKey))
    const safeData: Record<string, unknown> = {}
    for (const k of Object.keys(data)) {
      if (allowedKeys.has(k)) safeData[k] = data[k]
    }

    // 只读字段不允许写入
    const readonlyFields = ctx.fields.filter((f) => f.isReadonly).map((f) => f.fieldKey)
    const attemptedReadonly = Object.keys(safeData).filter((k) => readonlyFields.includes(k))
    if (attemptedReadonly.length > 0) {
      return fail(res, 400, `cannot write to readonly field(s): ${attemptedReadonly.join(', ')}`)
    }

    if (Object.keys(safeData).length === 0) return fail(res, 400, 'no fields to update')

    const errors = validateData(ctx.fields, safeData, false)
    if (errors.length > 0) return fail(res, 400, 'validation failed', errors)

    const keys = Object.keys(safeData)
    const setClause = keys.map((k, i) => `"${k}" = $${i + 1}`).join(', ')
    const values = keys.map((k) => safeData[k])
    const pkParam = values.length + 1

    // 先查旧值做审计 before
    const beforeSql = `SELECT * FROM "${ctx.table.tableName}" WHERE "${ctx.pkField.fieldKey}" = $1`
    const beforeRes = await client_query(ctx, beforeSql, [req.params.id])
    if (beforeRes.rows.length === 0) return fail(res, 404, 'record not found')

    const sql = `UPDATE "${ctx.table.tableName}" SET ${setClause} WHERE "${ctx.pkField.fieldKey}" = $${pkParam} RETURNING *`
    const r = await client_query(ctx, sql, [...values, req.params.id])

    const passwordFields = new Set(
      ctx.fields.filter((f) => f.fieldType === 'password').map((f) => f.fieldKey),
    )
    audit({
      action: 'data.update',
      projectId: ctx.project.projectId,
      tableName: ctx.table.tableName,
      operator: (req as any).operator,
      before: maskRow(beforeRes.rows[0], passwordFields),
      after: maskRow(r.rows[0], passwordFields),
    })
    return ok(res, r.rows[0])
  } catch (e: any) {
    if (e.code === '23505') {
      return fail(res, 409, `unique constraint violation: ${e.detail || e.message}`)
    }
    next(e)
  }
})

// DELETE /:id
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ctx = await loadContext(req, res)
    if (!ctx) return

    const sql = `DELETE FROM "${ctx.table.tableName}" WHERE "${ctx.pkField.fieldKey}" = $1 RETURNING *`
    const r = await client_query(ctx, sql, [req.params.id])
    if (r.rows.length === 0) return fail(res, 404, 'record not found')

    const passwordFields = new Set(
      ctx.fields.filter((f) => f.fieldType === 'password').map((f) => f.fieldKey),
    )
    audit({
      action: 'data.delete',
      projectId: ctx.project.projectId,
      tableName: ctx.table.tableName,
      operator: (req as any).operator,
      before: maskRow(r.rows[0], passwordFields),
    })
    return ok(res, { deleted: r.rows[0] })
  } catch (e) {
    next(e)
  }
})

// 小工具：拿 client 跑 query
async function client_query(
  ctx: NonNullable<Awaited<ReturnType<typeof loadContext>>>,
  sql: string,
  params: unknown[],
) {
  const client = await getDbClient(ctx.project.projectId)
  return client.query(sql, params)
}

// defaultValue 在 DB 里是 VARCHAR，按 fieldType 转成 JS 原生类型
function coerceValue(fieldType: string, value: string): unknown {
  switch (fieldType) {
    case 'number':
      return Number(value)
    case 'boolean':
      return value === 'true'
    case 'json':
      try {
        return JSON.parse(value)
      } catch {
        return value
      }
    default:
      return value
  }
}

export default router
