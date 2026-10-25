// 阶段一占位鉴权：校验 Bearer Token == ADMIN_TOKEN
// 阶段五替换为 masterkey / apikey 体系

import { Request, Response, NextFunction } from 'express'

import { env } from '../env.js'
import { fail } from '../utils/respond.js'

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization ?? ''
  const m = header.match(/^Bearer\s+(.+)$/)
  if (!m) {
    return fail(res, 401, 'missing Authorization: Bearer <token>')
  }
  if (m[1] !== env.adminToken) {
    return fail(res, 401, 'invalid admin token')
  }
  ;(req as any).operator = 'admin'
  next()
}
