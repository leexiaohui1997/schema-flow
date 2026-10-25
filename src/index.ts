import express, { Request, Response, NextFunction } from 'express'
import { z } from 'zod'

import { env } from './env.js'
import { authMiddleware } from './middleware/auth.js'
import dataRouter from './routes/data.js'
import fieldsRouter from './routes/fields.js'
import projectsRouter from './routes/projects.js'
import tablesRouter from './routes/tables.js'
import { fail } from './utils/respond.js'

const app = express()
app.use(express.json({ limit: '1mb' }))

// 健康检查（不鉴权）
app.get('/healthz', (_req, res) =>
  res.json({ code: 0, message: 'ok', data: { ts: new Date().toISOString() } }),
)

// 所有 /api 下都要过占位鉴权
app.use('/api', authMiddleware)

app.use('/api/projects', projectsRouter)
app.use('/api/projects/:projectId/tables', tablesRouter)
app.use('/api/projects/:projectId/tables/:tableName/fields', fieldsRouter)
app.use('/api/projects/:projectId/tables/:tableName/data', dataRouter)

// 404
app.use((_req: Request, res: Response) => fail(res, 404, 'not found'))

// 错误处理
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof z.ZodError) {
    return fail(
      res,
      400,
      'validation failed',
      err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    )
  }
  console.error('[error]', err)
  return fail(res, 500, err.message ?? 'internal error')
})

app.listen(env.port, () => {
  console.log(`[schemaflow] listening on http://localhost:${env.port}`)
})
