import { Router as createRouter } from 'express'

import { prisma } from '../prisma.js'
import { deserializeDbConfig } from '../services/dbConfig.js'
import { getDbClient } from '../services/dbConnection.js'
import { MysqlQueryBuilder } from '../services/mysqlQueryBuilder.js'
import { PgQueryBuilder } from '../services/pgQueryBuilder.js'
import { parseQuery } from '../services/queryParser.js'
import { validateData } from '../services/validator.js'
import { audit, maskRow } from '../utils/audit.js'
import { ok, created, fail } from '../utils/respond.js'

import type { QueryBuilder } from '../services/queryBuilder.js'
import type { Request, Response, NextFunction, Router } from 'express'

const router: Router = createRouter({ mergeParams: true })

/** 根据项目的 dbConfig 选 QueryBuilder */
function getQueryBuilder(dbConfig: any): QueryBuilder {
  const cfg = deserializeDbConfig(dbConfig) as { dbType?: string }
  const dbType = cfg.dbType ?? 'postgres'
  return dbType === 'mysql' ? new MysqlQueryBuilder() : new PgQueryBuilder()
}

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

  return { project, table, fields, pkField, qb: getQueryBuilder(project.dbConfig) }
}

// GET /list
router.get('/list', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ctx = await loadContext(req, res)
    if (!ctx) return
    const { qb } = ctx

    let parsed
    try {
      parsed = parseQuery(req.query as Record<string, unknown>, ctx.fields)
    } catch (e: any) {
      return fail(res, 400, e.message)
    }
    const { where, sort, page, size } = parsed

    const whereBuilt = qb.buildWhereSql(where, ctx.fields)
    const orderSql = qb.buildOrderBySql(sort)
    const limitSql = qb.buildLimitOffsetSql(page, size)

    // COUNT
    const countSql = qb.buildCountSql(ctx.table.tableName, whereBuilt.sql)
    const countRes = await client_query(ctx, countSql, whereBuilt.params)
    const total = countRes.rows[0].total as number

    // SELECT
    const whereClause = whereBuilt.sql ? `WHERE ${whereBuilt.sql}` : ''
    const selectSql = `SELECT * FROM ${qb.quote(ctx.table.tableName)}
      ${whereClause}
      ${orderSql ? orderSql + ' ' : ''}
      ${limitSql}`
    const listRes = await client_query(ctx, selectSql, whereBuilt.params)

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
    const { qb } = ctx

    const sql = `SELECT * FROM ${qb.quote(ctx.table.tableName)} WHERE ${qb.quote(ctx.pkField.fieldKey)} = ? LIMIT 1`
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
    const { qb } = ctx

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

    const placeholders = keys.map(() => '?')
    const values = keys.map((k) => safeData[k])

    const sql = qb.buildInsertSql(ctx.table.tableName, keys, placeholders)
    await client_query(ctx, sql, values)

    // MySQL 没有 RETURNING，插入后再查
    const insertId = await getLastInsertId(ctx, qb)
    const r = await client_query(
      ctx,
      `SELECT * FROM ${qb.quote(ctx.table.tableName)} WHERE ${qb.quote(ctx.pkField.fieldKey)} = ? LIMIT 1`,
      [insertId ?? safeData[ctx.pkField.fieldKey]],
    )

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
    if (e.code === '23505' || e.errno === 1062 || e.code === 'ER_DUP_ENTRY') {
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
    const { qb } = ctx

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
    const setClause = keys.map((k) => `${qb.quote(k)} = ?`).join(', ')
    const values = keys.map((k) => safeData[k])

    // 先查旧值做审计 before
    const beforeSql = `SELECT * FROM ${qb.quote(ctx.table.tableName)} WHERE ${qb.quote(ctx.pkField.fieldKey)} = ?`
    const beforeRes = await client_query(ctx, beforeSql, [req.params.id])
    if (beforeRes.rows.length === 0) return fail(res, 404, 'record not found')

    const sql = qb.buildUpdateSql(
      ctx.table.tableName,
      ctx.pkField.fieldKey,
      setClause,
      values.length + 1,
    )
    await client_query(ctx, sql, [...values, req.params.id])

    // 更新后再查
    const r = await client_query(ctx, beforeSql, [req.params.id])

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
    if (e.code === '23505' || e.errno === 1062 || e.code === 'ER_DUP_ENTRY') {
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
    const { qb } = ctx

    // 先查要删的记录做审计 before
    const beforeSql = `SELECT * FROM ${qb.quote(ctx.table.tableName)} WHERE ${qb.quote(ctx.pkField.fieldKey)} = ?`
    const beforeRes = await client_query(ctx, beforeSql, [req.params.id])
    if (beforeRes.rows.length === 0) return fail(res, 404, 'record not found')

    const sql = qb.buildDeleteSql(ctx.table.tableName, ctx.pkField.fieldKey)
    await client_query(ctx, sql, [req.params.id])

    const passwordFields = new Set(
      ctx.fields.filter((f) => f.fieldType === 'password').map((f) => f.fieldKey),
    )
    audit({
      action: 'data.delete',
      projectId: ctx.project.projectId,
      tableName: ctx.table.tableName,
      operator: (req as any).operator,
      before: maskRow(beforeRes.rows[0], passwordFields),
    })
    return ok(res, { deleted: beforeRes.rows[0] })
  } catch (e) {
    next(e)
  }
})

// MySQL 插入后拿 lastInsertId
async function getLastInsertId(
  ctx: NonNullable<Awaited<ReturnType<typeof loadContext>>>,
  qb: QueryBuilder,
): Promise<unknown | undefined> {
  // PG 用 RETURNING 已经拿到了，这里只给 MySQL 用
  // 先查一下刚插入的记录
  const cfg = deserializeDbConfig(ctx.project.dbConfig) as { dbType?: string }
  if (cfg.dbType !== 'mysql') return undefined
  // MySQL 自动增长列，查最大 id
  const sql = `SELECT MAX(${qb.quote(ctx.pkField.fieldKey)}) AS last_id FROM ${qb.quote(ctx.table.tableName)}`
  const r = await client_query(ctx, sql, [])
  return r.rows[0]?.last_id
}

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
